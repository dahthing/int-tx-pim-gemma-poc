import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { PimEnqueueService } from './pim-enqueue.service';

const mkQueue = () => ({ add: jest.fn().mockResolvedValue(undefined) });

describe('PimEnqueueService', () => {
  let svc: PimEnqueueService;
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  let db: {
    tenant: { findMany: jest.Mock };
    supplier: { findMany: jest.Mock };
    channel: { findMany: jest.Mock };
  };
  let q: Record<string, ReturnType<typeof mkQueue>>;
  const config = { get: jest.fn((_k: string, d?: unknown) => d) };

  beforeEach(async () => {
    db = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
      },
      supplier: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1', tenantId: 't1' }]),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', tenantId: 't1' }]),
      },
    };
    q = {
      [QUEUES.CATALOG_SYNC]: mkQueue(),
      [QUEUES.STOCK_SYNC]: mkQueue(),
      [QUEUES.ORDER_IMPORT]: mkQueue(),
      [QUEUES.ORDER_STATUS]: mkQueue(),
      [QUEUES.ORDER_MAINTENANCE]: mkQueue(),
      [QUEUES.LISTING_SYNC]: mkQueue(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PimEnqueueService,
        { provide: DatabaseService, useValue: db },
        { provide: ConfigService, useValue: config },
        ...Object.entries(q).map(([name, useValue]) => ({
          provide: getQueueToken(name),
          useValue,
        })),
      ],
    }).compile();
    svc = mod.get(PimEnqueueService);
  });

  it('enqueues a catalog full sync per active AW supplier, never running logic inline', async () => {
    await svc.enqueueCatalogFullSync();
    expect(db.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'aw', deletedAt: null }),
      }),
    );
    expect(q[QUEUES.CATALOG_SYNC]!.add).toHaveBeenCalledTimes(1);
    expect(q[QUEUES.CATALOG_SYNC]!.add).toHaveBeenCalledWith(
      JOB_PATTERNS.RUN_CATALOG_FULL_SYNC,
      expect.objectContaining({
        tenantId: 't1',
        supplierId: 's1',
        correlationId: expect.any(String),
      }),
      expect.objectContaining({ jobId: expect.not.stringContaining(':') }),
    );
  });

  it('enqueues stock sync per supplier', async () => {
    await svc.enqueueStockSync();
    expect(q[QUEUES.STOCK_SYNC]!.add).toHaveBeenCalledWith(
      JOB_PATTERNS.RUN_STOCK_COST_SYNC,
      expect.objectContaining({ tenantId: 't1', supplierId: 's1' }),
      expect.any(Object),
    );
  });

  it.each([
    ['prestashop9', 'enqueuePrestashopOrderImport'],
    ['temu-eu', 'enqueueTemuOrderImport'],
  ] as const)('imports orders for %s channels only', async (code, method) => {
    await svc[method]();
    expect(db.channel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code, deletedAt: null }),
      }),
    );
    expect(q[QUEUES.ORDER_IMPORT]!.add).toHaveBeenCalledWith(
      JOB_PATTERNS.IMPORT_CHANNEL_ORDERS,
      expect.objectContaining({ tenantId: 't1', channelId: 'c1' }),
      expect.any(Object),
    );
  });

  it.each([
    [
      'enqueueSupplierOrderStatusPoll',
      QUEUES.ORDER_STATUS,
      JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS,
    ],
    [
      'enqueueShipByDeadlineScan',
      QUEUES.ORDER_MAINTENANCE,
      JOB_PATTERNS.SCAN_SHIP_BY_DEADLINES,
    ],
    ['enqueuePiiPurge', QUEUES.ORDER_MAINTENANCE, JOB_PATTERNS.PURGE_ORDER_PII],
  ] as const)(
    '%s enqueues one job per active tenant',
    async (method, queue, job) => {
      await svc[method]();
      expect(db.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
      expect(q[queue]!.add).toHaveBeenCalledTimes(2);
      expect(q[queue]!.add).toHaveBeenCalledWith(
        job,
        expect.objectContaining({ tenantId: 't2' }),
        expect.any(Object),
      );
    },
  );

  it('enqueues listing review polls per Temu channel', async () => {
    await svc.enqueueListingReviewPoll();
    expect(q[QUEUES.LISTING_SYNC]!.add).toHaveBeenCalledWith(
      JOB_PATTERNS.POLL_LISTING_REVIEW,
      expect.objectContaining({ tenantId: 't1', channelId: 'c1' }),
      expect.any(Object),
    );
  });

  it('uses a deterministic jobId so overlapping ticks do not double-enqueue (idempotent)', async () => {
    await svc.enqueuePiiPurge();
    const ids = q[QUEUES.ORDER_MAINTENANCE]!.add.mock.calls.map(
      (c) => c[2].jobId,
    );
    expect(new Set(ids).size).toBe(2);
    q[QUEUES.ORDER_MAINTENANCE]!.add.mockClear();
    await svc.enqueuePiiPurge();
    expect(
      q[QUEUES.ORDER_MAINTENANCE]!.add.mock.calls.map((c) => c[2].jobId),
    ).toEqual(ids);
  });

  it('keeps going when one enqueue fails', async () => {
    q[QUEUES.ORDER_MAINTENANCE]!.add.mockRejectedValueOnce(new Error('redis'));
    await expect(svc.enqueuePiiPurge()).resolves.toBeUndefined();
    expect(q[QUEUES.ORDER_MAINTENANCE]!.add).toHaveBeenCalledTimes(2);
  });
});
