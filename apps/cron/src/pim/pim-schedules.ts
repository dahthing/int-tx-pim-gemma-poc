import type { PimEnqueueService } from './pim-enqueue.service';

export const DEFAULT_CRON_TIMEZONE = 'Europe/Lisbon';
export const CRON_TIMEZONE_KEY = 'CRON_TIMEZONE';

export type PimSchedule = {
  name: string;
  /** Default cron expression (PRD 6.3, 6.6-6.8); override through `configKey`. */
  cron: string;
  configKey: string;
  method: {
    [
      K in keyof PimEnqueueService
    ]: PimEnqueueService[K] extends () => Promise<void> ? K : never;
  }[keyof PimEnqueueService];
};

export const PIM_SCHEDULES: readonly PimSchedule[] = [
  {
    name: 'aw-catalog-full',
    cron: '30 3 * * *',
    configKey: 'CRON_AW_CATALOG_FULL',
    method: 'enqueueCatalogFullSync',
  },
  {
    name: 'aw-stock-sync',
    cron: '*/30 * * * *',
    configKey: 'CRON_AW_STOCK_SYNC',
    method: 'enqueueStockSync',
  },
  {
    name: 'ps-order-import',
    cron: '*/10 * * * *',
    configKey: 'CRON_PS_ORDER_IMPORT',
    method: 'enqueuePrestashopOrderImport',
  },
  {
    name: 'temu-order-import',
    cron: '*/10 * * * *',
    configKey: 'CRON_TEMU_ORDER_IMPORT',
    method: 'enqueueTemuOrderImport',
  },
  {
    name: 'supplier-order-status-poll',
    cron: '*/15 * * * *',
    configKey: 'CRON_SUPPLIER_ORDER_STATUS_POLL',
    method: 'enqueueSupplierOrderStatusPoll',
  },
  {
    name: 'listing-review-poll',
    cron: '*/30 * * * *',
    configKey: 'CRON_LISTING_REVIEW_POLL',
    method: 'enqueueListingReviewPoll',
  },
  {
    name: 'ship-by-deadline-scan',
    cron: '0 * * * *',
    configKey: 'CRON_SHIP_BY_SCAN',
    method: 'enqueueShipByDeadlineScan',
  },
  {
    name: 'pii-purge',
    cron: '0 4 * * *',
    configKey: 'CRON_PII_PURGE',
    method: 'enqueuePiiPurge',
  },
];
