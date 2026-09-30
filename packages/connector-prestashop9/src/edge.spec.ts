import { ResilientHttpClient, NetworkError } from '@repo/http-client';
import { TokenProvider, TokenRequestError } from './token-provider';
import { normalizeAddress, normalizeCustomer, normalizeOrder, parseProductRecord, parseStockRecord, parseCarrierRecord, trackingBody, orderHistoryBody } from './mapper';
import { PrestaShop9Connector } from './connector';
import { ALL_WS, json, makeSettings, router } from './__fixtures__/support';

const tp = (fetchImpl: any) =>
  new TokenProvider({ http: new ResilientHttpClient({ connector: 'x', fetchImpl, maxAttempts: 1, sleep: async () => {} }), tokenUrl: 'https://s/t', clientId: 'a', clientSecret: 'b' });

describe('edge cases', () => {
  it('token: network errors pass through, garbage bodies become TokenRequestError', async () => {
    await expect(tp(async () => { throw new Error('down'); }).getToken()).rejects.toBeInstanceOf(NetworkError);
    await expect(tp(router([['POST', /.*/, { body: '{}' }]])).getToken()).rejects.toBeInstanceOf(TokenRequestError);
    expect(new TokenRequestError(undefined).message).not.toContain('HTTP');
    expect(await tp(router([['POST', /.*/, json({ access_token: 'z' })]])).getToken()).toBe('z');
  });
  it('mappers tolerate sparse records', () => {
    expect(normalizeCustomer('webservice', {})).toEqual({ name: '', email: null });
    expect(normalizeAddress('admin-api', {})).toMatchObject({ fullName: '', line1: '', countryId: '', phone: null });
    expect(normalizeAddress('webservice', { phone_mobile: '9' }).phone).toBe('9');
    expect(normalizeOrder('admin-api', { orderId: 1, currentState: 1, dateAdd: '2026-01-01 00:00:00' }).total).toBeUndefined();
    expect(parseProductRecord('admin-api', { id: 3 }).id).toBe('3');
    expect(() => parseProductRecord('webservice', {})).toThrow(/id/);
    expect(parseStockRecord('admin-api', { id: 1, productId: 2, quantity: 3 }).id).toBe('1');
    expect(parseCarrierRecord('admin-api', { orderCarrierId: 4 }).id).toBe('4');
    expect(trackingBody('admin-api', 'T')).toEqual({ trackingNumber: 'T' });
    expect(orderHistoryBody('admin-api', '5', 4)).toEqual({ orderId: 5, orderStateId: 4 });
    expect(normalizeOrder('webservice', { id: 1, current_state: 2, date_add: '2026-01-01 00:00:00', id_customer: 1, id_address_delivery: 2, total_paid_tax_incl: 1 }).customerId).toBe('1');
    expect(normalizeOrder('admin-api', { orderId: 1, currentState: 2, dateAdd: '2026-01-01 00:00:00', customerId: 1, deliveryAddressId: 2, totalPaidTaxIncl: 1, rows: [{ orderDetailId: 1, productReference: 'a', quantity: 1 }] }).lines[0]!.unitPrice).toBeUndefined();
  });
  it('orders without customer/address ids still map', async () => {
    const c = new PrestaShop9Connector({
      settings: makeSettings({ routing: ALL_WS }), maxAttempts: 1, sleep: async () => {},
      fetchImpl: router([['GET', '/api/orders', json({ orders: [{ id: 1, current_state: '2', date_add: '2026-09-01 10:00:00' }] })]]),
    });
    const p = await c.listOrdersSince(new Date(0));
    expect(p.items[0]).toMatchObject({ total: '0', shippingAddress: { countryCode: '', line1: '' } });
  });
  it('testConnection maps 403 and a shop without name', async () => {
    const mk = (step: any) => new PrestaShop9Connector({ settings: makeSettings({ routing: ALL_WS }), maxAttempts: 1, sleep: async () => {}, fetchImpl: router([['GET', '/api/shops', step]]) });
    expect(await mk({ status: 403, body: 'x' }).testConnection()).toMatchObject({ reason: 'invalid_credentials' });
    expect(await mk(json({ shops: [{ id: 1 }] })).testConnection()).toEqual({ ok: true, accountName: undefined, currency: 'EUR' });
  });
  it('empty 200 bodies are tolerated on write', async () => {
    const c = new PrestaShop9Connector({
      settings: makeSettings({ routing: ALL_WS }), maxAttempts: 1, sleep: async () => {},
      fetchImpl: router([['GET', '/api/products/1', json({ product: { id: 1 } })], ['PUT', '/api/products/1', { status: 200 }]]),
    });
    await expect(c.deactivateListing('1')).resolves.toBeUndefined();
  });
});
