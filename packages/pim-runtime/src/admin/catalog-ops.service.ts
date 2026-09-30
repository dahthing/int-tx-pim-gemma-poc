import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import {
  CurationService,
  MediaImportService,
  PricingService,
  type AddToGemmaResult,
  type MediaImportResult,
  type QuoteInput,
} from '@repo/pim-catalog';
import type { PricingQuote } from '@repo/shared-types';
import { SupplierScope } from '../supplier-scope';

/** Supplier-touching catalogue operations for the back office. They run inside the `SupplierScope` the connector proxy needs. */
@Injectable()
export class CatalogOpsService {
  private readonly logger = new Logger(CatalogOpsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly scope: SupplierScope,
    private readonly curation: CurationService,
    private readonly media: MediaImportService,
    private readonly pricing: PricingService,
  ) {}

  /** The explicit supplier, or the tenant's only / oldest supplier (the POC has one: AW). */
  async resolveSupplierId(
    tenantId: string,
    supplierId?: string,
  ): Promise<string> {
    const supplier = await this.db.supplier.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ...(supplierId && { id: supplierId }),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!supplier)
      throw new NotFoundException(
        supplierId
          ? `Supplier ${supplierId} not found`
          : 'No supplier is configured',
      );
    return supplier.id;
  }

  /** FR-CUR-001 AC1 (bulk) + FR-ENR-001: new products get their media imported, best effort. */
  async addToGemma(
    tenantId: string,
    supplierProductIds: string[],
    supplierId?: string,
  ): Promise<AddToGemmaResult[]> {
    const sid = await this.resolveSupplierId(tenantId, supplierId);
    return this.scope.run(tenantId, sid, async () => {
      const results = await this.curation.addToGemma(
        tenantId,
        sid,
        supplierProductIds,
      );
      for (const r of results) {
        if (!r.ok || r.skipped || !r.productId) continue;
        try {
          await this.media.importForProduct(tenantId, r.productId);
        } catch (e) {
          this.logger.warn(
            `media import for product ${r.productId} failed: ${(e as Error).message}`,
          );
        }
      }
      return results;
    });
  }

  /** FR-CUR-001 AC3. */
  async removeFromGemma(tenantId: string, productId: string): Promise<void> {
    const sid = await this.supplierOfProduct(tenantId, productId);
    await this.scope.run(tenantId, sid, () =>
      this.curation.removeFromGemma(tenantId, sid, productId),
    );
  }

  async importMedia(
    tenantId: string,
    productId: string,
  ): Promise<MediaImportResult> {
    const sid = await this.supplierOfProduct(tenantId, productId);
    return this.scope.run(tenantId, sid, () =>
      this.media.importForProduct(tenantId, productId),
    );
  }

  private async supplierOfProduct(
    tenantId: string,
    productId: string,
  ): Promise<string> {
    const product = await this.db.product.findFirst({
      where: { id: productId, tenantId },
      include: { supplierProduct: { select: { supplierId: true } } },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    return (
      product.supplierProduct?.supplierId ?? this.resolveSupplierId(tenantId)
    );
  }

  // ---- pricing -----------------------------------------------------------------------------------------------

  async quote(tenantId: string, input: QuoteInput): Promise<PricingQuote> {
    const channel = await this.db.channel.findFirst({
      where: { id: input.channelId, tenantId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!channel)
      throw new NotFoundException(`Channel ${input.channelId} not found`);
    return this.toQuote(channel, await this.pricing.quote(tenantId, input));
  }

  /** One quote per channel; a channel that cannot be priced reports `error` instead of failing the whole tab. */
  async quoteAll(tenantId: string, productId: string): Promise<PricingQuote[]> {
    const channels = await this.db.channel.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    const out: PricingQuote[] = [];
    for (const channel of channels) {
      try {
        out.push(
          this.toQuote(
            channel,
            await this.pricing.quote(tenantId, {
              productId,
              channelId: channel.id,
            }),
          ),
        );
      } catch (e) {
        out.push({
          channelId: channel.id,
          channelCode: channel.code,
          status: 'blocked',
          net: null,
          gross: null,
          marginPct: null,
          ruleId: null,
          forced: false,
          reason: null,
          available: null,
          error: (e as Error).message,
        });
      }
    }
    return out;
  }

  private toQuote(
    channel: { id: string; code: string },
    q: Awaited<ReturnType<PricingService['quote']>>,
  ): PricingQuote {
    return {
      channelId: channel.id,
      channelCode: channel.code,
      status: q.result.status,
      net: q.result.net,
      gross: q.result.gross,
      marginPct: q.result.marginPct,
      ruleId: q.result.ruleId,
      forced: q.result.forced,
      reason: q.result.reason ?? null,
      available: q.available,
      error: null,
    };
  }
}
