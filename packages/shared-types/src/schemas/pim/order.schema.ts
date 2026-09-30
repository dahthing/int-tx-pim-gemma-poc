import { z } from 'zod';
import {
  decimalStringSchema,
  isoDateTimeSchema,
  listQueryBase,
  orderStatusSchema,
  pageOf,
  supplierOrderStateSchema,
} from './common.schema.js';

export const orderListQuerySchema = listQueryBase.extend({
  status: orderStatusSchema.optional(),
  channelId: z.string().min(1).optional(),
});

export const supplierOrderSummarySchema = z
  .object({
    id: z.string(),
    supplierId: z.string(),
    state: supplierOrderStateSchema,
    externalOrderId: z.string().nullable(),
    externalReference: z.string().nullable(),
    totalNet: decimalStringSchema.nullable(),
    lastError: z.string().nullable(),
  })
  .meta({ id: 'SupplierOrderSummary' });

/** Order lists and details never include customer or address data (PII stays encrypted at rest, NFR-04). */
export const orderListItemSchema = z
  .object({
    id: z.string(),
    channelId: z.string(),
    channelCode: z.string(),
    externalId: z.string(),
    externalStatus: z.string().nullable(),
    placedAt: isoDateTimeSchema,
    status: orderStatusSchema,
    totalGross: decimalStringSchema.nullable(),
    currency: z.string(),
    lineCount: z.number().int(),
    shipByAt: isoDateTimeSchema.nullable(),
    manualReviewReason: z.string().nullable(),
    supplierOrder: supplierOrderSummarySchema.nullable(),
    hasTracking: z.boolean(),
  })
  .meta({ id: 'OrderListItem' });

export const orderPageSchema = pageOf(orderListItemSchema, 'OrderPage');

export const orderLineSchema = z
  .object({
    sku: z.string(),
    quantity: z.number().int(),
    unitPrice: decimalStringSchema.nullable(),
  })
  .meta({ id: 'OrderLine' });

export const shipmentSchema = z
  .object({
    id: z.string(),
    carrierCode: z.string().nullable(),
    carrierName: z.string().nullable(),
    trackingNumber: z.string(),
    source: z.enum(['supplier_api', 'manual']),
    pushedToChannelAt: isoDateTimeSchema.nullable(),
    pushError: z.string().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .meta({ id: 'Shipment' });

export const orderDetailSchema = orderListItemSchema
  .extend({
    totalNet: decimalStringSchema.nullable(),
    totalShipping: decimalStringSchema.nullable(),
    lines: z.array(orderLineSchema),
    shipments: z.array(shipmentSchema),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'OrderDetail' });

export const retryOrderResponseSchema = z
  .object({ enqueued: z.literal(true), previousStatus: orderStatusSchema })
  .meta({ id: 'RetryOrderResponse' });

export const manualTrackingRequestSchema = z
  .object({
    carrierCode: z.string().trim().min(1).max(64),
    carrierName: z.string().trim().min(1).max(120).optional(),
    trackingNumber: z.string().trim().min(1).max(120),
  })
  .meta({ id: 'ManualTrackingRequest' });

export const manualTrackingResponseSchema = z
  .object({
    shipmentId: z.string(),
    pushed: z.boolean(),
    idempotent: z.boolean(),
    error: z.string().optional(),
  })
  .meta({ id: 'ManualTrackingResponse' });

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type OrderListItem = z.infer<typeof orderListItemSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type ManualTrackingRequest = z.infer<typeof manualTrackingRequestSchema>;
