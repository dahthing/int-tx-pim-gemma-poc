import type { PlaceDropshipOrderCommand } from '@repo/connector-contracts';
import { AwAikuConnector } from './aw-aiku.connector';
import { loadFixture, ok, routedFetch, type Route } from './__fixtures__/load';

const noSleep = async () => {};
const cmd = (over: Partial<PlaceDropshipOrderCommand> = {}): PlaceDropshipOrderCommand => ({
  channelCode: 'PS9',
  channelOrderId: '1001',
  recipient: {
    fullName: 'Ana Silva', email: 'ana@example.com', phone: '+351900000000',
    line1: 'Rua das Flores 10', postalCode: '1000-001', city: 'Lisboa', countryCode: 'PT',
  },
  lines: [{ externalPortfolioId: '3761386', quantity: 2 }, { externalPortfolioId: '3761387', quantity: 1 }],
  maxSupplierCost: '20.00',
  tenantDefaults: { email: 'orders@gemma.test', phone: '+351911111111' },
  ...over,
});

const happy = (over: Record<string, Route> = {}): Record<string, Route> => ({
  'GET /dropshipping/clients': ok('clients-search-empty.json'),
  'POST /dropshipping/clients': ok('client-create.json', 201),
  'POST /dropshipping/order/client/556/store': ok('order-store.json', 201),
  'POST /dropshipping/order/9001/portfolio/3761386/store': ok('transaction-store.json', 201),
  'POST /dropshipping/order/9001/portfolio/3761387/store': ok('transaction-store.json', 201),
  'PATCH /dropshipping/order/9001/update': ok('order-update.json'),
  'GET /dropshipping/order/9001': ok('order-get.json'),
  'PATCH /dropshipping/order/9001/submit': ok('order-submit.json'),
  ...over,
});
const make = (f: any, extra: object = {}) =>
  new AwAikuConnector({ token: 't', environment: 'staging', fetchImpl: f, sleep: noSleep, requestsPerSecond: 100000, maxAttempts: 1, maxSagaRetries: 2, ...extra });
const trace = (f: any) => f.calls.map((c: any) => `${c.method} ${new URL(c.url).pathname}`);

