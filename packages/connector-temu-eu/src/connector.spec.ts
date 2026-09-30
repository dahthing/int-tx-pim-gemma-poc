import { createFakeFetch, type FakeCall, type FakeStep, type RequestLogEntry } from '@repo/http-client';
import type { ChannelListingPayload } from '@repo/connector-contracts';
import { TemuEuConnector, type TemuEuConnectorConfig } from './connector';
import { UnknownCarrierError } from './carriers';
import { PendingPriceTracker, type PendingPriceStore } from './pending-price';
import { PlaceholderSigner } from './signing';
import { TEMU_METHODS } from './temu-api';

const SECRET = 'SECRET-APP-SECRET-xyz';
const TOKEN = 'TOKEN-ACCESS-abc';
const APP_KEY = 'APPKEY-123';
const HOST = 'https://gw.example-temu.test';

const ok = (result: unknown): FakeStep => ({ body: { success: true, result } });
const fail = (errorCode: number, errorMsg = 'nope'): FakeStep => ({ body: { success: false, errorCode, errorMsg } });
const bodyOf = (c: FakeCall) => JSON.parse(c.body ?? '{}') as Record<string, any>;

function setup(route: (type: string, body: Record<string, any>, call: FakeCall) => FakeStep, over: Partial<TemuEuConnectorConfig> = {}) {
  const fetchImpl = createFakeFetch((call) => route(bodyOf(call).type, bodyOf(call), call));
  const logs: RequestLogEntry[] = [];
  const connector = new TemuEuConnector({
    gatewayHost: HOST,
    appKey: APP_KEY,
    appSecret: SECRET,
    accessToken: TOKEN,
    fetchImpl,
    sink: { log: (e) => void logs.push(e) },
    carrierTable: { dhl: { temuCarrierId: 'C1', temuCarrierName: 'DHL' } },
    now: () => new Date('2026-05-01T00:00:00Z'),
    maxAttempts: 1,
    ...over,
  });
  return { connector, fetchImpl, logs };
}

const listing = (over: Partial<ChannelListingPayload> = {}): ChannelListingPayload => ({
  sku: 'SKU1',
  title: 'Amethyst',
  descriptionHtml: '<p>x</p>',
  weightG: 100,
  priceNet: '10.00',
  vatRate: '0.21',
  stock: 5,
  categoryId: '123',
  attributes: { color: 'purple' },
  imageUrls: ['a', 'b', 'c'],
  compliance: { gpsr_manufacturer: 'M', gpsr_eu_responsible_person: 'R', safety_information: 'S' },
  active: true,
  enrichmentApproved: true,
  ...over,
});

const attrs = ok({ attributes: [{ propId: 'color', propName: 'Color', required: true }] });

