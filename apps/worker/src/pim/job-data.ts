import z from 'zod';

const base = {
  tenantId: z.string().min(1),
  correlationId: z.string().optional(),
};

export const tenantJobSchema = z.object(base);
export const supplierJobSchema = z.object({
  ...base,
  supplierId: z.string().min(1),
});
export const channelJobSchema = z.object({
  ...base,
  channelId: z.string().min(1),
});
export const channelOrderJobSchema = z.object({
  ...base,
  channelOrderId: z.string().min(1),
});
export const shipmentJobSchema = z.object({
  ...base,
  shipmentId: z.string().min(1),
});
export const publishListingJobSchema = z.object({
  ...base,
  productId: z.string().min(1),
  channelId: z.string().min(1),
});
export const syncListingsJobSchema = z.object({
  ...base,
  channelId: z.string().min(1),
  productIds: z.array(z.string().min(1)),
});
