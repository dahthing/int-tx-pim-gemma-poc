import { z } from 'zod';

export const categorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    parentId: z.string().nullable(),
  })
  .meta({ id: 'Category' });

export const categoryListSchema = z
  .object({ items: z.array(categorySchema) })
  .meta({ id: 'CategoryList' });

export const createCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentId: z.string().min(1).optional(),
  })
  .meta({ id: 'CreateCategoryRequest' });

export const channelCategoryTargetSchema = z.object({
  channelId: z.string().min(1),
  channelCategoryId: z.string().min(1),
});

export const supplierPathMappingSchema = z
  .object({
    department: z.string().nullable(),
    subDepartment: z.string().nullable(),
    family: z.string().nullable(),
    productCount: z.number().int(),
    categoryId: z.string().nullable(),
    channels: z.array(
      z.object({
        channelId: z.string(),
        channelCategoryId: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'SupplierPathMapping' });

export const supplierPathMappingListSchema = z
  .object({ items: z.array(supplierPathMappingSchema) })
  .meta({ id: 'SupplierPathMappingList' });

/** PUT /category-mappings */
export const mapSupplierPathRequestSchema = z
  .object({
    department: z.string().min(1).nullish(),
    subDepartment: z.string().min(1).nullish(),
    family: z.string().min(1).nullish(),
    categoryId: z.string().min(1),
    channels: z.array(channelCategoryTargetSchema).default([]),
  })
  .refine((v) => !!(v.department || v.subDepartment || v.family), {
    message: 'At least one of department, subDepartment or family is required',
  })
  .meta({ id: 'MapSupplierPathRequest' });

export const channelCategoryNodeSchema = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    leaf: z.boolean(),
  })
  .meta({ id: 'ChannelCategoryNode' });

export const channelCategoryTreeSchema = z
  .object({ items: z.array(channelCategoryNodeSchema) })
  .meta({ id: 'ChannelCategoryTree' });

export const channelAttributeSpecSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mandatory: z.boolean(),
    allowedValues: z.array(z.string()).optional(),
  })
  .meta({ id: 'ChannelAttributeSpec' });

/** Attributes of a channel category; the mandatory ones are stored for the publish validation (FR-CAT-001 AC2). */
export const channelAttributesResponseSchema = z
  .object({
    items: z.array(channelAttributeSpecSchema),
    mandatory: z.array(z.string()),
  })
  .meta({ id: 'ChannelAttributesResponse' });

export type MapSupplierPathRequest = z.infer<
  typeof mapSupplierPathRequestSchema
>;
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;
