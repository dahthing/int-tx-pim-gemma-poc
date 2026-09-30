import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelListingStatus, DatabaseService, ProductStatus } from '@repo/database';
import type { ISourceConnector } from '@repo/connector-contracts';
import { CategoryMappingService } from './category-mapping.service';
import { DEFAULT_LISTING_STOCK, PIM_TOKENS } from './constants';

export interface AddToGemmaResult {
  supplierProductId: string;
  ok: boolean;
  skipped?: boolean;
  productId?: string;
  error?: string;
}

@Injectable()
export class CurationService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.SOURCE_CONNECTOR) private readonly connector: ISourceConnector,
    private readonly categoryMapping: CategoryMappingService,
  ) {}

  async addToGemma(tenantId: string, supplierId: string, supplierProductIds: string[]): Promise<AddToGemmaResult[]> {
    const results: AddToGemmaResult[] = [];
    for (const id of supplierProductIds) {
      try {
        results.push(await this.addOne(tenantId, supplierId, id));
      } catch (e) {
        results.push({ supplierProductId: id, ok: false, error: (e as Error).message });
      }
    }
    return results;
  }

  private async addOne(tenantId: string, supplierId: string, id: string): Promise<AddToGemmaResult> {
    const sp = await this.db.supplierProduct.findFirst({ where: { id, tenantId, supplierId } });
    if (!sp) return { supplierProductId: id, ok: false, error: `Supplier product ${id} not found` };
    const existing = await this.db.supplierAssortmentItem.findFirst({ where: { tenantId, supplierId, supplierProductId: sp.id } });
    if (existing) return { supplierProductId: id, ok: true, skipped: true };

    const item = await this.connector.addToAssortment(sp.externalId);
    await this.db.supplierAssortmentItem.create({
      data: {
        tenantId,
        supplierId,
        supplierProductId: sp.id,
        externalPortfolioId: item.externalPortfolioId,
        sellingPriceAtSupplier: item.sellingPrice ?? null,
        quantityLeft: item.quantityLeft ?? null,
      },
    });

    const sku = sp.code ?? sp.externalId;
    const categoryId = await this.categoryMapping.resolveCategoryId(tenantId, sp.department, sp.subDepartment, sp.family);
    const revived = await this.db.product.findUnique({ where: { tenantId_sku: { tenantId, sku } } });
    if (revived) {
      await this.db.product.update({
        where: { id: revived.id },
        data: { status: ProductStatus.DRAFT, deletedAt: null, supplierProductId: sp.id },
      });
      return { supplierProductId: id, ok: true, productId: revived.id };
    }
    const product = await this.db.product.create({
      data: {
        tenantId,
        sku,
        ean: sp.ean,
        supplierProductId: sp.id,
        titlePt: sp.name,
        weightG: sp.grossWeightG,
        status: ProductStatus.DRAFT,
        ...(categoryId ? { categoryId } : {}),
      },
    });
    return { supplierProductId: id, ok: true, productId: product.id };
  }

  async removeFromGemma(tenantId: string, supplierId: string, productId: string): Promise<void> {
    const product = await this.db.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    if (product.supplierProductId) {
      const item = await this.db.supplierAssortmentItem.findFirst({
        where: { tenantId, supplierId, supplierProductId: product.supplierProductId },
      });
      if (item) {
        await this.connector.removeFromAssortment(item.externalPortfolioId);
        await this.db.supplierAssortmentItem.delete({ where: { id: item.id } });
      }
    }
    await this.db.product.update({ where: { id: product.id }, data: { status: ProductStatus.ARCHIVED } });
    await this.db.channelListing.updateMany({
      where: { tenantId, productId: product.id },
      data: { status: ChannelListingStatus.INACTIVE, lastStock: DEFAULT_LISTING_STOCK },
    });
  }
}
