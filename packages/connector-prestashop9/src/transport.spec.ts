import { ResilientHttpClient } from '@repo/http-client';
import { DEFAULT_ROUTING } from './endpoints';
import { TransportRouter } from './transport';
import { ALL_WS, SECRETS, json, makeSettings, router } from './__fixtures__/support';
import type { FakeFetch } from '@repo/http-client';

function build(fake: FakeFetch, over = {}) {
  const http = new ResilientHttpClient({ connector: 'ps9', baseUrl: 'https://shop.example.com', fetchImpl: fake, maxAttempts: 1, sleep: async () => {} });
  return new TransportRouter(makeSettings(over), http, () => 0);
}
const tokenRoute = ['POST', '/admin-api/access_token', json({ access_token: SECRETS.token, expires_in: 3600 })] as const;

describe('TransportRouter', () => {
  it('has a default routing table covering every resource', () => {
    expect(DEFAULT_ROUTING.products).toBe('admin-api');
    expect(DEFAULT_ROUTING.stock_availables).toBe('webservice');
  });
  it('routing is configurable per resource', () => {
    const r = build(router([]), { routing: { products: 'webservice', stock_availables: 'admin-api' } });
    expect(r.for('products').kind).toBe('webservice');
    expect(r.for('stock_availables').kind).toBe('admin-api');
    expect(r.for('orders').kind).toBe('admin-api');
  });
  it('fails fast when a routed transport has no credentials', () => {
    expect(() => build(router([]), { webservice: undefined })).toThrow(/webservice/);
    expect(() => build(router([]), { adminApi: undefined, routing: ALL_WS })).not.toThrow();
    expect(() => build(router([]), { adminApi: undefined })).toThrow(/admin/i);
  });
  it('webservice: basic auth, json output, filters, update = GET merge + PUT', async () => {
    const fake = router([
      ['GET', '/api/products', (_c, u) => (u.searchParams.get('filter[reference]') === '[A1]' ? json({ products: [{ id: 5, reference: 'A1' }] }) : json([]))],
      ['GET', '/api/products/5', json({ product: { id: 5, reference: 'A1', price: '1' } })],
      ['PUT', '/api/products/5', (c) => json(JSON.parse(c.body!))],
    ]);
    const t = build(fake, { routing: ALL_WS }).for('products');
    expect(await t.list('products', { filter: { reference: 'A1' }, limit: 10, offset: 20, sort: 'id_ASC' })).toEqual([{ id: 5, reference: 'A1' }]);
    expect(await t.list('products', { filter: { reference: 'nope' } })).toEqual([]);
    const c0 = fake.calls[0]!;
    const u = new URL(c0.url);
    expect(u.searchParams.get('output_format')).toBe('JSON');
    expect(u.searchParams.get('display')).toBe('full');
    expect(u.searchParams.get('limit')).toBe('20,10');
    expect(u.searchParams.get('sort')).toBe('[id_ASC]');
    expect(c0.headers.authorization).toBe(`Basic ${Buffer.from(`${SECRETS.wsKey}:`).toString('base64')}`);
    const out = await t.update('products', '5', { price: '2' });
    const put = fake.calls.at(-1)!;
    expect(put.method).toBe('PUT');
    expect(JSON.parse(put.body!)).toEqual({ product: { id: 5, reference: 'A1', price: '2' } });
    expect(out).toEqual({ id: 5, reference: 'A1', price: '2' });
  });
  it('webservice create wraps the body and unwraps the response; remove works', async () => {
    const fake = router([
      ['POST', '/api/products', (c) => json({ product: { id: 9, ...JSON.parse(c.body!).product } })],
      ['DELETE', '/api/products/9', json({})],
    ]);
    const t = build(fake, { routing: ALL_WS }).for('products');
    expect(await t.create('products', { reference: 'Z' })).toEqual({ id: 9, reference: 'Z' });
    await t.remove('products', '9');
    expect(fake.calls.at(-1)!.method).toBe('DELETE');
  });
  it('webservice multi value and date range filters', async () => {
    const fake = router([['GET', '/api/orders', json([])]]);
    const t = build(fake, { routing: ALL_WS }).for('orders');
    await t.list('orders', { filter: { current_state: ['2', '3'] }, since: { field: 'date_upd', value: '2026-09-01 00:00:00' } });
    const u = new URL(fake.calls[0]!.url);
    expect(u.searchParams.get('filter[current_state]')).toBe('[2|3]');
    expect(u.searchParams.get('filter[date_upd]')).toBe('[2026-09-01 00:00:00,2999-12-31 23:59:59]');
    expect(u.searchParams.get('date')).toBe('1');
  });
  it('admin api: bearer token, PATCH update, items envelope', async () => {
    const fake = router([
      tokenRoute as any,
      ['GET', '/admin-api/products', json({ items: [{ productId: 5 }] })],
      ['PATCH', '/admin-api/products/5', (c) => json(JSON.parse(c.body!))],
    ]);
    const t = build(fake).for('products');
    expect(await t.list('products', { filter: { reference: 'A1' }, limit: 5, offset: 5 })).toEqual([{ productId: 5 }]);
    const api = fake.calls.find((c) => c.url.includes('/admin-api/products?'))!;
    expect(api.headers.authorization).toBe(`Bearer ${SECRETS.token}`);
    const u = new URL(api.url);
    expect(u.searchParams.get('limit')).toBe('5');
    expect(u.searchParams.get('offset')).toBe('5');
    expect(u.searchParams.get('output_format')).toBeNull();
    expect(await t.update('products', '5', { price: 2 })).toEqual({ price: 2 });
    expect(fake.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });
  it('admin api: a 401 refreshes the token once and retries', async () => {
    let tokens = 0;
    let first = true;
    const fake = router([
      ['POST', '/admin-api/access_token', () => json({ access_token: `t${++tokens}`, expires_in: 3600 })],
      ['GET', '/admin-api/products/5', (c) => { if (first) { first = false; return { status: 401, body: 'nope' }; } return json({ productId: 5, auth: c.headers.authorization }); }],
    ]);
    const t = build(fake).for('products');
    expect(await t.get('products', '5')).toEqual({ productId: 5, auth: 'Bearer t2' });
    expect(tokens).toBe(2);
  });
  it('a second 401 is surfaced', async () => {
    const fake = router([tokenRoute as any, ['GET', /products/, { status: 401, body: 'nope' }]]);
    await expect(build(fake).for('products').get('products', '5')).rejects.toMatchObject({ status: 401 });
  });
  it('image helpers per dialect', async () => {
    const fake = router([
      ['GET', '/api/images/products/5', json({ image: [{ id: '11' }, { id: '12' }] })],
      ['POST', '/api/images/products/5', json({})],
      ['DELETE', '/api/images/products/5/11', json({})],
      tokenRoute as any,
      ['GET', '/admin-api/products/5/images', json({ items: [{ imageId: 21 }] })],
      ['POST', '/admin-api/products/5/images', json({})],
      ['DELETE', '/admin-api/products/5/images/21', json({})],
    ]);
    const ws = build(fake, { routing: ALL_WS }).for('images');
    expect(await ws.listImages('5')).toEqual(['11', '12']);
    await ws.addImage('5', 'https://cdn/x.jpg');
    expect(JSON.parse(fake.calls.at(-1)!.body!)).toEqual({ url: 'https://cdn/x.jpg' });
    await ws.removeImage('5', '11');
    const ad = build(fake, { routing: { images: 'admin-api' } }).for('images');
    expect(await ad.listImages('5')).toEqual(['21']);
    await ad.addImage('5', 'https://cdn/x.jpg');
    await ad.removeImage('5', '21');
    expect(fake.calls.at(-1)!.method).toBe('DELETE');
  });
});
