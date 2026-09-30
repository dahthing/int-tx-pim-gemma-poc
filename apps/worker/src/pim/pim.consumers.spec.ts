import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CLS_CORRELATION_ID,
  JOB_PATTERNS,
  QUEUES,
  SentryUtil,
} from '@repo/shared';
import { Job } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../metrics/queue-metrics.service';
import { CatalogSyncConsumer } from './consumers/catalog-sync.consumer';
import { ListingSyncConsumer } from './consumers/listing-sync.consumer';
import { OrderImportConsumer } from './consumers/order-import.consumer';
import { OrderMaintenanceConsumer } from './consumers/order-maintenance.consumer';
import { OrderRoutingConsumer } from './consumers/order-routing.consumer';
import { OrderStatusConsumer } from './consumers/order-status.consumer';
import { StockSyncConsumer } from './consumers/stock-sync.consumer';
import { PimJobs } from './pim-runtime';

jest.mock(
  '@repo/pim-runtime',
  () => ({
    PimJobs: class PimJobs {},
    PimRuntimeModule: { register: () => ({ module: class {} }) },
  }),
  { virtual: true },
);

type Case = {
  consumer: new (...a: never[]) => { process(job: Job): Promise<unknown> };
  queue: string;
  name: string;
  method: string;
  data: Record<string, unknown>;
  args: unknown[];
};

const cases: Case[] = [
  {
    consumer: CatalogSyncConsumer,
    queue: QUEUES.CATALOG_SYNC,
    name: JOB_PATTERNS.RUN_CATALOG_FULL_SYNC,
    method: 'runCatalogFullSync',
    data: { tenantId: 't1', supplierId: 's1' },
    args: ['t1', 's1'],
  },
  {
    consumer: StockSyncConsumer,
    queue: QUEUES.STOCK_SYNC,
    name: JOB_PATTERNS.RUN_STOCK_COST_SYNC,
    method: 'runStockCostSync',
    data: { tenantId: 't1', supplierId: 's1' },
    args: ['t1', 's1'],
  },
  {
    consumer: OrderImportConsumer,
    queue: QUEUES.ORDER_IMPORT,
    name: JOB_PATTERNS.IMPORT_CHANNEL_ORDERS,
    method: 'importChannelOrders',
    data: { tenantId: 't1', channelId: 'c1' },
    args: ['t1', 'c1'],
  },
  {
    consumer: OrderRoutingConsumer,
    queue: QUEUES.ORDER_ROUTING,
    name: JOB_PATTERNS.ROUTE_SUPPLIER_ORDER,
    method: 'routeSupplierOrder',
    data: { tenantId: 't1', channelOrderId: 'o1' },
    args: ['t1', 'o1'],
  },
  {
    consumer: OrderStatusConsumer,
    queue: QUEUES.ORDER_STATUS,
    name: JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS,
    method: 'pollSupplierOrders',
    data: { tenantId: 't1' },
    args: ['t1'],
  },
  {
    consumer: OrderStatusConsumer,
    queue: QUEUES.ORDER_STATUS,
    name: JOB_PATTERNS.PUSH_SHIPMENT,
    method: 'pushShipment',
    data: { tenantId: 't1', shipmentId: 'sh1' },
    args: ['t1', 'sh1'],
  },
  {
    consumer: OrderMaintenanceConsumer,
    queue: QUEUES.ORDER_MAINTENANCE,
    name: JOB_PATTERNS.SCAN_SHIP_BY_DEADLINES,
    method: 'scanShipByDeadlines',
    data: { tenantId: 't1' },
    args: ['t1'],
  },
  {
    consumer: OrderMaintenanceConsumer,
    queue: QUEUES.ORDER_MAINTENANCE,
    name: JOB_PATTERNS.PURGE_ORDER_PII,
    method: 'purgeOrderPii',
    data: { tenantId: 't1' },
    args: ['t1'],
  },
  {
    consumer: OrderMaintenanceConsumer,
    queue: QUEUES.ORDER_MAINTENANCE,
    name: JOB_PATTERNS.PURGE_REQUEST_LOGS,
    method: 'purgeRequestLogs',
    data: { tenantId: 't1' },
    args: ['t1'],
  },
  {
    consumer: ListingSyncConsumer,
    queue: QUEUES.LISTING_SYNC,
    name: JOB_PATTERNS.PUBLISH_LISTING,
    method: 'publishListing',
    data: { tenantId: 't1', productId: 'p1', channelId: 'c1' },
    args: ['t1', 'p1', 'c1'],
  },
  {
    consumer: ListingSyncConsumer,
    queue: QUEUES.LISTING_SYNC,
    name: JOB_PATTERNS.SYNC_LISTING_STOCK_PRICE,
    method: 'syncListings',
    data: { tenantId: 't1', channelId: 'c1', productIds: ['p1', 'p2'] },
    args: ['t1', 'c1', ['p1', 'p2']],
  },
  {
    consumer: ListingSyncConsumer,
    queue: QUEUES.LISTING_SYNC,
    name: JOB_PATTERNS.POLL_LISTING_REVIEW,
    method: 'pollListingReviews',
    data: { tenantId: 't1', channelId: 'c1' },
    args: ['t1', 'c1'],
  },
];

