import { z } from 'zod';
import {
  isoDateTimeSchema,
  listQueryBase,
  pageOf,
  syncRunStatusSchema,
} from './common.schema.js';

export const syncRunListQuerySchema = listQueryBase.extend({
  kind: z.string().min(1).optional(),
  status: syncRunStatusSchema.optional(),
});

export const syncRunSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    connector: z.string(),
    status: syncRunStatusSchema,
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.nullable(),
    counters: z.record(z.string(), z.number()),
    errorSummary: z.string().nullable(),
  })
  .meta({ id: 'SyncRun' });

export const syncRunPageSchema = pageOf(syncRunSchema, 'SyncRunPage');

export const alertListQuerySchema = listQueryBase.extend({
  status: z.enum(['open', 'all']).default('open'),
});

export const alertSchema = z
  .object({
    /** AuditEvent id of the `alert.raised` event; use it to acknowledge. */
    id: z.string(),
    type: z.string(),
    message: z.string(),
    dedupeKey: z.string(),
    status: z.enum(['open', 'acknowledged']),
    raisedAt: isoDateTimeSchema,
    productId: z.string().nullable(),
    channelId: z.string().nullable(),
    channelOrderId: z.string().nullable(),
  })
  .meta({ id: 'Alert' });

export const alertPageSchema = pageOf(alertSchema, 'AlertPage');

export const acknowledgeAlertResponseSchema = z
  .object({ id: z.string(), status: z.literal('acknowledged') })
  .meta({ id: 'AcknowledgeAlertResponse' });

export const dashboardSchema = z
  .object({
    lastSyncRuns: z.array(syncRunSchema),
    counts: z.object({
      failedSyncRuns24h: z.number().int(),
      openAlerts: z.number().int(),
      failedOrders: z.number().int(),
      manualReviewOrders: z.number().int(),
      missingSupplierProducts: z.number().int(),
      productsByStatus: z.record(z.string(), z.number().int()),
      ordersByStatus: z.record(z.string(), z.number().int()),
    }),
    alerts: z.array(alertSchema),
  })
  .meta({ id: 'Dashboard' });

/** POST /sync/catalog and /sync/stock-cost */
export const triggerSyncRequestSchema = z
  .object({ supplierId: z.string().min(1).optional() })
  .meta({ id: 'TriggerSyncRequest' });

export const triggerSyncResponseSchema = z
  .object({
    enqueued: z.literal(true),
    kind: z.enum(['catalog', 'stock-cost']),
    supplierId: z.string(),
  })
  .meta({ id: 'TriggerSyncResponse' });

export type SyncRunDto = z.infer<typeof syncRunSchema>;
export type AlertDto = z.infer<typeof alertSchema>;
export type DashboardDto = z.infer<typeof dashboardSchema>;
