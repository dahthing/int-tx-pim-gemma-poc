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
  });

  it('keeps job patterns unique and job:-prefixed', () => {
    const values = Object.values(JOB_PATTERNS);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((v) => v.startsWith('job:'))).toBe(true);
    expect(JOB_PATTERNS.ROUTE_SUPPLIER_ORDER).toBe('job:route_supplier_order');
  });
});