describe('placeDropshipOrder saga', () => {
  it('happy path: exact call order and payloads', async () => {
    const f = routedFetch(happy());
    const r = await make(f).placeDropshipOrder(cmd());
    expect(trace(f)).toEqual([
      'GET /dropshipping/clients',
      'POST /dropshipping/clients',
      'POST /dropshipping/order/client/556/store',
      'POST /dropshipping/order/9001/portfolio/3761386/store',
      'POST /dropshipping/order/9001/portfolio/3761387/store',
      'PATCH /dropshipping/order/9001/update',
      'GET /dropshipping/order/9001',
      'PATCH /dropshipping/order/9001/submit',
    ]);
    expect(new URL(f.calls[0]!.url).searchParams.get('search')).toBe('ana@example.com');
    expect(JSON.parse(f.calls[1]!.body!)).toMatchObject({
      company_name: 'Ana Silva', contact_name: 'Ana Silva', email: 'ana@example.com', phone: '+351900000000',
      address: { address_line_1: 'Rua das Flores 10', postal_code: '1000-001', locality: 'Lisboa', country_code: 'PT' },
    });
    expect(JSON.parse(f.calls[3]!.body!)).toEqual({ quantity_ordered: 2 });
    expect(JSON.parse(f.calls[5]!.body!)).toEqual({ public_notes: 'PS9-1001' });
    expect(r).toEqual({
      state: 'submitted',
      externalOrderId: '9001',
      totalAmount: '12.4',
      progress: {
        clientId: '556', orderId: '9001', linesStored: ['3761386', '3761387'],
        noted: true, validated: true, submitted: true,
      },
    });
  });

  it('reuses existing client when email and address match', async () => {
    const f = routedFetch(happy({
      'GET /dropshipping/clients': ok('clients-search-match.json'),
      'POST /dropshipping/order/client/555/store': ok('order-store.json'),
    }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(trace(f)).not.toContain('POST /dropshipping/clients');
    expect(r.progress.clientId).toBe('555');
    expect(r.state).toBe('submitted');
  });

  it('creates a new client when the email matches but the address differs or client inactive', async () => {
    const other = loadFixture('clients-search-match.json');
    other.data[0].address.postal_code = '4000-000';
    const f = routedFetch(happy({ 'GET /dropshipping/clients': { body: other } }));
    await make(f).placeDropshipOrder(cmd());
    expect(trace(f)).toContain('POST /dropshipping/clients');
    const inactive = loadFixture('clients-search-match.json');
    inactive.data[0].status = 'archived';
    const f2 = routedFetch(happy({ 'GET /dropshipping/clients': { body: inactive } }));
    await make(f2).placeDropshipOrder(cmd());
    expect(trace(f2)).toContain('POST /dropshipping/clients');
  });

  it('fills missing phone/email with tenant defaults', async () => {
    const f = routedFetch(happy());
    const c = cmd();
    await make(f).placeDropshipOrder({ ...c, recipient: { ...c.recipient, email: null, phone: '' } });
    expect(new URL(f.calls[0]!.url).searchParams.get('search')).toBe('orders@gemma.test');
    expect(JSON.parse(f.calls[1]!.body!)).toMatchObject({ email: 'orders@gemma.test', phone: '+351911111111' });
  });

  it('address line2 is sent when present', async () => {
    const f = routedFetch(happy());
    const c = cmd();
    await make(f).placeDropshipOrder({ ...c, recipient: { ...c.recipient, line2: 'Apt 3' } });
    expect(JSON.parse(f.calls[1]!.body!).address.address_line_2).toBe('Apt 3');
  });

  it('resumes from step 3 after failure and never calls order store again', async () => {
    let fail = true;
    const routes = happy({
      'POST /dropshipping/order/9001/portfolio/3761387/store': () =>
        fail ? { status: 500, body: {} } : ok('transaction-store.json'),
    });
    const f1 = routedFetch(routes);
    const r1 = await make(f1).placeDropshipOrder(cmd());
    expect(r1.state).toBe('failed');
    expect(r1.error).toBeTruthy();
    expect(r1.progress).toEqual({ clientId: '556', orderId: '9001', linesStored: ['3761386'] });
    expect(trace(f1).filter((t: string) => t.endsWith('3761387/store'))).toHaveLength(3); // initial + 2 retries
    expect(trace(f1).some((t: string) => t.startsWith('DELETE'))).toBe(false);

    fail = false;
    const f2 = routedFetch(routes);
    const r2 = await make(f2).placeDropshipOrder(cmd({ resume: r1.progress }));
    expect(trace(f2)).toEqual([
      'POST /dropshipping/order/9001/portfolio/3761387/store',
      'PATCH /dropshipping/order/9001/update',
      'GET /dropshipping/order/9001',
      'PATCH /dropshipping/order/9001/submit',
    ]);
    expect(r2.state).toBe('submitted');
  });

  it('retries a transient step failure within the saga and continues', async () => {
    let n = 0;
    const f = routedFetch(happy({
      'PATCH /dropshipping/order/9001/update': () => (n++ === 0 ? { status: 503, body: {} } : ok('order-update.json')),
    }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(r.state).toBe('submitted');
    expect(trace(f).filter((t: string) => t.includes('/update'))).toHaveLength(2);
  });

  it('reports progress through onProgress after every step', async () => {
    const seen: unknown[] = [];
    const f = routedFetch(happy());
    await make(f, { onProgress: async (p: unknown) => void seen.push(structuredClone(p)) }).placeDropshipOrder(cmd());
    expect(seen).toHaveLength(7); // client, order, 2 lines, note, validate, submit
    expect(seen[0]).toEqual({ clientId: '556' });
  });

  it('aborts before submit when total_amount > max_supplier_cost', async () => {
    const f = routedFetch(happy({ 'GET /dropshipping/order/9001': ok('order-get-expensive.json') }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(r.state).toBe('creating');
    expect(r.alert).toBe('cost_exceeds_max');
    expect(r.totalAmount).toBe('99.99');
    expect(r.progress.submitted).toBeUndefined();
    expect(trace(f).some((t: string) => t.endsWith('/submit'))).toBe(false);
  });

  it('total equal to the max is allowed? no: must be below', async () => {
    const f = routedFetch(happy());
    const r = await make(f).placeDropshipOrder(cmd({ maxSupplierCost: '12.40' }));
    expect(r.alert).toBe('cost_exceeds_max');
    expect(r.state).toBe('creating');
  });

  it('aborts on item_quantity mismatch', async () => {
    const bad = loadFixture('order-get.json');
    bad.data.item_quantity = 2;
    const f = routedFetch(happy({ 'GET /dropshipping/order/9001': { body: bad } }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(r).toMatchObject({ state: 'creating', alert: 'quantity_mismatch' });
    expect(trace(f).some((t: string) => t.endsWith('/submit'))).toBe(false);
  });

  it('does not delete the AW order when submit keeps failing', async () => {
    const f = routedFetch(happy({ 'PATCH /dropshipping/order/9001/submit': { status: 500, body: {} } }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(r.state).toBe('failed');
    expect(r.externalOrderId).toBe('9001');
    expect(r.progress).toMatchObject({ orderId: '9001', validated: true });
    expect(trace(f).some((t: string) => t.startsWith('DELETE'))).toBe(false);
  });

  it('an already submitted resume makes no calls', async () => {
    const f = routedFetch(happy());
    const r = await make(f).placeDropshipOrder(cmd({ resume: { clientId: '556', orderId: '9001', submitted: true } }));
    expect(r.state).toBe('submitted');
    expect(f.calls).toHaveLength(0);
  });

  it('failure before the order exists reports failed without externalOrderId', async () => {
    const f = routedFetch(happy({ 'POST /dropshipping/clients': { status: 422, body: { message: 'bad' } } }));
    const r = await make(f).placeDropshipOrder(cmd());
    expect(r.state).toBe('failed');
    expect(r.externalOrderId).toBeUndefined();
  });

  it('resume with validated skips step 5 and re-fetches nothing before submit', async () => {
    const f = routedFetch(happy());
    const r = await make(f).placeDropshipOrder(cmd({
      resume: { clientId: '556', orderId: '9001', linesStored: ['3761386', '3761387'], noted: true, validated: true },
    }));
    expect(trace(f)).toEqual(['PATCH /dropshipping/order/9001/submit']);
    expect(r.state).toBe('submitted');
  });

  it('token never leaks into a failed result', async () => {
    const f = routedFetch(happy({ 'POST /dropshipping/clients': { status: 500, body: 'Bearer SEKRET-TOK' } }));
    const r = await make(f, { token: 'SEKRET-TOK' }).placeDropshipOrder(cmd());
    expect(JSON.stringify(r)).not.toContain('SEKRET-TOK');
  });
});
