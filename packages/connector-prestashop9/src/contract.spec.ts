import { DIALECTS } from './endpoints';
import { normalizeAddress, normalizeCountry, normalizeCustomer, normalizeOrder, parseProductRecord, parseStockRecord, parseToken } from './mapper';
import { fixtureNames, loadFixture } from './__fixtures__/support';

const PREFIX = { admin: '/admin-api', ws: '/api' };
const replay: Record<string, (kind: 'admin-api' | 'webservice', input: any) => unknown> = {
  productList: (k, i) => DIALECTS(PREFIX).get(k).unwrapList('products', i).map((r) => parseProductRecord(k, r)),
  stockList: (k, i) => DIALECTS(PREFIX).get(k).unwrapList('stock_availables', i).map((r) => parseStockRecord(k, r)),
  order: (k, i) => normalizeOrder(k, DIALECTS(PREFIX).get(k).unwrapOne('orders', i)),
  customer: (k, i) => normalizeCustomer(k, DIALECTS(PREFIX).get(k).unwrapOne('customers', i)),
  address: (k, i) => normalizeAddress(k, DIALECTS(PREFIX).get(k).unwrapOne('addresses', i)),
  country: (k, i) => normalizeCountry(k, DIALECTS(PREFIX).get(k).unwrapOne('countries', i)),
  token: (_k, i) => parseToken(i),
};

describe('contract: recorded fixtures replay through the mappers', () => {
  const names = fixtureNames();
  it('finds fixtures', () => expect(names.length).toBeGreaterThan(5));
  it.each(names)('%s', (name) => {
    const fx = loadFixture(name);
    expect(replay[fx.mapper]).toBeDefined();
    expect(replay[fx.mapper]!(fx.kind, fx.input)).toEqual(fx.expected);
  });
});
