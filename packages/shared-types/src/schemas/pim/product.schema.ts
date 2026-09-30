import { z } from 'zod';
import {
  decimalStringSchema,
  enrichmentStatusSchema,
  isoDateTimeSchema,
  listQueryBase,
  listingStatusSchema,
  pageOf,
  productStatusSchema,
} from './common.schema.js';

export const productListQuerySchema = listQueryBase.extend({
  status: productStatusSchema.optional(),
  enrichmentStatus: enrichmentStatusSchema.optional(),
  /** Only products that have (any) listing on this channel. */
  channelId: z.string().min(1).optional(),
});

export const productListingSummarySchema = z
  .object({
    channelId: z.string(),
    channelCode: z.string(),
    status: listingStatusSchema,
    externalId: z.string().nullable(),
    lastPrice: decimalStringSchema.nullable(),
    lastStock: z.number().int().nullable(),
    lastError: z.string().nullable(),
    lastSyncedAt: isoDateTimeSchema.nullable(),
  })
  .meta({ id: 'ProductListingSummary' });

export const productListItemSchema = z
  .object({
    id: z.string(),
    sku: z.string(),
    ean: z.string().nullable(),
    titlePt: z.string().nullable(),
    status: productStatusSchema,
    enrichmentStatus: enrichmentStatusSchema,
    categoryId: z.string().nullable(),
    listings: z.array(productListingSummarySchema),
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'ProductListItem' });

export const productPageSchema = pageOf(productListItemSchema, 'ProductPage');

export const productMediaSchema = z
  .object({
    id: z.string(),
    sourceUrl: z.string(),
    /** Public URL on our storage (never the supplier hotlink); null until imported. */
    url: z.string().nullable(),
    mime: z.string().nullable(),
    position: z.number().int(),
    checksum: z.string().nullable(),
  })
  .meta({ id: 'ProductMedia' });

export const enrichmentDetailSchema = z
  .object({
    bulletPoints: z.array(z.string()),
    seoTitle: z.string().nullable(),
    seoDescription: z.string().nullable(),
    suggestedAttributes: z.record(z.string(), z.string()),
  })
  .meta({ id: 'ProductEnrichment' });

export const productDetailSchema = z
  .object({
    id: z.string(),
    sku: z.string(),
    ean: z.string().nullable(),
    titlePt: z.string().nullable(),
    shortDescriptionPt: z.string().nullable(),
    descriptionPtHtml: z.string().nullable(),
    brand: z.string().nullable(),
    weightG: z.number().int().nullable(),
    status: productStatusSchema,
    enrichmentStatus: enrichmentStatusSchema,
    categoryId: z.string().nullable(),
    attributes: z.record(z.string(), z.unknown()),
    compliance: z.record(z.string(), z.unknown()),
    enrichment: enrichmentDetailSchema.nullable(),
    supplier: z
      .object({
        supplierProductId: z.string(),
        name: z.string(),
        department: z.string().nullable(),
        subDepartment: z.string().nullable(),
        family: z.string().nullable(),
        costPrice: decimalStringSchema.nullable(),
        stock: z.number().int(),
        status: z.enum(['active', 'missing']),
      })
      .nullable(),
    media: z.array(productMediaSchema),
    listings: z.array(productListingSummarySchema),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'ProductDetail' });

export const enrichmentGenerateResponseSchema = z
  .object({ ok: z.boolean(), errors: z.array(z.string()).optional() })
  .meta({ id: 'EnrichmentGenerateResponse' });

export const enrichmentApproveResponseSchema = z
  .object({ enrichmentStatus: enrichmentStatusSchema })
  .meta({ id: 'EnrichmentApproveResponse' });

export const mediaImportResponseSchema = z
  .object({
    imported: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
  })
  .meta({ id: 'MediaImportResponse' });

/** POST /products/:id/pricing/quote */
export const pricingQuoteRequestSchema = z
  .object({
    channelId: z.string().min(1),
    /** Overrides the supplier cost (what-if). */
    cost: decimalStringSchema.optional(),
    override: z
      .object({ gross: decimalStringSchema, force: z.boolean().optional() })
      .optional(),
  })
  .meta({ id: 'PricingQuoteRequest' });

export const pricingQuoteSchema = z
  .object({
    channelId: z.string(),
    channelCode: z.string(),
    status: z.enum(['ok', 'blocked']),
    net: decimalStringSchema.nullable(),
    gross: decimalStringSchema.nullable(),
    marginPct: decimalStringSchema.nullable(),
    ruleId: z.string().nullable(),
    forced: z.boolean(),
    reason: z.enum(['MARGIN_BELOW_MIN', 'NON_POSITIVE_PRICE']).nullable(),
    available: z.number().int().nullable(),
    /** Why no quote could be computed (e.g. the product has no cost). */
    error: z.string().nullable(),
  })
  .meta({ id: 'PricingQuote' });

export const productPricingSchema = z
  .object({ quotes: z.array(pricingQuoteSchema) })
  .meta({ id: 'ProductPricing' });

export const publishReadinessSchema = z
  .object({
    ready: z.boolean(),
    missing: z.array(
      z.object({
        type: z.enum(['category', 'category_mapping', 'mandatory_attribute']),
        name: z.string(),
      }),
    ),
  })
  .meta({ id: 'PublishReadiness' });

export const publishListingResponseSchema = z
  .object({
    status: listingStatusSchema,
    externalId: z.string(),
    skipped: z.boolean(),
  })
  .meta({ id: 'PublishListingResponse' });

export const unpublishListingResponseSchema = z
  .object({ status: z.literal('inactive') })
  .meta({ id: 'UnpublishListingResponse' });

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductListItem = z.infer<typeof productListItemSchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type PricingQuote = z.infer<typeof pricingQuoteSchema>;
export type PricingQuoteRequest = z.infer<typeof pricingQuoteRequestSchema>;
export type PublishReadiness = z.infer<typeof publishReadinessSchema>;
