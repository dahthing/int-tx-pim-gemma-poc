import { z } from 'zod';
import {
  decimalStringSchema,
  isoDateTimeSchema,
  listQueryBase,
  pageOf,
  queryBooleanSchema,
  supplierProductStatusSchema,
} from './common.schema.js';

/** GET /supplier-products (query). No `.meta` id: see paginationSchema. */
export const supplierProductListQuerySchema = listQueryBase.extend({
  supplierId: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  subDepartment: z.string().min(1).optional(),
  family: z.string().min(1).optional(),
  status: supplierProductStatusSchema.optional(),
  /** true: only products already in the Gemma assortment; false: only those not yet added. */
  inAssortment: queryBooleanSchema.optional(),
});

export const supplierProductSchema = z
  .object({
    id: z.string(),
    supplierId: z.string(),
    externalId: z.string(),
    code: z.string().nullable(),
    ean: z.string().nullable(),
    name: z.string(),
    department: z.string().nullable(),
    subDepartment: z.string().nullable(),
    family: z.string().nullable(),
    costPrice: decimalStringSchema.nullable(),
    currency: z.string(),
    stock: z.number().int(),
    imageMainUrl: z.string().nullable(),
    status: supplierProductStatusSchema,
    inAssortment: z.boolean(),
    /** Product created from this supplier product, when it was added to Gemma. */
    productId: z.string().nullable(),
    lastSeenAt: isoDateTimeSchema,
  })
  .meta({ id: 'SupplierProduct' });

export const supplierProductPageSchema = pageOf(
  supplierProductSchema,
  'SupplierProductPage',
);

export const supplierProductFacetsQuerySchema = z.object({
  supplierId: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  subDepartment: z.string().min(1).optional(),
});

export const supplierProductFacetsSchema = z
  .object({
    departments: z.array(z.string()),
    subDepartments: z.array(z.string()),
    families: z.array(z.string()),
  })
  .meta({ id: 'SupplierProductFacets' });

export const bulkAddRequestSchema = z
  .object({
    supplierId: z.string().min(1).optional(),
    supplierProductIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .meta({ id: 'BulkAddToGemmaRequest' });

export const bulkAddResultSchema = z.object({
  supplierProductId: z.string(),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  productId: z.string().optional(),
  error: z.string().optional(),
});

export const bulkAddResponseSchema = z
  .object({ results: z.array(bulkAddResultSchema) })
  .meta({ id: 'BulkAddToGemmaResponse' });

export type SupplierProductListQuery = z.infer<
  typeof supplierProductListQuerySchema
>;
export type SupplierProductDto = z.infer<typeof supplierProductSchema>;
export type BulkAddRequest = z.infer<typeof bulkAddRequestSchema>;
export type BulkAddResponse = z.infer<typeof bulkAddResponseSchema>;
