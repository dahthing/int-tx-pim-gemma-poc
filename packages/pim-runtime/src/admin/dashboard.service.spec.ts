import { createMockDb } from '../testing/mock-db';
import { DashboardService } from './dashboard.service';

const d = new Date('2026-03-01T10:00:00Z');
const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  kind: 'aw.catalog.full',
  connector: 'aw-aiku',
  status: 'SUCCEEDED',
  startedAt: d,
  finishedAt: d,
  counters: { seen: 10, note: 'x' },
  errorSummary: null,
  ...over,
});
const raised = (id: string, key: string, at: string) => ({
  id,
  entityId: key,
  action: 'alert.raised',
  createdAt: new Date(at),
  diff: { type: 'margin_break', message: `m-${id}`, productId: 'p' },
});
const setup = () => {
  const { db, mock } = createMockDb();
  return { mock, svc: new DashboardService(db) };
};

describe('DashboardService.listSyncRuns', () => {
  it('filters, sorts newest first by default and keeps numeric counters only', async () => {
    const { svc, mock } = setup();
    mock.syncRun.findMany.mockResolvedValue([
      run(),
      run({
        id: 'r2',
        status: 'PARTIAL',
        finishedAt: null,
        counters: null,
        errorSummary: 'e',
      }),
    ]);
    mock.syncRun.count.mockResolvedValue(2);
    const r = await svc.listSyncRuns('t', {
      skip: 5,
      take: 10,
      sortBy: 'id',
      sortOrder: 'asc',
      kind: 'aw.catalog.full',
      status: 'succeeded',
    });
    const args = mock.syncRun.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      where: { tenantId: 't', kind: 'aw.catalog.full', status: 'SUCCEEDED' },
      skip: 5,
      take: 10,
      orderBy: { startedAt: 'desc' },
    });
    expect(r.total).toBe(2);
    expect(r.items[0]).toEqual({
      id: 'r1',
      kind: 'aw.catalog.full',
      connector: 'aw-aiku',
      status: 'succeeded',
      startedAt: d.toISOString(),
      finishedAt: d.toISOString(),
      counters: { seen: 10 },
      errorSummary: null,
    });
    expect(r.items[1]).toMatchObject({
      status: 'partial',
      finishedAt: null,
      counters: {},
      errorSummary: 'e',
    });
  });

  it('honours an explicit whitelisted sort and ignores others', async () => {
    const { svc, mock } = setup();
    mock.syncRun.findMany.mockResolvedValue([]);
    mock.syncRun.count.mockResolvedValue(0);
    await svc.listSyncRuns('t', {
      skip: 0,
      take: 5,
      sortBy: 'kind',
      sortOrder: 'desc',
    });
    expect(mock.syncRun.findMany.mock.calls[0][0].orderBy).toEqual({
      kind: 'desc',
    });
    await svc.listSyncRuns('t', {
      skip: 0,
      take: 5,
      sortBy: 'bogus',
      sortOrder: 'desc',
    });
    expect(mock.syncRun.findMany.mock.calls[1][0].orderBy).toEqual({
      startedAt: 'desc',
    });
  });
});

describe('DashboardService.dashboard', () => {
  it('aggregates runs, counts and open alerts', async () => {
    const { svc, mock } = setup();
    mock.syncRun.findMany.mockResolvedValue([run()]);
    mock.syncRun.count.mockResolvedValue(3);
    mock.channelOrder.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mock.supplierProduct.count.mockResolvedValue(7);
    mock.product.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 4 } },
    ]);
    mock.channelOrder.groupBy.mockResolvedValue([
      { internalStatus: 'MANUAL_REVIEW', _count: { _all: 1 } },
    ]);
    mock.auditEvent.findMany.mockResolvedValue([
      raised('a1', 'k1', '2026-03-01T09:00:00Z'),
      raised('a2', 'k2', '2026-03-01T08:00:00Z'),
      {
        id: 'ack',
        entityId: 'k2',
        action: 'alert.acknowledged',
        createdAt: new Date('2026-03-01T09:30:00Z'),
        diff: {},
      },
    ]);
    const r = await svc.dashboard('t', d);
    expect(mock.syncRun.count).toHaveBeenCalledWith({
      where: {
        tenantId: 't',
        status: 'FAILED',
        startedAt: { gte: new Date('2026-02-28T10:00:00Z') },
      },
    });
    expect(r.counts).toEqual({
      failedSyncRuns24h: 3,
      openAlerts: 1,
      failedOrders: 2,
      manualReviewOrders: 1,
      missingSupplierProducts: 7,
      productsByStatus: { draft: 4 },
      ordersByStatus: { manual_review: 1 },
    });
    expect(r.alerts.map((a) => a.id)).toEqual(['a1']);
    expect(r.lastSyncRuns).toHaveLength(1);
  });

  it('works with the real clock', async () => {
    const { svc, mock } = setup();
    mock.syncRun.findMany.mockResolvedValue([]);
    mock.syncRun.count.mockResolvedValue(0);
    mock.channelOrder.count.mockResolvedValue(0);
    mock.supplierProduct.count.mockResolvedValue(0);
    mock.product.groupBy.mockResolvedValue([]);
    mock.channelOrder.groupBy.mockResolvedValue([]);
    mock.auditEvent.findMany.mockResolvedValue([]);
    expect((await svc.dashboard('t')).alerts).toEqual([]);
  });
});

describe('DashboardService alerts', () => {
  it('pages open alerts or all alerts', async () => {
    const { svc, mock } = setup();
    mock.auditEvent.findMany.mockResolvedValue([
      raised('a1', 'k1', '2026-03-03T00:00:00Z'),
      raised('a2', 'k2', '2026-03-02T00:00:00Z'),
      {
        id: 'ack',
        entityId: 'k2',
        action: 'alert.acknowledged',
        createdAt: new Date('2026-03-04T00:00:00Z'),
        diff: {},
      },
    ]);
    expect(
      (
        await svc.listAlerts('t', { skip: 0, take: 10, status: 'open' })
      ).items.map((a) => a.id),
    ).toEqual(['a1']);
    const all = await svc.listAlerts('t', { skip: 1, take: 1, status: 'all' });
    expect(all.total).toBe(2);
    expect(all.items.map((a) => a.id)).toEqual(['a2']);
  });

  it('acknowledges an open alert once', async () => {
    const { svc, mock } = setup();
    mock.auditEvent.findFirst
      .mockResolvedValueOnce({ id: 'a1', entityId: 'k1' })
      .mockResolvedValueOnce({ action: 'alert.raised' });
    await expect(svc.acknowledge('t', 'a1', 'admin@x')).resolves.toEqual({
      id: 'a1',
      status: 'acknowledged',
    });
    expect(mock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't',
        actor: 'admin@x',
        entity: 'Alert',
        entityId: 'k1',
        action: 'alert.acknowledged',
        diff: { acknowledgedEventId: 'a1' },
      },
    });
  });

  it('is idempotent for an already acknowledged alert and 404s unknown ids', async () => {
    const { svc, mock } = setup();
    mock.auditEvent.findFirst
      .mockResolvedValueOnce({ id: 'a1', entityId: 'k1' })
      .mockResolvedValueOnce({ action: 'alert.acknowledged' });
    await svc.acknowledge('t', 'a1', 'x');
    expect(mock.auditEvent.create).not.toHaveBeenCalled();
    mock.auditEvent.findFirst.mockResolvedValueOnce(null);
    await expect(svc.acknowledge('t', 'zz', 'x')).rejects.toThrow(/Alert zz/);
  });
});
