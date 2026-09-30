import type { ChannelOrderRaw } from '@repo/connector-contracts';
import { decryptSecret } from '@repo/core-domain';
import type { DatabaseService } from '@repo/database';
import {
  ChannelOrderImportService,
  ShipmentService,
  SupplierOrderSagaService,
} from '@repo/pim-orders';
import {
  loadFixture,
  ok,
  routedFetch,
  type Route,
} from '../../connector-aw-aiku/src/__fixtures__/load';
import {
  buildHarness,
  callTrace,
  createDb,
  describeDocker,
  FakeChannel,
  resetDb,
  seedTenant,
  awConnector,
  TEST_KEY,
  type Harness,
} from './support';

const AW_ROUTES = (
  over: Record<string, Route> = {},
): Record<string, Route> => ({
  'GET /dropshipping/clients': ok('clients-search-empty.json'),
  'POST /dropshipping/clients': ok('client-create.json', 201),
  'POST /dropshipping/order/client/556/store': ok('order-store.json', 201),
  'POST /dropshipping/order/9001/portfolio/3761386/store': ok(
    'transaction-store.json',
    201,
  ),
  'POST /dropshipping/order/9001/portfolio/3761387/store': ok(
    'transaction-store.json',
    201,
  ),
  'PATCH /dropshipping/order/9001/update': ok('order-update.json'),
  'GET /dropshipping/order/9001': ok('order-get.json'),
  'PATCH /dropshipping/order/9001/submit': ok('order-submit.json'),
  ...over,
});

const PS_ORDER: ChannelOrderRaw = {
  externalId: '1001',
  externalStatus: 'Payment accepted',
  placedAt: new Date('2026-09-30T10:00:00Z'),
  currency: 'EUR',
  total: '40.00',
  customer: {
    name: 'Ana Silva',
    email: 'ana@example.com',
    phone: '+351900000000',
  },
  shippingAddress: {
    fullName: 'Ana Silva',
    line1: 'Rua das Flores 10',
    postalCode: '1000-001',
    city: 'Lisboa',
    countryCode: 'PT',
  },
  lines: [
    { sku: 'AAL-07', quantity: 2 },
    { sku: 'AAL-08', quantity: 1 },
  ],
};

