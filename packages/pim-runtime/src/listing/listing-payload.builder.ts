import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChannelListingPayload } from '@repo/connector-contracts';
import { availableStock, calculatePrice } from '@repo/core-domain';
import { DatabaseService } from '@repo/database';
import {
  CategoryMappingService,
  EnrichmentService,
  MediaImportService,
  PRODUCT_ATTRIBUTE_KEYS,
} from '@repo/pim-catalog';
import type { ListingPayloadBuilder } from '@repo/pim-orders';
import { PricingInputBuilder } from './pricing-input.builder';

interface EnrichmentMeta {
  seoTitle?: string;
  seoDescription?: string;
}

const NON_CHANNEL_ATTRIBUTES: readonly string[] = [
  PRODUCT_ATTRIBUTE_KEYS.ENRICHMENT,
  PRODUCT_ATTRIBUTE_KEYS.SUPPLIER_MISSING,
];

/** Builds the channel payload for a product. Throws (nothing is sent) while not publishable: FR-ENR-002 AC4, FR-CAT-001 AC3, FR-PRC-001. */
@Injectable()
export class ListingPayloadBuilderImpl implements ListingPayloadBuilder {
  constructor(
    private readonly db: DatabaseService,
    private readonly enrichment: EnrichmentService,
    private readonly categories: CategoryMappingService,
    private readonly media: MediaImportService,
    private readonly pricing: PricingInputBuilder,
  ) {}

  async build(
    tenantId: string,
    productId: string,
    channelId: string,
  ): Promise<ChannelListingPayload> {
    await this.enrichment.assertPublishable(tenantId, productId);
    await this.categories.assertPublishable(tenantId, productId, channelId);

    const product = await this.db.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const mapping = await this.db.categoryMapping.findFirst({
      where: {
        tenantId,
        categoryId: product.categoryId ?? undefined,
        channelId,
        supersededAt: null,
        channelCategoryId: { not: null },
      },
    });
    if (!mapping?.channelCategoryId)
      throw new BadRequestException(
        `Product ${productId} has no category mapping for channel ${channelId}`,
      );

    const ctx = await this.pricing.build(tenantId, productId, channelId);
    const price = calculatePrice(ctx.price);
    if (price.status === 'blocked')
      throw new BadRequestException(
        `Price is blocked (${price.reason}); the listing is not published`,
      );

    const imageUrls = await this.media.channelUrls(tenantId, productId);
    if (imageUrls.length === 0)
      throw new BadRequestException(
        `Product ${productId} has no imported images`,
      );
    const stored = await this.db.productMedia.findMany({
      where: { tenantId, productId, storageKey: { not: null } },
      orderBy: { position: 'asc' },
      select: { checksum: true, storageKey: true },
    });
    const checksums = stored.map((m) => m.checksum);
    const existing = await this.db.channelListing.findFirst({
      where: { tenantId, productId, channelId },
    });

    const raw = (product.attributes ?? {}) as Record<string, unknown>;
    const meta = (raw[PRODUCT_ATTRIBUTE_KEYS.ENRICHMENT] ??
      {}) as EnrichmentMeta;
    const attributes = Object.fromEntries(
      Object.entries(raw)
        .filter(
          ([k, v]) =>
            !NON_CHANNEL_ATTRIBUTES.includes(k) &&
            v !== null &&
            v !== undefined &&
            typeof v !== 'object',
        )
        .map(([k, v]) => [k, String(v)]),
    );

    return {
      sku: product.sku,
      ean: product.ean,
      title: product.titlePt ?? product.sku,
      ...(product.shortDescriptionPt && {
        shortDescription: product.shortDescriptionPt,
      }),
      descriptionHtml: product.descriptionPtHtml ?? '',
      weightG: product.weightG ?? 0,
      priceNet: price.net,
      vatRate: String(ctx.price.vatRate),
      stock: availableStock(ctx.stock),
      categoryId: mapping.channelCategoryId,
      attributes,
      imageUrls,
      ...(checksums.length === imageUrls.length &&
        checksums.every((c): c is string => !!c) && {
          imageChecksums: checksums,
        }),
      ...(meta.seoTitle && { seoTitle: meta.seoTitle }),
      ...(meta.seoDescription && { seoDescription: meta.seoDescription }),
      compliance: (product.compliance ?? {}) as Record<string, unknown>,
      active: true,
      enrichmentApproved: true,
      ...(existing?.externalId && { externalId: existing.externalId }),
    };
  }
}
