import { z } from 'zod';
import { paginationSchema } from '../pagination.schema.js';
import { paginatedSchema } from '../paginated.schema.js';

/** Wire format of every timestamp: ISO-8601 UTC string. */
export const isoDateTimeSchema = z.iso.datetime();

/** Money and fractions travel as decimal strings, never floats (NFR-02). */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal string');

/** Fraction such as 0.23 for 23 %. */
export const fractionStringSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal string');

export const productStatusSchema = z.enum([
  'draft',
  'ready',
  'published',
  'archived',
]);
export const enrichmentStatusSchema = z.enum(['none', 'ai_draft', 'approved']);
export const listingStatusSchema = z.enum([
  'pending',
  'submitted',
  'live',
  'rejected',
  'inactive',
]);
export const supplierProductStatusSchema = z.enum(['active', 'missing']);
export const supplierEnvironmentSchema = z.enum(['staging', 'production']);
export const channelCodeSchema = z.enum(['prestashop9', 'temu-eu']);
export const priceRoundingSchema = z.enum(['x.99', 'x.90', 'none']);
export const orderStatusSchema = z.enum([
  'imported',
  'routing',
  'supplier_submitted',
  'supplier_dispatched',
  'tracking_pushed',
  'completed',
  'manual_review',
  'supplier_failed',
  'tracking_missing',
  'cancelled',
]);
export const supplierOrderStateSchema = z.enum([
  'creating',
  'submitted',
  'dispatched',
  'failed',
  'cancelled',
]);
export const syncRunStatusSchema = z.enum([
  'running',
  'succeeded',
  'partial',
  'failed',
]);

export type ProductStatus = z.infer<typeof productStatusSchema>;
export type EnrichmentStatus = z.infer<typeof enrichmentStatusSchema>;
export type ListingStatus = z.infer<typeof listingStatusSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** `?flag=true|false` (z.coerce.boolean would turn the string "false" into true). */
export const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

/** Base of every list query: paginationSchema plus a free-text search. */
export const listQueryBase = paginationSchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
});

export const messageResponseSchema = z
  .object({ message: z.string() })
  .meta({ id: 'PimMessage' });

export function pageOf<T extends z.ZodType>(item: T, id: string) {
  return paginatedSchema(item).meta({ id });
}
