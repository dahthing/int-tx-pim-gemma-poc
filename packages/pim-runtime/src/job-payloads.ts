/** BullMQ job payloads produced by the runtime enqueuers (queue names: QUEUES, job names: JOB_PATTERNS in @repo/shared). */
export interface RouteSupplierOrderJobData {
  tenantId: string;
  channelOrderId: string;
}

export interface SyncListingsJobData {
  tenantId: string;
  channelId: string;
  /** Products whose data changed; informational (the sync recomputes what changed). */
  productIds: string[];
}

/** Payload of the catalogue / stock sync jobs (QUEUES.CATALOG_SYNC / QUEUES.STOCK_SYNC). */
export interface SupplierSyncJobData {
  tenantId: string;
  supplierId: string;
}

/** Payload of the tenant wide jobs (order status poll, maintenance). */
export interface TenantJobData {
  tenantId: string;
}

/** Payload of the per channel jobs (order import, listing review poll). */
export interface ChannelJobData {
  tenantId: string;
  channelId: string;
}
