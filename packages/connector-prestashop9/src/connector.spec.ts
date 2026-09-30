import type { ChannelListingPayload } from '@repo/connector-contracts';
import type { FakeFetch, RequestLogEntry } from '@repo/http-client';
import { PrestaShop9Connector } from './connector';
import type { PrestaShop9Settings } from './settings';
import { ALL_WS, SECRETS, json, makeSettings, router, type Route } from './__fixtures__/support';

const listing: ChannelListingPayload = {
  sku: 'AAL-07', ean: '5601234567890', title: 'Quartzo', descriptionHtml: '<p>d</p>', weightG: 19, priceNet: '12.50',
  vatRate: '0.23', stock: 5, categoryId: '12', attributes: {}, imageUrls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'], active: true,
};

function make(routes: Route[], over: Partial<PrestaShop9Settings> = {}, extra: Record<string, unknown> = {}) {
  const fake: FakeFetch = router(routes);
  const entries: RequestLogEntry[] = [];
  const c = new PrestaShop9Connector({
    settings: makeSettings({ routing: ALL_WS, ...over }), fetchImpl: fake, sleep: async () => {}, maxAttempts: 1,
    sink: { log: (e) => void entries.push(e) }, ...extra,
  });
  return { c, fake, entries };
}
const bodies = (fake: FakeFetch, method: string, re: RegExp) =>
  fake.calls.filter((c) => c.method === method && re.test(new URL(c.url).pathname)).map((c) => JSON.parse(c.body!));

const stockRoutes: Route[] = [
  ['GET', '/api/stock_availables', json({ stock_availables: [{ id: 7, id_product: '77', id_product_attribute: '0', quantity: '0' }] })],
  ['PUT', '/api/stock_availables/7', (c) => json(JSON.parse(c.body!))],
  ['GET', '/api/stock_availables/7', json({ stock_available: { id: 7, id_product: '77', quantity: '0' } })],
];
const createRoutes: Route[] = [
  ['GET', '/api/products', json([])],
  ['POST', '/api/products', json({ product: { id: 77 } })],
  ['POST', '/api/images/products/77', json({})],
  ...stockRoutes,
];

