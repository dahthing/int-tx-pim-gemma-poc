import { JOB_PATTERNS } from './jobs';
import { QUEUES } from './queues';

describe('order pipeline constants', () => {
  it('keeps queue names unique and suffixed', () => {
    const values = Object.values(QUEUES);
    expect(new Set(values).size).toBe(values.length);
    expect(QUEUES.ORDER_IMPORT).toBe('order-import-queue');
    expect(QUEUES.ORDER_ROUTING).toBe('order-routing-queue');
    expect(QUEUES.ORDER_STATUS).toBe('order-status-queue');
    expect(QUEUES.ORDER_MAINTENANCE).toBe('order-maintenance-queue');
    expect(QUEUES.LISTING_SYNC).toBe('listing-sync-queue');
    expect(QUEUES.CATALOG_SYNC).toBe('catalog-sync-queue');
    expect(QUEUES.STOCK_SYNC).toBe('stock-sync-queue');
  });

  it('keeps job patterns unique and job:-prefixed', () => {
    const values = Object.values(JOB_PATTERNS);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((v) => v.startsWith('job:'))).toBe(true);
    expect(JOB_PATTERNS.ROUTE_SUPPLIER_ORDER).toBe('job:route_supplier_order');
    expect(JOB_PATTERNS.RUN_CATALOG_FULL_SYNC).toBe('job:run_catalog_full_sync');
    expect(JOB_PATTERNS.RUN_STOCK_COST_SYNC).toBe('job:run_stock_cost_sync');
  });
});