describeDocker('order routing saga (integration)', () => {
  let db: DatabaseService;
  let tenantId: string;
  let supplierId: string;
  let channelId: string;
  let channel: FakeChannel;

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
    channel.orders = [PS_ORDER];
    channelId = (
      await db.channel.create({
        data: { tenantId, code: 'prestashop9', name: 'Gemma PS9' },
      })
    ).id;
    for (const [sku, portfolio] of [
      ['AAL-07', '3761386'],
      ['AAL-08', '3761387'],
    ] as const) {
      const sp = await db.supplierProduct.create({
        data: {
          tenantId,
          supplierId,
          externalId: sku,
          code: sku,
          name: sku,
          costPrice: '5.00',
          stock: 50,
          rawPayload: {},
          contentHash: sku,
        },
      });
      await db.supplierAssortmentItem.create({
        data: {
          tenantId,
          supplierId,
          supplierProductId: sp.id,
          externalPortfolioId: portfolio,
        },
      });
      await db.product.create({
        data: {
          tenantId,
          sku,
          supplierProductId: sp.id,
          titlePt: sku,
          status: 'PUBLISHED',
        },
      });
    }
  });

  async function importOrder(h: Harness): Promise<string> {
    const summary = await h
      .get(ChannelOrderImportService)
      .importChannel(tenantId, channelId);
    expect(summary).toMatchObject({
      fetched: 1,
      imported: 1,
      manualReview: 0,
      failed: 0,
    });
    expect(h.enqueuedRouting).toHaveLength(1);
    return h.enqueuedRouting[0]!.channelOrderId;
  }

  it('PS paid order -> AW saga -> manual tracking -> PS shipment push', async () => {
    const aw = routedFetch(AW_ROUTES());
    const h = await buildHarness(db, {
      source: awConnector(aw),
      channel,
      gatewayFetch: aw,
    });
    const orderId = await importOrder(h);

    // Import is idempotent and PII is encrypted at rest (NFR-04).
    expect(
      await h.get(ChannelOrderImportService).importChannel(tenantId, channelId),
    ).toMatchObject({ imported: 0, duplicates: 1 });
    const stored = await db.channelOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(stored.internalStatus).toBe('IMPORTED');
    expect(JSON.stringify(stored.customer)).not.toContain('ana@example.com');
    expect(
      JSON.parse(decryptSecret(String(stored.customer), TEST_KEY)),
    ).toMatchObject({ email: 'ana@example.com' });

    const route = await h
      .get(SupplierOrderSagaService)
      .route(tenantId, orderId);
    expect(route).toEqual({ outcome: 'submitted', externalOrderId: '9001' });
    expect(callTrace(aw)).toEqual([
      'GET /dropshipping/clients',
      'POST /dropshipping/clients',
      'POST /dropshipping/order/client/556/store',
      'POST /dropshipping/order/9001/portfolio/3761386/store',
      'POST /dropshipping/order/9001/portfolio/3761387/store',
      'PATCH /dropshipping/order/9001/update',
      'GET /dropshipping/order/9001',
      'PATCH /dropshipping/order/9001/submit',
    ]);
    const so = await db.supplierOrder.findUniqueOrThrow({
      where: { channelOrderId: orderId },
    });
    expect(so).toMatchObject({
      state: 'SUBMITTED',
      externalOrderId: '9001',
      externalClientId: '556',
    });
    expect(
      (await db.channelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .internalStatus,
    ).toBe('SUPPLIER_SUBMITTED');

    // Routing again is a no-op: no second AW order.
    expect(
      await h.get(SupplierOrderSagaService).route(tenantId, orderId),
    ).toEqual({ outcome: 'skipped' });
    expect(aw.calls).toHaveLength(8);

    // Manual tracking (S0.1 fallback) pushes the shipment through the originating channel.
    const tracking = await h
      .get(ShipmentService)
      .recordManualTracking(tenantId, orderId, {
        carrierCode: 'ctt',
        carrierName: 'CTT',
        trackingNumber: 'CT123456789PT',
      });
    expect(tracking).toMatchObject({ pushed: true, idempotent: false });
    expect(channel.shipments).toEqual([
      {
        externalOrderId: '1001',
        carrierCode: 'ctt',
        carrierName: 'CTT',
        trackingNumber: 'CT123456789PT',
      },
    ]);
    const shipment = await db.shipment.findFirstOrThrow({
      where: { channelOrderId: orderId },
    });
    expect(shipment).toMatchObject({
      source: 'MANUAL',
      trackingNumber: 'CT123456789PT',
      pushError: null,
    });
    expect(shipment.pushedToChannelAt).not.toBeNull();
    expect(
      (await db.channelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .internalStatus,
    ).toBe('TRACKING_PUSHED');

    // Saving the same tracking again never pushes twice.
    await h
      .get(ShipmentService)
      .recordManualTracking(tenantId, orderId, {
        carrierCode: 'ctt',
        trackingNumber: 'CT123456789PT',
      });
    expect(channel.shipments).toHaveLength(1);
  });

  it('job retry after a failure mid-saga resumes from the stored step without a duplicate AW order', async () => {
    let broken = true;
    const aw = routedFetch(
      AW_ROUTES({
        // Step 4 (order note): the worker's connection dies.
        'PATCH /dropshipping/order/9001/update': () =>
          broken
            ? { error: new Error('ECONNRESET: worker lost connection') }
            : loadFixtureStep(),
      }),
    );
    const h = await buildHarness(db, {
      source: awConnector(aw),
      channel,
      gatewayFetch: aw,
    });
    const orderId = await importOrder(h);

    const first = await h
      .get(SupplierOrderSagaService)
      .route(tenantId, orderId);
    expect(first.outcome).toBe('failed');
    const afterCrash = await db.supplierOrder.findUniqueOrThrow({
      where: { channelOrderId: orderId },
    });
    expect(afterCrash.state).toBe('FAILED');
    expect(afterCrash).toMatchObject({
      externalClientId: '556',
      externalOrderId: '9001',
    });
    expect(afterCrash.sagaProgress).toMatchObject({
      clientId: '556',
      orderId: '9001',
      linesStored: ['3761386', '3761387'],
    });
    expect(
      (await db.channelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .internalStatus,
    ).toBe('SUPPLIER_FAILED');

    broken = false;
    const retry = await h
      .get(SupplierOrderSagaService)
      .route(tenantId, orderId);
    expect(retry).toEqual({ outcome: 'submitted', externalOrderId: '9001' });

    const trace = callTrace(aw);
    const count = (t: string) => trace.filter((x) => x === t).length;
    expect(count('POST /dropshipping/order/client/556/store')).toBe(1); // one AW order only
    expect(count('POST /dropshipping/clients')).toBe(1);
    expect(count('POST /dropshipping/order/9001/portfolio/3761386/store')).toBe(
      1,
    );
    expect(count('POST /dropshipping/order/9001/portfolio/3761387/store')).toBe(
      1,
    );
    expect(count('PATCH /dropshipping/order/9001/update')).toBe(2);
    expect(count('PATCH /dropshipping/order/9001/submit')).toBe(1);
    expect(await db.supplierOrder.count({ where: { tenantId } })).toBe(1);
    expect(
      (await db.channelOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .internalStatus,
    ).toBe('SUPPLIER_SUBMITTED');
  });

  it('a worker that died right after step 3 (stored progress, order left in ROUTING) resumes at step 4', async () => {
    const aw = routedFetch(AW_ROUTES());
    const h = await buildHarness(db, {
      source: awConnector(aw),
      channel,
      gatewayFetch: aw,
    });
    const orderId = await importOrder(h);

    // State a killed process leaves behind: progress persisted by the onProgress callback, no result recorded.
    await db.channelOrder.update({
      where: { id: orderId },
      data: { internalStatus: 'ROUTING' },
    });
    const supplier = await db.supplierOrder.create({
      data: {
        tenantId,
        channelOrderId: orderId,
        supplierId,
        state: 'CREATING',
        externalClientId: '556',
        externalOrderId: '9001',
        sagaProgress: {
          clientId: '556',
          orderId: '9001',
          linesStored: ['3761386', '3761387'],
        },
      },
    });

    const res = await h.get(SupplierOrderSagaService).route(tenantId, orderId);
    expect(res).toEqual({ outcome: 'submitted', externalOrderId: '9001' });
    expect(callTrace(aw)).toEqual([
      'PATCH /dropshipping/order/9001/update',
      'GET /dropshipping/order/9001',
      'PATCH /dropshipping/order/9001/submit',
    ]);
    expect(await db.supplierOrder.count({ where: { tenantId } })).toBe(1);
    expect(
      (await db.supplierOrder.findUniqueOrThrow({ where: { id: supplier.id } }))
        .state,
    ).toBe('SUBMITTED');
  });
});

function loadFixtureStep() {
  return { body: loadFixture('order-update.json') };
}
