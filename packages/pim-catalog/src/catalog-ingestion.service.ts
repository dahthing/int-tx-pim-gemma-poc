import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Prisma, SupplierProductStatus, SyncRunStatus } from '@repo/database';
import type { ISourceConnector, SupplierProductRaw } from '@repo/connector-contracts';
import { contentHash } from '@repo/core-domain';
import Decimal from 'decimal.js';
import { PIM_TOKENS, PRODUCT_ATTRIBUTE_KEYS, SYNC_KINDS } from './constants';
import type { ListingStockZeroer } from './ports';

export interface SyncCounters {
  seen: number;
  created: number;
  content_changed: number;
  price_changed: number;
  stock_changed: number;
  missing: number;
  errors: number;
  failed_page?: number;
}

export interface SyncOutcome {
  runId: string;
  status: SyncRunStatus;
  counters: SyncCounters;
}

function hashOf(raw: SupplierProductRaw): string {
  return contentHash({
    name: raw.name,
    description: raw.description ?? undefined,
    ean: raw.ean ?? undefined,
    categories: [raw.departmentName, raw.subDepartmentName, raw.familyName].filter((c): c is string => !!c),
    weightG: raw.grossWeightG ?? undefined,
    imageUrl: raw.imageMainUrl ?? undefined,
  });
}

@Injectable()
export class CatalogIngestionService {
  private readonly logger = new Logger(CatalogIngestionService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.SOURCE_CONNECTOR) private readonly connector: ISourceConnector,
    @Inject(PIM_TOKENS.LISTING_STOCK_ZEROER) private readonly zeroer: ListingStockZeroer,
  ) {}

  async runFullSync(tenantId: string, supplierId: string): Promise<SyncOutcome> {
    const run = await this.db.syncRun.create({
      data: { tenantId, kind: SYNC_KINDS.CATALOG_FULL, connector: this.connector.code, status: SyncRunStatus.RUNNING },
    });
    const c: SyncCounters = { seen: 0, created: 0, content_changed: 0, price_changed: 0, stock_changed: 0, missing: 0, errors: 0 };
    const seen = new Set<string>();
    let cursor: Parameters<ISourceConnector['listCatalog']>[0];
    let pageNo = 1;
    let failure: string | undefined;

    for (;;) {
      let page;
      try {
        page = await this.connector.listCatalog(cursor);
      } catch (e) {
        c.failed_page = pageNo;
        failure = `page ${pageNo} failed: ${(e as Error).message}`;
        this.logger.error(failure);
        break;
      }
      for (const raw of page.items) {
        c.seen++;
        seen.add(raw.externalId);
        try {
          await this.upsert(tenantId, supplierId, raw, c);
        } catch (e) {
          c.errors++;
          this.logger.warn(`item ${raw.externalId} failed: ${(e as Error).message}`);
        }
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      pageNo = page.nextCursor.page ?? pageNo + 1;
    }

    let status: SyncRunStatus = SyncRunStatus.SUCCEEDED;
    if (failure) status = c.seen > 0 ? SyncRunStatus.PARTIAL : SyncRunStatus.FAILED;
    else c.missing = await this.markMissing(tenantId, supplierId, [...seen]);

    await this.db.syncRun.update({
      where: { id: run.id },
      data: { status, counters: { ...c }, finishedAt: new Date(), errorSummary: failure ?? null },
    });
    return { runId: run.id, status, counters: c };
  }

  private async upsert(tenantId: string, supplierId: string, raw: SupplierProductRaw, c: SyncCounters): Promise<void> {
    const existing = await this.db.supplierProduct.findUnique({
      where: { tenantId_supplierId_externalId: { tenantId, supplierId, externalId: raw.externalId } },
    });
    const hash = hashOf(raw);
    const content = {
      code: raw.code,
      slug: raw.slug ?? null,
      ean: raw.ean ?? null,
      name: raw.name,
      descriptionRaw: raw.description ?? null,
      department: raw.departmentName ?? null,
      subDepartment: raw.subDepartmentName ?? null,
      family: raw.familyName ?? null,
      grossWeightG: raw.grossWeightG ?? null,
      imageMainUrl: raw.imageMainUrl ?? null,
      rawPayload: raw.rawPayload as Prisma.InputJsonValue,
      contentHash: hash,
    };
    if (!existing) {
      await this.db.supplierProduct.create({
        data: { tenantId, supplierId, externalId: raw.externalId, ...content, costPrice: raw.costPrice, currency: raw.currency, stock: raw.stock },
      });
      c.created++;
      return;
    }
    const data: Prisma.SupplierProductUpdateInput = { lastSeenAt: new Date(), status: SupplierProductStatus.ACTIVE };
    if (existing.contentHash !== hash) {
      Object.assign(data, content);
      c.content_changed++;
    }
    if (existing.costPrice === null || !new Decimal(String(existing.costPrice)).eq(raw.costPrice)) {
      data.costPrice = raw.costPrice;
      c.price_changed++;
    }
    if (existing.stock !== raw.stock) {
      data.stock = raw.stock;
      c.stock_changed++;
    }
    await this.db.supplierProduct.update({ where: { id: existing.id }, data });
  }

  /** Only called after a COMPLETE run. */
  private async markMissing(tenantId: string, supplierId: string, seenIds: string[]): Promise<number> {
    const unseen = await this.db.supplierProduct.findMany({
      where: { tenantId, supplierId, status: SupplierProductStatus.ACTIVE, externalId: { notIn: seenIds } },
      select: { id: true },
    });
    if (!unseen.length) return 0;
    const ids = unseen.map((u) => u.id);
    await this.db.supplierProduct.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { status: SupplierProductStatus.MISSING },
    });
    const linked = await this.db.product.findMany({
      where: { tenantId, supplierProductId: { in: ids } },
      select: { id: true, attributes: true },
    });
    for (const p of linked) {
      await this.db.product.update({
        where: { id: p.id },
        data: { attributes: { ...((p.attributes as Record<string, unknown> | null) ?? {}), [PRODUCT_ATTRIBUTE_KEYS.SUPPLIER_MISSING]: true } },
      });
    }
    if (linked.length) await this.zeroer.zeroStock(tenantId, linked.map((p) => p.id));
    return ids.length;
  }
}
