import {
  CurationService,
  StockCostSyncService,
  CatalogIngestionService,
} from '@repo/pim-catalog';
import { ListingSyncService } from '@repo/pim-orders';
import { createFakeFetch } from '@repo/http-client';
import {
  ChannelListingStatus,
  EnrichmentStatus,
  ProductStatus,
  type DatabaseService,
} from '@repo/database';
import { loadFixture } from '../../connector-aw-aiku/src/__fixtures__/load';
import {
  awConnector,
  buildHarness,
  createDb,
  describeDocker,
  FakeChannel,
  resetDb,
  seedTenant,
  type Harness,
} from './support';

/** PRD 12.4 #2: curated product -> PS listing job -> stock change -> only that listing updated. */
describeDocker('curation, listing publish and stock sync (integration)', () => {
  let db: DatabaseService;
  let tenantId: string;
  let supplierId: string;
  let channelId: string;
  let channel: FakeChannel;
  let harness: Harness;
  let portfolio: {
    id: number;
    item_id: number;
    code: string;
    quantity_left: number;
    price: string;
  }[];

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(db);
    ({ tenantId, supplierId } = await seedTenant(db));
    channel = new FakeChannel('prestashop9');
    const row = await db.channel.create({
      data: {
        tenantId,
        code: 'prestashop9',
        name: 'Gemma PS9',
        settings: { stockBuffer: 2 },
      },
    });
    channelId = row.id;

    const pages: Record<string, unknown> = {
      '1': loadFixture('products-page-1.json'),
      '2': loadFixture('products-page-2.json'),
      '3': loadFixture('products-page-3.json'),
    };
    let nextPortfolioId = 3761386;
    const ids = new Map<string, number>();
    const fetch = createFakeFetch((call) => {
      const u = new URL(call.url);
      if (u.pathname === '/dropshipping/products')
        return { body: pages[u.searchParams.get('page') ?? '1'] };
      const store =
        /^\/dropshipping\/products\/my-products\/(\d+)\/store$/.exec(
          u.pathname,
        );
      if (call.method === 'POST' && store) {
        const id = ids.get(store[1]!) ?? nextPortfolioId++;
        ids.set(store[1]!, id);
        return {
          status: 201,
          body: { data: { id, item_id: id + 1000, code: `P${store[1]}` } },
        };
      }
      if (
        call.method === 'GET' &&
        u.pathname === '/dropshipping/products/my-products'
      ) {
        return {
          body: {
            data: portfolio,
            links: { next: null },
            meta: { current_page: 1, last_page: 1 },
          },
        };
      }
      return { status: 404, body: { message: 'no route' } };
    });
    harness = await buildHarness(db, { source: awConnector(fetch), channel });
    await harness
      .get(CatalogIngestionService)
      .runFullSync(tenantId, supplierId);
  });

  /** Everything a human does in the back office before a product can be published (enrichment, category, images). */
  async function makePublishable(
    productId: string,
    categoryId: string,
  ): Promise<void> {
    await db.product.update({
      where: { id: productId },
      data: {
        categoryId,
        status: ProductStatus.PUBLISHED,
        enrichmentStatus: EnrichmentStatus.APPROVED,
        titlePt: 'Varinha de selenite',
        descriptionPtHtml: '<p>Varinha natural.</p>',
      },
    });
    await db.productMedia.create({
      data: {
        tenantId,
        productId,
        sourceUrl: `https://cdn.aiku.test/${productId}.jpg`,
        storageKey: `img/${productId}.jpg`,
        checksum: `sum-${productId}`,
        position: 0,
      },
    });
  }

  it('publishes two curated products, then a stock change on one product updates only its listing', async () => {
    const sps = await db.supplierProduct.findMany({
      where: { tenantId, externalId: { in: ['1201', '1202'] } },
      orderBy: { externalId: 'asc' },
    });
    expect(sps).toHaveLength(2);

    // Curation: "Add to Gemma" adds to the AW portfolio and creates draft products.
    const added = await harness.get(CurationService).addToGemma(
      tenantId,
      supplierId,
      sps.map((s) => s.id),
    );
    expect(added.every((r) => r.ok && r.productId)).toBe(true);
    const items = await db.supplierAssortmentItem.findMany({
      where: { tenantId },
      orderBy: { externalPortfolioId: 'asc' },
    });
    expect(items).toHaveLength(2);

    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { sku: 'asc' },
    });
    expect(products.map((p) => p.sku)).toEqual(['AAL-07', 'AAL-08']);
    const category = await db.category.create({
      data: {
        tenantId,
        name: 'Crystals',
        normalizedName: 'crystals',
        slug: 'crystals',
      },
    });
    await db.categoryMapping.create({
      data: {
        tenantId,
        categoryId: category.id,
        channelId,
        normalizedKey: 'crystals',
        channelCategoryId: 'ps-cat-12',
      },
    });
    for (const p of products) await makePublishable(p.id, category.id);

    // Listing job for each product.
    const listings = harness.get(ListingSyncService);
    for (const p of products) {
      const res = await listings.publishListing(tenantId, p.id, channelId);
      expect(res).toMatchObject({ status: 'LIVE', skipped: false });
    }
    expect(channel.upserts.map((u) => u.sku)).toEqual(['AAL-07', 'AAL-08']);
    expect(
      channel.upserts.every(
        (u) =>
          u.enrichmentApproved &&
          u.imageUrls.length === 1 &&
          u.categoryId === 'ps-cat-12',
      ),
    ).toBe(true);

    const live = await db.channelListing.findMany({
      where: { tenantId },
      orderBy: { externalId: 'asc' },
    });
    expect(live.map((l) => [l.externalId, l.status, l.lastStock])).toEqual([
      ['ps-AAL-07', ChannelListingStatus.LIVE, 265], // 267 in stock - buffer 2
      ['ps-AAL-08', ChannelListingStatus.LIVE, expect.any(Number)],
    ]);
    const stockOfSecond = live[1]!.lastStock;
    const priceOfFirst = live[0]!.lastPrice?.toString();

    // Nothing changed: a sync sends nothing.
    const idle = await listings.syncStockAndPrices(tenantId, channelId);
    expect(idle).toMatchObject({ stockSent: 0, priceSent: 0, failed: 0 });
    expect(channel.stockBatches).toHaveLength(0);

    // The supplier reports a stock change for AAL-07 only (cost and the other item unchanged).
    const cost = (id: string) =>
      String(sps.find((s) => s.externalId === id)!.costPrice);
    portfolio = [
      {
        id: Number(items[0]!.externalPortfolioId),
        item_id: 1,
        code: 'AAL-07',
        quantity_left: 10,
        price: cost('1201'),
      },
      {
        id: Number(items[1]!.externalPortfolioId),
        item_id: 2,
        code: 'AAL-08',
        quantity_left: sps[1]!.stock,
        price: cost('1202'),
      },
    ];
    const outcome = await harness
      .get(StockCostSyncService)
      .run(tenantId, supplierId);
    expect(outcome.changedProductIds).toEqual([products[0]!.id]);
    expect(harness.enqueuedProducts).toEqual([[products[0]!.id]]);

    const sync = await listings.syncStockAndPrices(tenantId, channelId);
    expect(sync).toMatchObject({ stockSent: 1, priceSent: 0, failed: 0 });
    expect(channel.stockBatches).toEqual([
      [{ externalId: 'ps-AAL-07', available: 8 }],
    ]);
    expect(channel.priceBatches).toHaveLength(0);

    const after = await db.channelListing.findMany({
      where: { tenantId },
      orderBy: { externalId: 'asc' },
    });
    expect(after[0]!.lastStock).toBe(8);
    expect(after[1]!.lastStock).toBe(stockOfSecond);
    expect(after[0]!.lastPrice?.toString()).toBe(priceOfFirst);
  });
});
