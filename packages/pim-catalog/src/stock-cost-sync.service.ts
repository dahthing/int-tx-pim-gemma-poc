import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssortmentItemStatus, ChannelListingStatus, DatabaseService } from '@repo/database';
import type { ISourceConnector, SupplierAssortmentItemRaw } from '@repo/connector-contracts';
import Decimal from 'decimal.js';
import { ALERT_TYPES, DEFAULT_LISTING_STOCK, PIM_TOKENS } from './constants';
import type { AlertService, ChannelSyncEnqueuer } from './ports';
import { PricingService } from './pricing.service';

export interface StockCostSyncOutcome {
  changedProductIds: string[];
  deactivatedListingIds: string[];
  errors: number;
}

@Injectable()
export class StockCostSyncService {
  private readonly logger = new Logger(StockCostSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.SOURCE_CONNECTOR) private readonly connector: ISourceConnector,
    private readonly pricing: PricingService,
    @Inject(PIM_TOKENS.CHANNEL_SYNC_ENQUEUER) private readonly enqueuer: ChannelSyncEnqueuer,
    @Inject(PIM_TOKENS.ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  async run(tenantId: string, supplierId: string): Promise<StockCostSyncOutcome> {
    const changedSp = new Set<string>();
    const costChangedSp = new Set<string>();
    let errors = 0;
    let cursor: Parameters<ISourceConnector['listAssortment']>[0];

    do {
      const page = await this.connector.listAssortment(cursor);
      for (const raw of page.items) {
        try {
          const r = await this.apply(tenantId, supplierId, raw);
          if (r.changed) changedSp.add(r.supplierProductId);
          if (r.costChanged) costChangedSp.add(r.supplierProductId);
        } catch (e) {
          errors++;
          this.logger.warn(`assortment item ${raw.externalPortfolioId} failed: ${(e as Error).message}`);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const changedProductIds = await this.productIds(tenantId, [...changedSp]);
    const costChangedProductIds = await this.productIds(tenantId, [...costChangedSp]);
    const deactivatedListingIds = await this.guardMargins(tenantId, costChangedProductIds);
    if (changedProductIds.length) await this.enqueuer.enqueueProductUpdates(tenantId, changedProductIds);
    return { changedProductIds, deactivatedListingIds, errors };
  }

  private async apply(tenantId: string, supplierId: string, raw: SupplierAssortmentItemRaw) {
    const item = await this.db.supplierAssortmentItem.findUnique({
      where: { tenantId_supplierId_externalPortfolioId: { tenantId, supplierId, externalPortfolioId: raw.externalPortfolioId } },
      include: { supplierProduct: true },
    });
    if (!item) return { changed: false, costChanged: false, supplierProductId: '' };
    const sp = item.supplierProduct;

    const spData: { stock?: number; costPrice?: string } = {};
    const itemData: { quantityLeft?: number; sellingPriceAtSupplier?: string; status?: AssortmentItemStatus } = {};
    if (raw.quantityLeft !== undefined) {
      if (raw.quantityLeft !== sp.stock) spData.stock = raw.quantityLeft;
      if (raw.quantityLeft !== item.quantityLeft) itemData.quantityLeft = raw.quantityLeft;
    }
    if (raw.price !== undefined && (sp.costPrice === null || !new Decimal(String(sp.costPrice)).eq(raw.price))) {
      spData.costPrice = raw.price;
    }
    if (raw.sellingPrice != null && (item.sellingPriceAtSupplier === null || !new Decimal(String(item.sellingPriceAtSupplier)).eq(raw.sellingPrice))) {
      itemData.sellingPriceAtSupplier = raw.sellingPrice;
    }
    const status = raw.status === 'disabled' ? AssortmentItemStatus.DISABLED : AssortmentItemStatus.ACTIVE;
    if (status !== item.status) itemData.status = status;

    if (Object.keys(spData).length) await this.db.supplierProduct.update({ where: { id: sp.id }, data: spData });
    if (Object.keys(itemData).length) await this.db.supplierAssortmentItem.update({ where: { id: item.id }, data: itemData });
    const changed = Object.keys(spData).length > 0 || itemData.status !== undefined;
    return { changed, costChanged: spData.costPrice !== undefined, supplierProductId: sp.id };
  }

  private async productIds(tenantId: string, supplierProductIds: string[]): Promise<string[]> {
    if (!supplierProductIds.length) return [];
    const products = await this.db.product.findMany({
      where: { tenantId, supplierProductId: { in: supplierProductIds }, deletedAt: null },
      select: { id: true },
    });
    return products.map((p) => p.id);
  }

  /** FR-ING-002 AC3: a cost change breaking the minimum margin deactivates the listing. */
  private async guardMargins(tenantId: string, productIds: string[]): Promise<string[]> {
    if (!productIds.length) return [];
    const listings = await this.db.channelListing.findMany({
      where: { tenantId, productId: { in: productIds }, deletedAt: null, status: { not: ChannelListingStatus.INACTIVE } },
    });
    const deactivated: string[] = [];
    for (const l of listings) {
      const { result } = await this.pricing.quote(tenantId, { productId: l.productId, channelId: l.channelId });
      if (result.status !== 'blocked') continue;
      await this.db.channelListing.update({
        where: { id: l.id },
        data: { status: ChannelListingStatus.INACTIVE, lastStock: DEFAULT_LISTING_STOCK },
      });
      await this.alerts.raise({
        tenantId,
        type: ALERT_TYPES.MARGIN_BREAK,
        message: `Listing ${l.id} deactivated: ${result.reason}`,
        productId: l.productId,
        channelId: l.channelId,
        details: { reason: result.reason, marginPct: result.marginPct },
      });
      deactivated.push(l.id);
    }
    return deactivated;
  }
}