describe('TemuEuConnector', () => {
  it('has code, capabilities', () => {
    const { connector } = setup(() => ok({}));
    expect(connector.code).toBe('temu-eu');
    expect(connector.capabilities()).toMatchObject({ listingWrite: true, stockWrite: true, priceWrite: true, orderRead: true, shipmentWrite: true });
  });

  describe('requests', () => {
    it('uses the configurable host and signs every request with the signer', async () => {
      const { connector, fetchImpl } = setup(() => ok({ mallName: 'Shop', currency: 'EUR' }));
      await connector.testConnection();
      const call = fetchImpl.calls[0]!;
      expect(call.url.startsWith(HOST)).toBe(true);
      const b = bodyOf(call);
      expect(b.type).toBe(TEMU_METHODS.shopInfo);
      expect(b.app_key).toBe(APP_KEY);
      expect(b.access_token).toBe(TOKEN);
      expect(b.sign).toBe(new PlaceholderSigner().sign({ ...b, sign: undefined }, SECRET));
      expect(b.appSecret).toBeUndefined();
    });
    it('accepts a custom signer', async () => {
      const { connector, fetchImpl } = setup(() => ok({}), { signer: { sign: () => 'CUSTOM' } });
      await connector.testConnection();
      expect(bodyOf(fetchImpl.calls[0]!).sign).toBe('CUSTOM');
    });
  });

  describe('testConnection', () => {
    it('ok', async () => {
      const { connector } = setup(() => ok({ mallName: 'Gemma', currency: 'EUR' }));
      expect(await connector.testConnection()).toEqual({ ok: true, accountName: 'Gemma', currency: 'EUR' });
    });
    it.each([3000002, 3000003])('token expired/revoked (%s) -> reauthorization_required', async (code) => {
      const { connector } = setup(() => fail(code, 'token expired'));
      expect(await connector.testConnection()).toMatchObject({ ok: false, reason: 'reauthorization_required' });
    });
    it('HTTP 401 -> reauthorization_required', async () => {
      const { connector } = setup(() => ({ status: 401, body: 'denied' }));
      expect(await connector.testConnection()).toMatchObject({ ok: false, reason: 'reauthorization_required' });
    });
    it.each([3000001, 7000001])('bad app key / signature (%s) -> invalid_credentials', async (code) => {
      const { connector } = setup(() => fail(code));
      expect(await connector.testConnection()).toMatchObject({ ok: false, reason: 'invalid_credentials' });
    });
    it('network / 5xx -> unreachable', async () => {
      expect(await setup(() => ({ error: new Error('boom') })).connector.testConnection()).toMatchObject({ reason: 'unreachable' });
      expect(await setup(() => ({ status: 503 })).connector.testConnection()).toMatchObject({ reason: 'unreachable' });
    });
    it('other api error -> unknown', async () => {
      expect(await setup(() => fail(99999, 'weird')).connector.testConnection()).toMatchObject({ ok: false, reason: 'unknown' });
    });
    it('non-Error failure -> unknown', async () => {
      const { connector } = setup(() => ({ body: 'not json at all' }));
      expect(await connector.testConnection()).toMatchObject({ ok: false, reason: 'unknown' });
    });
  });

  describe('secrets never logged', () => {
    it('are absent from sink logs and from error messages', async () => {
      const { connector, logs } = setup(() => ({ status: 500, body: `access_token=${TOKEN} secret: ${SECRET}` }));
      const r = await connector.testConnection();
      const res = await connector.updateStock([{ externalId: 'g1', available: 1 }]);
      const dump = JSON.stringify([logs, r, res]);
      for (const s of [SECRET, TOKEN]) expect(dump).not.toContain(s);
      expect(logs.length).toBeGreaterThan(0);
    });
    it('are absent from thrown errors', async () => {
      const { connector } = setup(() => ({ status: 500, body: `access_token=${TOKEN} secret: ${SECRET}` }));
      const err = await connector.deactivateListing('g1').catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(`${(err as Error).message} ${(err as Error).stack}`).not.toContain(SECRET);
      expect(`${(err as Error).message}`).not.toContain(TOKEN);
    });
    it('api error messages do not echo credentials', async () => {
      const { connector } = setup(() => fail(99999, `bad token ${TOKEN}`));
      const err = await connector.deactivateListing('g1').catch((e: Error) => e);
      expect((err as Error).message).not.toContain(TOKEN);
    });
  });

  describe('upsertListing', () => {
    it('blocks the submit and reports exactly what is missing', async () => {
      const { connector, fetchImpl } = setup((type) => (type === TEMU_METHODS.categoryAttributes ? attrs : ok({})));
      const r = await connector.upsertListing(listing({ imageUrls: ['a'], attributes: {}, compliance: {} }));
      expect(r.skipped).toBe(true);
      expect(r.status).toBe('inactive');
      expect(r.reason).toContain('mandatory_attribute_missing:color');
      expect(r.reason).toContain('images_insufficient:1/3');
      expect(r.reason).toContain('compliance_field_missing:gpsr_manufacturer');
      expect(fetchImpl.calls.map((c) => bodyOf(c).type)).not.toContain(TEMU_METHODS.goodsAdd);
    });
    it('reason for unapproved enrichment without listing fields', async () => {
      const { connector } = setup((type) => (type === TEMU_METHODS.categoryAttributes ? attrs : ok({})));
      const r = await connector.upsertListing(listing({ enrichmentApproved: false }));
      expect(r.reason).toBe('enrichment_not_approved');
    });
    it('submits a valid new listing and returns submitted', async () => {
      const { connector, fetchImpl } = setup((type) =>
        type === TEMU_METHODS.categoryAttributes ? attrs : ok({ goodsId: 'G9', skuId: 'S9' }),
      );
      const r = await connector.upsertListing(listing());
      expect(r).toEqual({ externalId: 'G9', externalVariantId: 'S9', status: 'submitted' });
      const add = fetchImpl.calls.map(bodyOf).find((b) => b.type === TEMU_METHODS.goodsAdd)!;
      expect(add.goods.outSkuSn).toBe('SKU1');
      expect(add.goods.categoryId).toBe('123');
      expect(add.goods.price).toBe('10.00');
      expect(add.goods.images).toEqual(['a', 'b', 'c']);
    });
    it('updates an already linked listing', async () => {
      const { connector, fetchImpl } = setup((type) => (type === TEMU_METHODS.categoryAttributes ? attrs : ok({ goodsId: 'G1' })));
      const r = await connector.upsertListing(listing({ externalId: 'G1' }));
      expect(r.status).toBe('submitted');
      expect(r.externalId).toBe('G1');
      expect(fetchImpl.calls.map((c) => bodyOf(c).type)).toContain(TEMU_METHODS.goodsUpdate);
    });
    it('caches category attribute specs', async () => {
      const { connector, fetchImpl } = setup((type) => (type === TEMU_METHODS.categoryAttributes ? attrs : ok({ goodsId: 'G' })));
      await connector.upsertListing(listing());
      await connector.upsertListing(listing({ sku: 'SKU2' }));
      expect(fetchImpl.calls.filter((c) => bodyOf(c).type === TEMU_METHODS.categoryAttributes)).toHaveLength(1);
    });
  });

  describe('review polling', () => {
    it('maps submitted / live / rejected with reason', async () => {
      const { connector } = setup(() =>
        ok({
          reviews: [
            { goodsId: 'a', status: 'UNDER_REVIEW' },
            { goodsId: 'b', status: 'APPROVED' },
            { goodsId: 'c', status: 'REJECTED', reason: 'image blurry' },
          ],
        }),
      );
      expect(await connector.pollReviewStatus(['a', 'b', 'c'])).toEqual([
        { externalId: 'a', status: 'submitted' },
        { externalId: 'b', status: 'live' },
        { externalId: 'c', status: 'rejected', reason: 'image blurry' },
      ]);
    });
    it('empty input makes no call', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      expect(await connector.pollReviewStatus([])).toEqual([]);
      expect(fetchImpl.calls).toHaveLength(0);
    });
  });

  describe('updateStock', () => {
    it('pushes available stock and reports partial failures', async () => {
      const { connector, fetchImpl } = setup(() =>
        ok({ results: [{ goodsId: 'a', success: true }, { goodsId: 'b', success: false, errorMsg: 'no sku' }] }),
      );
      const r = await connector.updateStock([
        { externalId: 'a', externalVariantId: 's1', available: 7 },
        { externalId: 'b', available: -3.6 },
      ]);
      expect(r.okCount).toBe(1);
      expect(r.failCount).toBe(1);
      expect(r.results[1]).toEqual({ externalId: 'b', ok: false, error: 'no sku' });
      expect(bodyOf(fetchImpl.calls[0]!).items).toEqual([
        { goodsId: 'a', skuId: 's1', quantity: 7 },
        { goodsId: 'b', quantity: 0 },
      ]);
    });
    it('marks items missing from the response as failed', async () => {
      const { connector } = setup(() => ok({ results: [] }));
      const r = await connector.updateStock([{ externalId: 'a', available: 1 }]);
      expect(r.failCount).toBe(1);
    });
    it('whole batch fails on transport error', async () => {
      const { connector } = setup(() => ({ status: 500 }));
      const r = await connector.updateStock([{ externalId: 'a', available: 1 }]);
      expect(r).toMatchObject({ okCount: 0, failCount: 1 });
    });
    it('empty batch makes no call', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      expect(await connector.updateStock([])).toEqual({ results: [], okCount: 0, failCount: 0 });
      expect(fetchImpl.calls).toHaveLength(0);
    });
  });

  describe('updatePrice with pending review', () => {
    it('tracks a price under review and does not re-send while pending', async () => {
      const tracker = new PendingPriceTracker();
      const { connector, fetchImpl } = setup(
        () => ok({ results: [{ goodsId: 'a', success: true, pendingReview: true }] }),
        { pendingPrices: tracker },
      );
      const r1 = await connector.updatePrice([{ externalId: 'a', priceNet: '9.00' }]);
      expect(r1.okCount).toBe(1);
      expect(tracker.isPending('a')).toBe(true);
      const r2 = await connector.updatePrice([{ externalId: 'a', priceNet: '9.50' }]);
      expect(fetchImpl.calls).toHaveLength(1);
      expect(r2.results[0]).toMatchObject({ externalId: 'a', ok: true, skipped: true });
    });
    it('applied prices are not tracked', async () => {
      const tracker = new PendingPriceTracker();
      const { connector } = setup(() => ok({ results: [{ goodsId: 'a', success: true }] }), { pendingPrices: tracker });
      await connector.updatePrice([{ externalId: 'a', priceNet: '9.00' }]);
      expect(tracker.isPending('a')).toBe(false);
    });
    it('reports failures and missing results', async () => {
      const { connector } = setup(() => ok({ results: [{ goodsId: 'a', success: false, errorMsg: 'bad' }] }));
      const r = await connector.updatePrice([
        { externalId: 'a', priceNet: '1' },
        { externalId: 'b', priceNet: '1' },
      ]);
      expect(r.failCount).toBe(2);
    });
    it('transport error fails the batch', async () => {
      const { connector } = setup(() => ({ status: 500 }));
      expect((await connector.updatePrice([{ externalId: 'a', priceNet: '1' }])).failCount).toBe(1);
    });
    it('all-skipped batch makes no call', async () => {
      const tracker = new PendingPriceTracker();
      tracker.markPending('a', '1', new Date());
      const { connector, fetchImpl } = setup(() => ok({}), { pendingPrices: tracker });
      await connector.updatePrice([{ externalId: 'a', priceNet: '2' }]);
      expect(fetchImpl.calls).toHaveLength(0);
    });
    it('pollPendingPrices resolves reviewed changes (approved and rejected)', async () => {
      const tracker = new PendingPriceTracker();
      tracker.markPending('a', '1', new Date());
      tracker.markPending('b', '1', new Date());
      tracker.markPending('c', '1', new Date());
      const { connector } = setup(
        () => ok({ results: [{ goodsId: 'a', status: 'APPROVED' }, { goodsId: 'b', status: 'REJECTED', reason: 'too low' }, { goodsId: 'c', status: 'PENDING' }] }),
        { pendingPrices: tracker },
      );
      const out = await connector.pollPendingPrices();
      expect(out).toEqual([
        { externalId: 'a', outcome: 'approved' },
        { externalId: 'b', outcome: 'rejected', reason: 'too low' },
      ]);
      expect(tracker.pendingIds()).toEqual(['c']);
    });
    it('works with an asynchronous (database backed) store', async () => {
      const inner = new PendingPriceTracker();
      const store: PendingPriceStore = {
        isPending: async (id) => inner.isPending(id),
        markPending: async (id, p, since) => inner.markPending(id, p, since),
        resolve: async (id) => inner.resolve(id),
        get: async (id) => inner.get(id),
        pendingIds: async () => inner.pendingIds(),
      };
      const { connector, fetchImpl } = setup(
        (type) =>
          type === TEMU_METHODS.priceUpdate
            ? ok({ results: [{ goodsId: 'a', success: true, pendingReview: true }] })
            : ok({ results: [{ goodsId: 'a', status: 'APPROVED' }] }),
        { pendingPrices: store },
      );
      await connector.updatePrice([{ externalId: 'a', priceNet: '9.00' }]);
      expect(inner.pendingIds()).toEqual(['a']);
      const skipped = await connector.updatePrice([{ externalId: 'a', priceNet: '9.50' }]);
      expect(skipped.results[0]).toMatchObject({ skipped: true });
      expect(fetchImpl.calls).toHaveLength(1);
      expect(await connector.pollPendingPrices()).toEqual([{ externalId: 'a', outcome: 'approved' }]);
      expect(inner.pendingIds()).toEqual([]);
    });
    it('pollPendingPrices with nothing pending makes no call', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      expect(await connector.pollPendingPrices()).toEqual([]);
      expect(fetchImpl.calls).toHaveLength(0);
    });
  });

  describe('deactivateListing', () => {
    it('calls offline', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      await connector.deactivateListing('g1');
      expect(bodyOf(fetchImpl.calls[0]!)).toMatchObject({ type: TEMU_METHODS.goodsOffline, goodsId: 'g1' });
    });
  });

  describe('listOrdersSince', () => {
    const orderRow = {
      orderSn: 'PO-1',
      status: 'AWAITING_SHIPMENT',
      createTime: 1777629600,
      currency: 'EUR',
      totalAmount: '20.00',
      latestShipTime: 1777888800,
      items: [{ outSkuSn: 'AAL-07', orderItemId: 'L1', quantity: 2, unitPrice: '10.00' }],
    };
    const shipping = { name: 'Ana Silva', email: 'a@x.com', phone: '1', addressLine1: 'Rua 1', addressLine2: null, postCode: '1000', city: 'Lisboa', countryCode: 'PT' };
    const route = (type: string) =>
      type === TEMU_METHODS.orderList ? ok({ total: 40, orders: [orderRow] }) : ok(shipping);

    it('polls awaiting-shipment orders and decrypts shipping info', async () => {
      const { connector, fetchImpl } = setup(route);
      const page = await connector.listOrdersSince(new Date('2026-04-30T00:00:00Z'));
      const list = bodyOf(fetchImpl.calls[0]!);
      expect(list.statuses).toEqual(['AWAITING_SHIPMENT', 'CANCELLED', 'DELIVERED']);
      expect(list.updatedSince).toBe(Math.floor(new Date('2026-04-30T00:00:00Z').getTime() / 1000));
      expect(bodyOf(fetchImpl.calls[1]!)).toMatchObject({ type: TEMU_METHODS.shippingInfoDecrypt, orderSn: 'PO-1' });
      const o = page.items[0]!;
      expect(o).toMatchObject({
        externalId: 'PO-1',
        externalStatus: 'AWAITING_SHIPMENT',
        currency: 'EUR',
        total: '20.00',
        customer: { name: 'Ana Silva', email: 'a@x.com', phone: '1' },
        shippingAddress: { fullName: 'Ana Silva', line1: 'Rua 1', line2: null, postalCode: '1000', city: 'Lisboa', countryCode: 'PT' },
        lines: [{ sku: 'AAL-07', externalLineId: 'L1', quantity: 2, unitPrice: '10.00' }],
      });
      expect(o.placedAt).toEqual(new Date(1777629600 * 1000));
      expect(o.shipByAt).toEqual(new Date(1777888800 * 1000));
      expect(page.total).toBe(40);
      expect(page.nextCursor).toEqual({ page: 2, perPage: 20 });
    });
    it('also returns cancelled and delivered orders (status tracking) without decrypting their PII', async () => {
      const rows = [
        { ...orderRow, orderSn: 'PO-2', status: 'CANCELLED' },
        { ...orderRow, orderSn: 'PO-3', status: 'DELIVERED' },
        { ...orderRow, orderSn: 'PO-4', status: 'PENDING_PAYMENT' },
      ];
      const { connector, fetchImpl } = setup((type) => (type === TEMU_METHODS.orderList ? ok({ total: 3, orders: rows }) : ok(shipping)));
      const page = await connector.listOrdersSince(new Date(0));
      expect(page.items.map((i) => [i.externalId, i.externalStatus])).toEqual([
        ['PO-2', 'CANCELLED'],
        ['PO-3', 'DELIVERED'],
      ]);
      expect(fetchImpl.calls.filter((c) => bodyOf(c).type === TEMU_METHODS.shippingInfoDecrypt)).toHaveLength(0);
      expect(page.items[0]!.customer.name).toBe('');
    });
    it('last page has no next cursor; cursor is honoured', async () => {
      const { connector, fetchImpl } = setup(route);
      const page = await connector.listOrdersSince(new Date(0), { page: 2, perPage: 20 });
      expect(bodyOf(fetchImpl.calls[0]!)).toMatchObject({ pageNo: 2, pageSize: 20 });
      expect(page.nextCursor).toBeNull();
    });
    it('missing ship-by deadline becomes null', async () => {
      const { connector } = setup((type) =>
        type === TEMU_METHODS.orderList ? ok({ total: 1, orders: [{ ...orderRow, latestShipTime: undefined }] }) : ok(shipping),
      );
      expect((await connector.listOrdersSince(new Date(0))).items[0]!.shipByAt).toBeNull();
    });
    it('does not log decrypted PII', async () => {
      const { connector, logs } = setup(route);
      await connector.listOrdersSince(new Date(0));
      expect(JSON.stringify(logs)).not.toContain('Ana Silva');
    });
  });

  describe('pushShipment', () => {
    it('maps the carrier and posts carrier + tracking', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      await connector.pushShipment({ externalOrderId: 'PO-1', carrierCode: 'DHL', trackingNumber: 'TRK1' });
      expect(bodyOf(fetchImpl.calls[0]!)).toMatchObject({
        type: TEMU_METHODS.shipmentConfirm,
        orderSn: 'PO-1',
        carrierId: 'C1',
        carrierName: 'DHL',
        trackingNumber: 'TRK1',
      });
    });
    it('unknown carrier blocks the push with an explicit error and no HTTP call', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      await expect(connector.pushShipment({ externalOrderId: 'PO-1', carrierCode: 'zzz', trackingNumber: 'T' })).rejects.toBeInstanceOf(UnknownCarrierError);
      expect(fetchImpl.calls).toHaveLength(0);
    });
    it('empty tracking is refused', async () => {
      const { connector, fetchImpl } = setup(() => ok({}));
      await expect(connector.pushShipment({ externalOrderId: 'PO-1', carrierCode: 'dhl', trackingNumber: ' ' })).rejects.toThrow(/tracking/i);
      expect(fetchImpl.calls).toHaveLength(0);
    });
  });

  describe('category endpoints', () => {
    it('maps category tree', async () => {
      const { connector } = setup(() => ok({ categories: [{ catId: 1, parentCatId: 0, catName: 'Home', leaf: false }, { catId: 2, parentCatId: 1, catName: 'Decor', leaf: true }] }));
      expect(await connector.getCategoryTree()).toEqual([
        { id: '1', parentId: null, name: 'Home', leaf: false },
        { id: '2', parentId: '1', name: 'Decor', leaf: true },
      ]);
    });
    it('maps category attributes', async () => {
      const { connector } = setup(() => ok({ attributes: [{ propId: 'c', propName: 'Color', required: true, values: ['red'] }, { propId: 'd', propName: 'D', required: false }] }));
      expect(await connector.getCategoryAttributes('5')).toEqual([
        { id: 'c', name: 'Color', mandatory: true, allowedValues: ['red'] },
        { id: 'd', name: 'D', mandatory: false },
      ]);
    });
  });

  describe('api errors', () => {
    it('non-auth api failure throws with code', async () => {
      const { connector } = setup(() => fail(12345, 'bad thing'));
      await expect(connector.deactivateListing('g')).rejects.toMatchObject({ code: '12345' });
    });
    it('malformed envelope throws', async () => {
      const { connector } = setup(() => ({ body: { foo: 1 } }));
      await expect(connector.deactivateListing('g')).rejects.toThrow(/envelope/i);
    });
  });
});
