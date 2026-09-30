import { JOB_PATTERNS } from '@repo/shared';
import { createMockDb } from '../testing/mock-db';
import { SyncTriggerService } from './sync-trigger.service';

function setup() {
  const { db, mock } = createMockDb();
  const ops = { resolveSupplierId: jest.fn().mockResolvedValue('s1') };
  const q = () => ({
    getJob: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue({}),
  });
  const catalogQueue = q();
  const stockQueue = q();
  return {
    mock,
    ops,
    catalogQueue,
    stockQueue,
    svc: new SyncTriggerService(
      db,
      ops as never,
      catalogQueue as never,
      stockQueue as never,
    ),
  };
}

describe('SyncTriggerService', () => {
  it('enqueues a catalogue sync for the resolved supplier', async () => {
    const { svc, catalogQueue, ops, mock } = setup();
    mock.syncRun.findFirst.mockResolvedValue(null);
    const now = new Date('2026-05-01T12:00:00Z');
    await expect(svc.triggerCatalogSync('t', undefined, now)).resolves.toEqual({
      enqueued: true,
      kind: 'catalog',
      supplierId: 's1',
    });
    expect(ops.resolveSupplierId).toHaveBeenCalledWith('t', undefined);
    expect(catalogQueue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.RUN_CATALOG_FULL_SYNC,
      { tenantId: 't', supplierId: 's1' },
      { jobId: 'catalog-sync-t-s1' },
    );
    expect(mock.syncRun.findFirst.mock.calls[0][0].where).toMatchObject({
      kind: 'aw.catalog.full',
      status: 'RUNNING',
      startedAt: { gte: new Date('2026-05-01T10:00:00Z') },
    });
  });

  it('works with the real clock', async () => {
    const { svc, mock } = setup();
    mock.syncRun.findFirst.mockResolvedValue(null);
    await expect(svc.triggerCatalogSync('t', 's9')).resolves.toMatchObject({
      enqueued: true,
    });
  });

  it('refuses while a catalogue sync is running', async () => {
    const { svc, catalogQueue, mock } = setup();
    mock.syncRun.findFirst.mockResolvedValue({ id: 'r' });
    await expect(svc.triggerCatalogSync('t')).rejects.toThrow(
      /already running/,
    );
    expect(catalogQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues a stock and cost sync', async () => {
    const { svc, stockQueue } = setup();
    await expect(svc.triggerStockCostSync('t', 's1')).resolves.toEqual({
      enqueued: true,
      kind: 'stock-cost',
      supplierId: 's1',
    });
    expect(stockQueue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.RUN_STOCK_COST_SYNC,
      { tenantId: 't', supplierId: 's1' },
      { jobId: 'stock-sync-t-s1' },
    );
  });
});
