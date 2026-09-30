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
