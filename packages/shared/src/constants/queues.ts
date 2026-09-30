export const QUEUES = {
  EMAIL: 'email-queue',
  EMAIL_DLQ: 'email-queue-dlq',
  ORDER_IMPORT: 'order-import-queue',
  ORDER_ROUTING: 'order-routing-queue',
  ORDER_STATUS: 'order-status-queue',
  ORDER_MAINTENANCE: 'order-maintenance-queue',
  LISTING_SYNC: 'listing-sync-queue',
  CATALOG_SYNC: 'catalog-sync-queue',
  STOCK_SYNC: 'stock-sync-queue',
} as const;
