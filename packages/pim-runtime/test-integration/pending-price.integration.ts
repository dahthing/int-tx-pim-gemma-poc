import type { DatabaseService } from '@repo/database';
import { PrismaPendingPriceStore } from '../src/adapters/prisma-pending-price.store';
import { RequestLogRetentionService } from '../src/adapters/request-log-retention.service';
import { createDb, describeDocker, resetDb, seedTenant } from './support';

/** FR-TEMU-002 AC3 and section 5 retention against the real schema (migration `add_channel_pending_price`). */
describeDocker('pending prices and request log retention (integration)', () => {
  let db: DatabaseService;
  let tenantId: string;
  let channelId: string;

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(db);
    ({ tenantId } = await seedTenant(db));
    channelId = (await db.channel.create({ data: { tenantId, code: 'temu-eu', name: 'Temu' } })).id;
  });

  it('persists, upserts, reads back and resolves a pending price across store instances', async () => {
    const since = new Date('2026-09-30T10:00:00.000Z');
    await new PrismaPendingPriceStore(db, tenantId, channelId).markPending('g1', '9.50', since);
    // A new instance (as after a restart) sees it.
    const store = new PrismaPendingPriceStore(db, tenantId, channelId);
    expect(await store.isPending('g1')).toBe(true);
    await store.markPending('g1', '8.25', since);
    expect(await store.get('g1')).toEqual({ externalId: 'g1', priceNet: '8.25', since });
    expect(await store.pendingIds()).toEqual(['g1']);
    await store.resolve('g1');
    await store.resolve('g1');
    expect(await store.isPending('g1')).toBe(false);
  });

  it('purges request logs older than 30 days only', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.integrationRequestLog.createMany({
      data: [
        { tenantId, connector: 'aw-aiku', method: 'GET', url: 'https://x/old', createdAt: old },
        { tenantId, connector: 'aw-aiku', method: 'GET', url: 'https://x/new' },
      ],
    });
    const res = await new RequestLogRetentionService(db).purge(tenantId);
    expect(res).toEqual({ deleted: 1 });
    expect((await db.integrationRequestLog.findMany()).map((r) => r.url)).toEqual(['https://x/new']);
  });
});