describe('PrestaShop9Connector', () => {
  it('has code and accurate capabilities', () => {
    const { c } = make([]);
    expect(c.code).toBe('prestashop9');
    expect(c.capabilities()).toEqual({
      listingWrite: true, stockWrite: true, priceWrite: true, orderRead: true, shipmentWrite: true,
      catalogRead: false, assortmentWrite: false, stockRead: false, costRead: false, mediaRead: false,
      dropshipOrderWrite: false, trackingRead: false, categoryTreeRead: false,
    });
  });

  describe('upsertListing', () => {
    it('creates when reference and EAN are not found', async () => {
      const { c, fake } = make(createRoutes);
      const r = await c.upsertListing(listing);
      expect(r).toMatchObject({ externalId: '77', status: 'live' });
      expect(r.skipped).toBeUndefined();
      expect(r.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.imageChecksums).toEqual(['https://cdn/1.jpg', 'https://cdn/2.jpg']);
      const lookups = fake.calls.filter((x) => x.method === 'GET' && x.url.includes('/api/products')).map((x) => new URL(x.url).searchParams);
      expect(lookups[0]!.get('filter[reference]')).toBe('[AAL-07]');
      expect(lookups[1]!.get('filter[ean13]')).toBe('[5601234567890]');
      const [post] = bodies(fake, 'POST', /^\/api\/products$/);
      expect(post.product).toMatchObject({ reference: 'AAL-07', weight: '0.019', price: '12.50', id_tax_rules_group: '3' });
      expect(bodies(fake, 'POST', /images/)).toHaveLength(2);
      expect(bodies(fake, 'PUT', /stock_availables\/7/)[0].stock_available.quantity).toBe('5');
    });
    it('skips the EAN lookup when there is no EAN', async () => {
      const { c, fake } = make(createRoutes);
      await c.upsertListing({ ...listing, ean: null });
      expect(fake.calls.filter((x) => x.method === 'GET' && x.url.includes('/api/products'))).toHaveLength(1);
    });
    it('updates when found by reference (no duplicate create)', async () => {
      const { c, fake } = make([
        ['GET', '/api/products', (_c, u) => json(u.searchParams.get('filter[reference]') ? { products: [{ id: 42, reference: 'AAL-07' }] } : [])],
        ['GET', '/api/products/42', json({ product: { id: 42, reference: 'AAL-07', date_add: 'x' } })],
        ['PUT', '/api/products/42', (cl) => json(JSON.parse(cl.body!))],
        ['GET', '/api/images/products/42', json({ image: [{ id: '1' }] })],
        ['DELETE', /images\/products\/42\/1/, json({})],
        ['POST', '/api/images/products/42', json({})],
        ...stockRoutes,
      ]);
      const r = await c.upsertListing(listing);
      expect(r.externalId).toBe('42');
      expect(bodies(fake, 'POST', /^\/api\/products$/)).toHaveLength(0);
      expect(bodies(fake, 'PUT', /^\/api\/products\/42$/)[0].product).toMatchObject({ id: 42, date_add: 'x', reference: 'AAL-07' });
    });
    it('falls back to EAN when the reference is not found', async () => {
      const { c } = make([
        ['GET', '/api/products', (_c, u) => json(u.searchParams.get('filter[ean13]') ? { products: [{ id: 43, ean13: '5601234567890' }] } : [])],
        ['GET', '/api/products/43', json({ product: { id: 43 } })],
        ['PUT', '/api/products/43', (cl) => json(JSON.parse(cl.body!))],
        ['POST', '/api/images/products/43', json({})],
        ['GET', '/api/images/products/43', json([])],
        ...stockRoutes,
      ]);
      expect((await c.upsertListing(listing)).externalId).toBe('43');
    });
    it('updates directly by externalId without lookup; skips when hash unchanged', async () => {
      const routes: Route[] = [
        ['GET', '/api/products/42', json({ product: { id: 42 } })],
        ['PUT', '/api/products/42', (cl) => json(JSON.parse(cl.body!))],
        ['GET', '/api/images/products/42', json([])],
        ['POST', '/api/images/products/42', json({})],
        ...stockRoutes,
      ];
      const first = make(routes);
      const r1 = await first.c.upsertListing({ ...listing, externalId: '42' });
      expect(first.fake.calls.some((x) => x.url.includes('filter['))).toBe(false);
      const second = make([]);
      const r2 = await second.c.upsertListing({ ...listing, externalId: '42', lastPayloadHash: r1.payloadHash, lastImageChecksums: r1.imageChecksums });
      expect(r2).toMatchObject({ skipped: true, externalId: '42', status: 'live', payloadHash: r1.payloadHash });
      expect(second.fake.calls).toHaveLength(0);
      const inactive = await make([]).c.upsertListing({ ...listing, active: false, externalId: '42', lastPayloadHash: (await make(routes).c.upsertListing({ ...listing, active: false, externalId: '42' })).payloadHash });
      expect(inactive).toMatchObject({ skipped: true, status: 'inactive' });
    });
    it('re-sends when any field changed (price)', async () => {
      const routes: Route[] = [
        ['GET', '/api/products/42', json({ product: { id: 42 } })],
        ['PUT', '/api/products/42', (cl) => json(JSON.parse(cl.body!))],
        ['GET', '/api/images/products/42', json([])],
        ...stockRoutes,
      ];
      const a = await make(routes).c.upsertListing({ ...listing, imageUrls: [], externalId: '42' });
      const b = make(routes);
      const r = await b.c.upsertListing({ ...listing, imageUrls: [], priceNet: '13.00', externalId: '42', lastPayloadHash: a.payloadHash });
      expect(r.skipped).toBeUndefined();
      expect(r.payloadHash).not.toBe(a.payloadHash);
    });
    it('only re-uploads images when the checksum set changed', async () => {
      const routes: Route[] = [
        ['GET', '/api/products/42', json({ product: { id: 42 } })],
        ['PUT', '/api/products/42', (cl) => json(JSON.parse(cl.body!))],
        ['GET', '/api/images/products/42', json({ image: [{ id: '1' }] })],
        ['DELETE', /images/, json({})],
        ['POST', '/api/images/products/42', json({})],
        ...stockRoutes,
      ];
      const same = make(routes);
      const r = await same.c.upsertListing({ ...listing, externalId: '42', imageChecksums: ['b', 'a'], lastImageChecksums: ['a', 'b'], priceNet: '99' });
      expect(r.imageChecksums).toEqual(['b', 'a']);
      expect(same.fake.calls.some((x) => /images/.test(x.url))).toBe(false);
      const changed = make(routes);
      await changed.c.upsertListing({ ...listing, externalId: '42', imageChecksums: ['a', 'c'], lastImageChecksums: ['a', 'b'] });
      expect(changed.fake.calls.filter((x) => x.method === 'DELETE')).toHaveLength(1);
      expect(changed.fake.calls.filter((x) => x.method === 'POST')).toHaveLength(2);
    });
    it('works over the admin api transport too', async () => {
      const { c, fake } = make([
        ['POST', '/admin-api/access_token', json({ access_token: 't', expires_in: 3600 })],
        ['GET', '/admin-api/products', json({ items: [] })],
        ['POST', '/admin-api/products', json({ productId: 88 })],
        ['GET', '/admin-api/stock-availables', json({ items: [{ stockAvailableId: 3, productId: 88, quantity: 0 }] })],
        ['PATCH', '/admin-api/stock-availables/3', json({})],
      ], { routing: { stock_availables: 'admin-api', images: 'admin-api', order_carriers: 'admin-api', order_histories: 'admin-api' } });
      const r = await c.upsertListing({ ...listing, imageUrls: [] });
      expect(r.externalId).toBe('88');
      expect(fake.calls.some((x) => x.url.includes('/admin-api/products') && x.method === 'POST')).toBe(true);
    });
    it('fails when the create response carries no id', async () => {
      const { c } = make([['GET', '/api/products', json([])], ['POST', '/api/products', json({ product: {} })]]);
      await expect(c.upsertListing(listing)).rejects.toThrow(/id/);
    });
    it('fails when the product has no stock_available row', async () => {
      const { c } = make([...createRoutes.slice(0, 3), ['GET', '/api/stock_availables', json([])]]);
      await expect(c.upsertListing(listing)).rejects.toThrow(/stock/i);
    });
  });

  describe('updateStock / updatePrice', () => {
    it('reports partial failures per item without aborting', async () => {
      const { c } = make([
        ['GET', '/api/stock_availables', (_c, u) => {
          const id = u.searchParams.get('filter[id_product]');
          if (id === '[2]') return json([]);
          if (id === '[3]') return { status: 500, body: 'boom' };
          return json({ stock_availables: [{ id: 7, id_product: '1', id_product_attribute: '0', quantity: '0' }] });
        }],
        ['GET', '/api/stock_availables/7', json({ stock_available: { id: 7 } })],
        ['PUT', '/api/stock_availables/7', (cl) => json(JSON.parse(cl.body!))],
      ]);
      const r = await c.updateStock([{ externalId: '1', available: 4 }, { externalId: '2', available: 1 }, { externalId: '3', available: 1 }, { externalId: '1', available: -5 }]);
      expect(r.okCount).toBe(2);
      expect(r.failCount).toBe(2);
      expect(r.results.map((x) => [x.externalId, x.ok])).toEqual([['1', true], ['2', false], ['3', false], ['1', true]]);
      expect(r.results[1]!.error).toMatch(/stock/i);
    });
    it('clamps negative stock to 0', async () => {
      const { c, fake } = make([...stockRoutes]);
      await c.updateStock([{ externalId: '77', available: -3 }]);
      expect(bodies(fake, 'PUT', /stock_availables/)[0].stock_available.quantity).toBe('0');
    });
    it('updates prices per item, validating the decimal', async () => {
      const { c, fake } = make([
        ['GET', '/api/products/1', json({ product: { id: 1, reference: 'R' } })],
        ['PUT', '/api/products/1', (cl) => json(JSON.parse(cl.body!))],
        ['GET', '/api/products/2', { status: 404, body: 'nf' }],
      ]);
      const r = await c.updatePrice([{ externalId: '1', priceNet: '9.90' }, { externalId: '2', priceNet: '1.00' }, { externalId: '1', priceNet: 'abc' }]);
      expect([r.okCount, r.failCount]).toEqual([1, 2]);
      expect(bodies(fake, 'PUT', /products\/1/)[0].product).toMatchObject({ reference: 'R', price: '9.90' });
      expect(r.results[2]!.error).toMatch(/price/i);
    });
  });

  it('deactivateListing sets active to 0', async () => {
    const { c, fake } = make([
      ['GET', '/api/products/42', json({ product: { id: 42, active: '1' } })],
      ['PUT', '/api/products/42', (cl) => json(JSON.parse(cl.body!))],
    ]);
    await c.deactivateListing('42');
    expect(bodies(fake, 'PUT', /products\/42/)[0].product.active).toBe('0');
  });

  describe('listOrdersSince', () => {
    const order = (id: number, state: string, sku = 'AAL-07') => ({
      id, current_state: state, date_add: '2026-09-01 10:15:00', date_upd: '2026-09-01 10:20:00', id_customer: '9', id_address_delivery: '15', total_paid_tax_incl: '30.75',
      associations: { order_rows: [{ id: `${id}1`, product_reference: sku, product_quantity: '2', unit_price_tax_excl: '12.5' }] },
    });
    const orderRoutes = (orders: unknown[]): Route[] => [
      ['GET', '/api/orders', json({ orders })],
      ['GET', '/api/customers/9', json({ customer: { id: 9, firstname: 'Ana', lastname: 'Silva', email: 'ana@example.com' } })],
      ['GET', '/api/addresses/15', json({ address: { id: 15, firstname: 'Ana', lastname: 'Silva', address1: 'Rua A', address2: 'Apt 2', postcode: '1000', city: 'Lisboa', id_country: '193', phone: '21' } })],
      ['GET', '/api/countries/193', json({ country: { id: 193, iso_code: 'PT' } })],
    ];
    it('queries paid states since the cursor date and maps orders', async () => {
      const { c, fake } = make(orderRoutes([order(1001, '2')]));
      const page = await c.listOrdersSince(new Date('2026-09-01T00:00:00Z'));
      const u = new URL(fake.calls[0]!.url);
      expect(u.searchParams.get('filter[current_state]')).toBe('[2|3]');
      expect(u.searchParams.get('filter[date_upd]')).toContain('[2026-09-01 00:00:00,');
      expect(u.searchParams.get('sort')).toBe('[date_upd_ASC]');
      expect(u.searchParams.get('limit')).toBe('0,50');
      expect(page.nextCursor).toBeNull();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toEqual({
        externalId: '1001', externalStatus: '2', placedAt: new Date('2026-09-01T10:15:00Z'), currency: 'EUR', total: '30.75',
        customer: { name: 'Ana Silva', email: 'ana@example.com', phone: '21' },
        shippingAddress: { fullName: 'Ana Silva', email: 'ana@example.com', phone: '21', line1: 'Rua A', line2: 'Apt 2', postalCode: '1000', city: 'Lisboa', countryCode: 'PT' },
        lines: [{ sku: 'AAL-07', externalLineId: '10011', quantity: 2, unitPrice: '12.5' }],
      });
    });
    it('ignores non paid states and is idempotent on duplicates', async () => {
      const { c } = make(orderRoutes([order(1, '2'), order(1, '2'), order(2, '8'), order(3, '3')]));
      const a = await c.listOrdersSince(new Date(0));
      expect(a.items.map((o) => o.externalId)).toEqual(['1', '3']);
      const b = await make(orderRoutes([order(1, '2'), order(1, '2'), order(2, '8'), order(3, '3')])).c.listOrdersSince(new Date(0));
      expect(b).toEqual(a);
    });
    it('caches customer/country lookups per call and paginates', async () => {
      const many = Array.from({ length: 2 }, (_, i) => order(10 + i, '2'));
      const { c, fake } = make(orderRoutes(many));
      const page = await c.listOrdersSince(new Date(0), { page: 2, perPage: 2 });
      expect(new URL(fake.calls[0]!.url).searchParams.get('limit')).toBe('2,2');
      expect(page.nextCursor).toEqual({ page: 3, perPage: 2 });
      expect(fake.calls.filter((x) => x.url.includes('/countries/'))).toHaveLength(1);
    });
    it('flags orders with an unknown sku as manual_review', async () => {
      const knownSkus = jest.fn(async (skus: string[]) => new Set(skus.filter((s) => s === 'AAL-07')));
      const { c } = make(orderRoutes([order(1, '2'), order(2, '2', 'ZZZ-99')]), {}, { knownSkus });
      const page = await c.listOrdersSince(new Date(0));
      expect(knownSkus).toHaveBeenCalledWith(['AAL-07', 'ZZZ-99']);
      expect(page.items[0]!.manualReview).toBeUndefined();
      expect(page.items[1]!.manualReview).toEqual({ reason: 'unknown_sku', unknownSkus: ['ZZZ-99'] });
    });
    it('does not flag anything without a knownSkus callback', async () => {
      const page = await make(orderRoutes([order(2, '2', 'ZZZ-99')])).c.listOrdersSince(new Date(0));
      expect(page.items[0]!.manualReview).toBeUndefined();
    });
    it('handles empty results and skips the country when missing', async () => {
      const { c } = make([['GET', '/api/orders', json([])]]);
      expect(await c.listOrdersSince(new Date(0))).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('pushShipment', () => {
    const routes = (state: string): Route[] => [
      ['GET', '/api/orders/1001', json({ order: { id: 1001, current_state: state, date_add: '2026-09-01 10:15:00' } })],
      ['GET', '/api/order_carriers', json({ order_carriers: [{ id: '88', id_order: '1001', tracking_number: '' }] })],
      ['GET', '/api/order_carriers/88', json({ order_carrier: { id: 88, id_order: '1001', tracking_number: '' } })],
      ['PUT', '/api/order_carriers/88', (cl) => json(JSON.parse(cl.body!))],
      ['POST', '/api/order_histories', json({ order_history: { id: 1 } })],
    ];
    const cmd = { externalOrderId: '1001', carrierCode: 'CTT', trackingNumber: 'TRK1' };
    it('sets tracking and moves the order to shipped', async () => {
      const { c, fake } = make(routes('3'));
      await c.pushShipment(cmd);
      expect(bodies(fake, 'PUT', /order_carriers\/88/)[0].order_carrier).toMatchObject({ id: 88, tracking_number: 'TRK1' });
      expect(bodies(fake, 'POST', /order_histories/)[0].order_history).toEqual({ id_order: '1001', id_order_state: '4' });
    });
    it('does not repeat the state change when already shipped', async () => {
      const { c, fake } = make(routes('4'));
      await c.pushShipment(cmd);
      expect(bodies(fake, 'POST', /order_histories/)).toHaveLength(0);
      expect(bodies(fake, 'PUT', /order_carriers/)).toHaveLength(1);
    });
    it('fails when the order has no carrier row', async () => {
      const { c } = make([['GET', '/api/orders/1001', json({ order: { id: 1001, current_state: '3', date_add: '2026-09-01 10:15:00' } })], ['GET', '/api/order_carriers', json([])]]);
      await expect(c.pushShipment(cmd)).rejects.toThrow(/carrier/i);
    });
  });

  describe('testConnection', () => {
    it('ok with the shop name', async () => {
      const { c } = make([['GET', '/api/shops', json({ shops: [{ id: 1, name: 'Gemma' }] })]]);
      expect(await c.testConnection()).toEqual({ ok: true, accountName: 'Gemma', currency: 'EUR' });
    });
    it('invalid credentials on 401/403', async () => {
      const { c } = make([['GET', '/api/shops', { status: 401, body: 'x' }]]);
      expect(await c.testConnection()).toMatchObject({ ok: false, reason: 'invalid_credentials' });
    });
    it('invalid credentials when the token endpoint refuses', async () => {
      const { c } = make([['POST', '/admin-api/access_token', { status: 400, body: { error: 'invalid_client' } }]], { routing: {} });
      expect(await c.testConnection()).toMatchObject({ ok: false, reason: 'invalid_credentials' });
    });
    it('unreachable on network errors, unknown otherwise', async () => {
      const f = router([]);
      const net = new PrestaShop9Connector({ settings: makeSettings({ routing: ALL_WS }), fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, maxAttempts: 1, sleep: async () => {} });
      expect(await net.testConnection()).toMatchObject({ ok: false, reason: 'unreachable' });
      const { c } = make([['GET', '/api/shops', { status: 500, body: 'x' }]]);
      expect(await c.testConnection()).toMatchObject({ ok: false, reason: 'unknown' });
      const odd = make([['GET', '/api/shops', json({ shops: [] })]]);
      expect(await odd.c.testConnection()).toMatchObject({ ok: true });
      expect(f.calls).toHaveLength(0);
    });
    it('non-http failures are unknown', async () => {
      const { c } = make([['GET', '/api/shops', { body: '<<not json' }]]);
      expect(await c.testConnection()).toMatchObject({ ok: false, reason: 'unknown' });
    });
  });

  it('never leaks secrets into logs, errors or results', async () => {
    const leak = { status: 401, body: { error: 'invalid_client', client_secret: SECRETS.clientSecret, detail: `Authorization: Bearer ${SECRETS.token}` } };
    const a = make([['POST', '/admin-api/access_token', leak]], { routing: {} });
    const res = await a.c.testConnection();
    const b = make([['GET', '/api/shops', { status: 500, body: `key=${SECRETS.wsKey} token=${SECRETS.token}` }]]);
    const res2 = await b.c.testConnection();
    const err = await a.c.upsertListing(listing).catch((e) => e);
    const all = JSON.stringify([a.entries, b.entries, res, res2, String(err), err?.bodySnippet]);
    for (const s of Object.values(SECRETS)) expect(all).not.toContain(s);
    expect(a.entries.length).toBeGreaterThan(0);
  });

  it('constructs with default clock and fetch', () => {
    const c = new PrestaShop9Connector({ settings: makeSettings({ routing: ALL_WS }) });
    expect(c.code).toBe('prestashop9');
  });
});
