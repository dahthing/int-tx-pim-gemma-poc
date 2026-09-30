import { NotFoundException } from '@nestjs/common';
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
  const importQueue = q();
  const statusQueue = q();
  const listingQueue = q();
  return {
    importQueue,
    statusQueue,
    listingQueue,
    mock,
    ops,
    catalogQueue,
    stockQueue,
    svc: new SyncTriggerService(
      db,
      ops as never,
      catalogQueue as never,
      stockQueue as never,
      importQueue as never,
      statusQueue as never,
      listingQueue as never,
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

  describe('order and listing triggers', () => {
    it('enqueues an order import for one channel (tenant scoped lookup)', async () => {
      const { svc, importQueue, mock } = setup();
      mock.channel.findMany.mockResolvedValue([{ id: 'c1' }]);
      await expect(svc.triggerOrderImport('t', 'c1')).resolves.toEqual({
        enqueued: true,
        kind: 'order-import',
        channelIds: ['c1'],
      });
      expect(mock.channel.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't', deletedAt: null, id: 'c1' },
        select: { id: true },
      });
      expect(importQueue.add).toHaveBeenCalledWith(
        JOB_PATTERNS.IMPORT_CHANNEL_ORDERS,
        { tenantId: 't', channelId: 'c1' },
        { jobId: 'order-import-t-c1' },
      );
    });

    it('imports every channel of the tenant when none is given; 404 when there is none', async () => {
      const { svc, importQueue, mock } = setup();
      mock.channel.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      const res = await svc.triggerOrderImport('t');
      expect(res.channelIds).toEqual(['c1', 'c2']);
      expect(importQueue.add).toHaveBeenCalledTimes(2);
      mock.channel.findMany.mockResolvedValue([]);
      await expect(svc.triggerOrderImport('t', 'zz')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('enqueues the supplier order status poll once per tenant', async () => {
      const { svc, statusQueue } = setup();
      await expect(svc.triggerSupplierOrderStatusPoll('t')).resolves.toEqual({
        enqueued: true,
        kind: 'supplier-order-status',
      });
      expect(statusQueue.add).toHaveBeenCalledWith(
        JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS,
        { tenantId: 't' },
        { jobId: 'order-status-poll-t' },
      );
    });

    it('enqueues listing review polls for Temu channels only', async () => {
      const { svc, listingQueue, mock } = setup();
      mock.channel.findMany.mockResolvedValue([{ id: 'temu1' }]);
      await expect(svc.triggerListingReviewPoll('t')).resolves.toEqual({
        enqueued: true,
        kind: 'listing-review',
        channelIds: ['temu1'],
      });
      expect(mock.channel.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't', deletedAt: null, code: 'temu-eu' },
        select: { id: true },
      });
      expect(listingQueue.add).toHaveBeenCalledWith(
        JOB_PATTERNS.POLL_LISTING_REVIEW,
        { tenantId: 't', channelId: 'temu1' },
        { jobId: 'listing-review-t-temu1' },
      );
      mock.channel.findMany.mockResolvedValue([]);
      await expect(svc.triggerListingReviewPoll('t', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
