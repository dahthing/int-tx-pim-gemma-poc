import { HttpStatusError, type RequestLogEntry } from '@repo/http-client';
import { AwAikuConnector } from './aw-aiku.connector';
import { ok, routedFetch } from './__fixtures__/load';

const TOKEN = 'sekret-token-123';
const noSleep = async () => {};
const make = (fetchImpl: any, extra: object = {}) =>
  new AwAikuConnector({ token: TOKEN, environment: 'production', fetchImpl, sleep: noSleep, requestsPerSecond: 100000, maxAttempts: 2, ...extra });

describe('AwAikuConnector basics', () => {
  it('has code and capabilities', () => {
    const c = make(routedFetch({}));
    expect(c.code).toBe('aw-aiku');
    expect(c.capabilities()).toMatchObject({ catalogRead: true, dropshipOrderWrite: true, trackingRead: false });
  });

  it('sends bearer + accept and picks base URL by environment', async () => {
    const f = routedFetch({ 'GET /user-profile': ok('user-profile.json') });
    await make(f).testConnection();
    expect(f.calls[0]!.url).toBe('https://api.aiku.io/user-profile');
    expect(f.calls[0]!.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(f.calls[0]!.headers['accept']).toBe('application/json');
    const f2 = routedFetch({ 'GET /user-profile': ok('user-profile.json') });
    await new AwAikuConnector({ token: TOKEN, environment: 'staging', fetchImpl: f2, requestsPerSecond: 100000 }).testConnection();
    expect(f2.calls[0]!.url).toBe('https://api.aiku-sandbox.uk/user-profile');
  });

  it('testConnection ok on 200', async () => {
    const f = routedFetch({ 'GET /user-profile': ok('user-profile.json') });
    expect(await make(f).testConnection()).toEqual({ ok: true, accountName: 'Gemma Mystical Store', currency: 'EUR', balance: '120.50' });
  });
  it('testConnection: minimal profile still ok', async () => {
    const f = routedFetch({ 'GET /user-profile': { body: { data: {} } } });
    expect(await make(f).testConnection()).toEqual({ ok: true });
  });
  it('invalid_credentials on 401 without throwing, token absent from logs', async () => {
    const entries: RequestLogEntry[] = [];
    const f = routedFetch({ 'GET /user-profile': { status: 401, body: { message: `Unauthenticated ${TOKEN}` } } });
    const r = await make(f, { sink: { log: (e: RequestLogEntry) => void entries.push(e) } }).testConnection();
    expect(r).toMatchObject({ ok: false, reason: 'invalid_credentials' });
    expect(JSON.stringify([entries, r])).not.toContain(TOKEN);
    expect(entries.length).toBe(1);
  });
  it('unreachable on network error, unknown on 500; no token in message', async () => {
    const net = routedFetch({ 'GET /user-profile': { error: new Error(`boom ${TOKEN}`) } });
    const r1 = await make(net, { maxAttempts: 1 }).testConnection();
    expect(r1).toMatchObject({ ok: false, reason: 'unreachable' });
    const five = routedFetch({ 'GET /user-profile': { status: 500, body: 'x' } });
    const r2 = await make(five, { maxAttempts: 1 }).testConnection();
    expect(r2).toMatchObject({ ok: false, reason: 'unknown' });
    expect(JSON.stringify([r1, r2])).not.toContain(TOKEN);
  });

  it('errors thrown by other calls never contain the token', async () => {
    const f = routedFetch({ 'GET /dropshipping/products': { status: 500, body: `Bearer ${TOKEN}` } });
    const err = await make(f, { maxAttempts: 1 }).listCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect(String(err.message) + String(err.bodySnippet)).not.toContain(TOKEN);
  });
});

describe('catalogue pagination', () => {
  it('requests include + per_page (default 50, clamped to 150) and returns next cursor', async () => {
    const f = routedFetch({ 'GET /dropshipping/products': ok('products-page-1.json') });
    const page = await make(f).listCatalog();
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('include')).toBe('department,sub_department,family');
    expect(url.searchParams.get('per_page')).toBe('50');
    expect(url.searchParams.get('page')).toBe('1');
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toEqual({ page: 2, perPage: 50 });
    await make(f).listCatalog({ page: 2, perPage: 999 });
    expect(new URL(f.calls[1]!.url).searchParams.get('per_page')).toBe('150');
    await make(f, { perPage: 0 }).listCatalog();
    expect(new URL(f.calls[2]!.url).searchParams.get('per_page')).toBe('1');
  });

  it('walkCatalog walks 3 pages and stops on links.next=null', async () => {
    const f = routedFetch({
      'GET /dropshipping/products': (call) => {
        const p = new URL(call.url).searchParams.get('page');
        return ok(`products-page-${p}.json`);
      },
    });
    const items: string[] = [];
    for await (const p of make(f).walkCatalog()) items.push(...p.items.map((i) => i.code));
    expect(items).toEqual(['AAL-07', 'AAL-08', 'AAL-09', 'AAL-10']);
    expect(f.calls).toHaveLength(3);
  });

  it('stops when current_page >= last_page even if links.next is set', async () => {
    const body = { data: [], links: { next: 'x' }, meta: { current_page: 2, last_page: 2 } };
    const f = routedFetch({ 'GET /dropshipping/products': { body } });
    expect((await make(f).listCatalog({ page: 2 })).nextCursor).toBeNull();
  });

  it('a failing page propagates after earlier pages were yielded (partial)', async () => {
    const f = routedFetch({
      'GET /dropshipping/products': (call) =>
        new URL(call.url).searchParams.get('page') === '1' ? ok('products-page-1.json') : { status: 400, body: {} },
    });
    const seen: number[] = [];
    await expect(
      (async () => { for await (const p of make(f).walkCatalog()) seen.push(p.page); })(),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(seen).toEqual([1]);
  });
});

describe('portfolio', () => {
  it('addToAssortment returns external_portfolio_id 3761386', async () => {
    const f = routedFetch({ 'POST /dropshipping/products/my-products/1201/store': ok('my-products-store.json') });
    const r = await make(f).addToAssortment('1201');
    expect(r).toMatchObject({ externalPortfolioId: '3761386', itemId: '77001', code: 'AAL-07', status: 'active' });
  });
  it('listAssortment maps items and cursor', async () => {
    const f = routedFetch({ 'GET /dropshipping/products/my-products': ok('my-products.json') });
    const p = await make(f).listAssortment();
    expect(p.items[0]!.externalPortfolioId).toBe('3761386');
    expect(p.nextCursor).toBeNull();
  });
  it('delete treats "Portfolio has been deleted." as success', async () => {
    const f = routedFetch({ 'DELETE /dropshipping/products/my-products/3761386/delete': ok('my-products-delete.json') });
    await expect(make(f).removeFromAssortment('3761386')).resolves.toBeUndefined();
    expect(await make(f).removeFromAssortmentWithStatus('3761386')).toBe('deleted');
  });
  it('disable response is success with status disabled', async () => {
    const f = routedFetch({ 'DELETE /dropshipping/products/my-products/3761386/delete': ok('my-products-disable.json') });
    await expect(make(f).removeFromAssortment('3761386')).resolves.toBeUndefined();
    expect(await make(f).removeFromAssortmentWithStatus('3761386')).toBe('disabled');
  });
  it('delete failure surfaces', async () => {
    const f = routedFetch({});
    await expect(make(f).removeFromAssortment('1')).rejects.toBeInstanceOf(HttpStatusError);
  });
});

describe('media', () => {
  it('lists with id+type and maps products->product, assortment->portfolio', async () => {
    const f = routedFetch({ 'GET /dropshipping/images': ok('images.json') });
    const m = await make(f).listMedia({ kind: 'assortment', id: '3761386' });
    expect(m).toHaveLength(1);
    const q = new URL(f.calls[0]!.url).searchParams;
    expect([q.get('id'), q.get('type')]).toEqual(['3761386', 'portfolio']);
    await make(f).listMedia({ kind: 'product', id: '1201' });
    expect(new URL(f.calls[1]!.url).searchParams.get('type')).toBe('product');
  });
});

describe('getSupplierOrder', () => {
  const routes = (order: string, tx: string) => ({
    'GET /dropshipping/order/9001': ok(order),
    'GET /dropshipping/order/9001/transactions': ok(tx),
  });
  it('maps state, totals, lines; tracking null; no alert', async () => {
    const s = await make(routedFetch(routes('order-get.json', 'transactions.json'))).getSupplierOrder('9001');
    expect(s).toMatchObject({ externalId: '9001', state: 'creating', totalAmount: '12.4', tracking: null, alert: false });
    expect(s.lines).toHaveLength(2);
  });
  it('raises alert when quantity_fail or quantity_cancelled > 0', async () => {
    const s = await make(routedFetch(routes('order-get.json', 'transactions-fail.json'))).getSupplierOrder('9001');
    expect(s.alert).toBe(true);
    const only = await make(routedFetch(routes('order-get.json', 'transactions-fail.json'))).getSupplierOrder('9001');
    expect(only.lines[1]!.quantityCancelled).toBe(1);
  });
  it('maps optional tracking defensively', async () => {
    const s = await make(routedFetch(routes('order-get-dispatched.json', 'transactions.json'))).getSupplierOrder('9001');
    expect(s.tracking).toEqual({ trackingNumber: 'RR123456789PT', carrierName: 'CTT' });
    expect(s.state).toBe('dispatched');
  });
  it('tracking without carrier', async () => {
    const f = routedFetch({
      'GET /dropshipping/order/9001': { body: { data: { id: 9001, state: 'dispatched', tracking_number: 'T1' } } },
      'GET /dropshipping/order/9001/transactions': { body: { data: [] } },
    });
    expect((await make(f).getSupplierOrder('9001')).tracking).toEqual({ trackingNumber: 'T1' });
  });
});
