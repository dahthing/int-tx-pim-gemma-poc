import { CatalogIngestionService } from '@repo/pim-catalog';
import { createFakeFetch } from '@repo/http-client';
import type { DatabaseService } from '@repo/database';
import { loadFixture } from '../../connector-aw-aiku/src/__fixtures__/load';
import {
  awConnector,
  buildHarness,
  createDb,
  describeDocker,
  resetDb,
  seedTenant,
  type Harness,
} from './support';

/** FR-ING-001 / PRD 12.4 #1: full catalogue sync of 3 fixture pages into Postgres; a second run writes 0 content updates. */
describeDocker('catalogue full sync (integration)', () => {
  let db: DatabaseService;
  let tenantId: string;
  let supplierId: string;
  let harness: Harness;
  let pages: Record<string, unknown>;

  const fetchOf = () =>
    createFakeFetch((call) => {
      const u = new URL(call.url);
      if (call.method === 'GET' && u.pathname === '/dropshipping/products') {
        const body = pages[u.searchParams.get('page') ?? '1'];
        if (body) return { body };
      }
      return { status: 404, body: { message: 'no route' } };
    });

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(db);
    ({ tenantId, supplierId } = await seedTenant(db));
    pages = {
      '1': loadFixture('products-page-1.json'),
      '2': loadFixture('products-page-2.json'),
      '3': loadFixture('products-page-3.json'),
    };
  });

  async function sync() {
    const fetch = fetchOf();
    harness = await buildHarness(db, { source: awConnector(fetch) });
    const outcome = await harness
      .get(CatalogIngestionService)
      .runFullSync(tenantId, supplierId);
    return { outcome, fetch };
  }

  it('ingests 3 pages, then a second identical run creates and changes nothing', async () => {
    const first = await sync();
    expect(first.outcome.status).toBe('SUCCEEDED');
    expect(first.outcome.counters).toMatchObject({
      seen: 4,
      created: 4,
      content_changed: 0,
      missing: 0,
      errors: 0,
    });
    expect(
      first.fetch.calls.map((c) => new URL(c.url).searchParams.get('page')),
    ).toEqual(['1', '2', '3']);
    expect(await db.supplierProduct.count({ where: { tenantId } })).toBe(4);

    const aal07 = await db.supplierProduct.findUniqueOrThrow({
      where: {
        tenantId_supplierId_externalId: {
          tenantId,
          supplierId,
          externalId: '1201',
        },
      },
    });
    expect(aal07).toMatchObject({
      code: 'AAL-07',
      stock: 267,
      grossWeightG: 19,
      currency: 'EUR',
      department: 'Crystals',
      subDepartment: 'Wands',
      family: 'Selenite',
    });
    expect(aal07.costPrice?.toString()).toBe('0.94');

    const before = await db.supplierProduct.findMany({
      where: { tenantId },
      orderBy: { externalId: 'asc' },
    });
    const second = await sync();
    expect(second.outcome.status).toBe('SUCCEEDED');
    expect(second.outcome.counters).toMatchObject({
      seen: 4,
      created: 0,
      content_changed: 0,
      price_changed: 0,
      stock_changed: 0,
      missing: 0,
      errors: 0,
    });

    const after = await db.supplierProduct.findMany({
      where: { tenantId },
      orderBy: { externalId: 'asc' },
    });
    expect(after.map((p) => p.contentHash)).toEqual(
      before.map((p) => p.contentHash),
    );
    expect(after.map((p) => p.name)).toEqual(before.map((p) => p.name));
    expect(
      await db.syncRun.count({ where: { tenantId, status: 'SUCCEEDED' } }),
    ).toBe(2);
  });

  it('positive control: a changed name, a stock change and a vanished product are counted', async () => {
    await sync();
    const p2 = pages['2'] as {
      data: { name: string; current_stock: number }[];
    };
    p2.data[0]!.name = 'Renamed product';
    p2.data[0]!.current_stock = 1;
    const p3 = pages['3'] as { data: unknown[] };
    p3.data = [];

    const run = await sync();
    expect(run.outcome.counters).toMatchObject({
      seen: 3,
      created: 0,
      content_changed: 1,
      stock_changed: 1,
      missing: 1,
      errors: 0,
    });
    expect(
      await db.supplierProduct.count({
        where: { tenantId, status: 'MISSING' },
      }),
    ).toBe(1);
  });
});