describe.each(cases)('$consumer.name / $name', (c) => {
  const pimJobs: Record<string, jest.Mock> = Object.fromEntries(
    [
      'runCatalogFullSync',
      'runStockCostSync',
      'importChannelOrders',
      'routeSupplierOrder',
      'pollSupplierOrders',
      'pushShipment',
      'scanShipByDeadlines',
      'purgeOrderPii',
      'purgeRequestLogs',
      'publishListing',
      'syncListings',
      'pollListingReviews',
    ].map((m) => [m, jest.fn().mockResolvedValue(undefined)]),
  );
  const dlq = { add: jest.fn().mockResolvedValue(undefined) };
  const metrics = { recordDuration: jest.fn(), recordFailure: jest.fn() };
  const cls = {
    run: jest.fn(<T>(fn: () => T) => fn()),
    set: jest.fn(),
  };
  let consumer: any;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mod = await Test.createTestingModule({
      providers: [
        c.consumer as never,
        { provide: PimJobs, useValue: pimJobs },
        { provide: QueueMetricsService, useValue: metrics },
        { provide: ClsService, useValue: cls },
        { provide: getQueueToken(`${c.queue}-dlq`), useValue: dlq },
      ],
    }).compile();
    consumer = mod.get(c.consumer as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('dispatches to the matching PimJobs method with validated args', async () => {
    await consumer.process({ id: '1', name: c.name, data: c.data } as Job);
    expect(pimJobs[c.method]).toHaveBeenCalledWith(...c.args);
  });

  it('propagates the correlation id from job data into CLS', async () => {
    await consumer.process({
      id: '1',
      name: c.name,
      data: { ...c.data, correlationId: 'corr-1' },
    } as Job);
    expect(cls.run).toHaveBeenCalled();
    expect(cls.set).toHaveBeenCalledWith(CLS_CORRELATION_ID, 'corr-1');
  });

  it('rejects malformed job data without calling the runtime', async () => {
    await expect(
      consumer.process({ id: '1', name: c.name, data: {} } as Job),
    ).rejects.toThrow();
    expect(pimJobs[c.method]).not.toHaveBeenCalled();
  });

  it('is safe to re-run (same job twice yields two identical idempotent calls)', async () => {
    const job = { id: '1', name: c.name, data: c.data } as Job;
    await consumer.process(job);
    await consumer.process(job);
    expect(pimJobs[c.method]).toHaveBeenCalledTimes(2);
    expect(pimJobs[c.method]!.mock.calls[0]).toEqual(
      pimJobs[c.method]!.mock.calls[1],
    );
  });

  it('ignores unknown job names with a warning', async () => {
    await consumer.process({ id: '1', name: 'job:nope', data: c.data } as Job);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('reports failures to Sentry and metrics, no DLQ while retries remain', () => {
    const spy = jest.spyOn(SentryUtil, 'captureException').mockImplementation();
    const job = {
      id: '1',
      name: c.name,
      data: c.data,
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as unknown as Job;
    consumer.onFailed(job, new Error('boom'));
    expect(spy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { queue: c.queue, app: 'worker' } }),
    );
    expect(metrics.recordFailure).toHaveBeenCalledWith(c.name);
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('moves the job to the DLQ after the final attempt', () => {
    jest.spyOn(SentryUtil, 'captureException').mockImplementation();
    const job = {
      id: '1',
      name: c.name,
      data: c.data,
      attemptsMade: 3,
      opts: { attempts: 3 },
    } as unknown as Job;
    consumer.onFailed(job, new Error('boom'));
    expect(dlq.add).toHaveBeenCalledWith(c.name, c.data, expect.any(Object));
  });

  it('records duration on completion', () => {
    consumer.onCompleted({
      name: c.name,
      processedOn: 10,
      finishedOn: 25,
    } as Job);
    expect(metrics.recordDuration).toHaveBeenCalledWith(c.name, 15);
  });
});
