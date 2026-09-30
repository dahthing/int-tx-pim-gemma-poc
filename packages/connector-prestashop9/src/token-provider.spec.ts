import { ResilientHttpClient } from '@repo/http-client';
import { TokenProvider } from './token-provider';
import { SECRETS, json, router } from './__fixtures__/support';

function setup(expiresIn = 3600) {
  let now = 1_000_000;
  let n = 0;
  const fake = router([['POST', '/admin-api/access_token', () => json({ access_token: `tok-${++n}`, token_type: 'Bearer', expires_in: expiresIn })]]);
  const http = new ResilientHttpClient({ connector: 'ps9', baseUrl: 'https://shop.example.com', fetchImpl: fake, maxAttempts: 1, sleep: async () => {} });
  const tp = new TokenProvider({ http, tokenUrl: 'https://shop.example.com/admin-api/access_token', clientId: 'cid', clientSecret: SECRETS.clientSecret, scopes: ['product_read', 'product_write'], now: () => now });
  return { tp, fake, advance: (ms: number) => (now += ms) };
}

describe('TokenProvider', () => {
  it('requests a client-credentials token with scopes', async () => {
    const { tp, fake } = setup();
    expect(await tp.getToken()).toBe('tok-1');
    const c = fake.calls[0]!;
    expect(c.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const p = new URLSearchParams(c.body);
    expect(p.get('grant_type')).toBe('client_credentials');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('scope')).toBe('product_read product_write');
  });
  it('caches until 60 s before expiry then refreshes', async () => {
    const { tp, fake, advance } = setup(3600);
    await tp.getToken();
    advance(3539_000);
    expect(await tp.getToken()).toBe('tok-1');
    expect(fake.calls).toHaveLength(1);
    advance(1_000);
    expect(await tp.getToken()).toBe('tok-2');
    expect(fake.calls).toHaveLength(2);
  });
  it('shares one in-flight request between concurrent callers', async () => {
    const { tp, fake } = setup();
    const r = await Promise.all([tp.getToken(), tp.getToken(), tp.getToken()]);
    expect(new Set(r).size).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });
  it('invalidate forces a refresh', async () => {
    const { tp } = setup();
    await tp.getToken();
    tp.invalidate();
    expect(await tp.getToken()).toBe('tok-2');
  });
  it('does not cache a failure', async () => {
    const { tp } = setup();
    const fake = router([['POST', /.*/, { status: 401, body: { error: 'invalid_client' } }]]);
    const http = new ResilientHttpClient({ connector: 'ps9', fetchImpl: fake, maxAttempts: 1, sleep: async () => {} });
    const bad = new TokenProvider({ http, tokenUrl: 'https://shop.example.com/t', clientId: 'a', clientSecret: 'b', now: () => 0 });
    await expect(bad.getToken()).rejects.toThrow();
    await expect(bad.getToken()).rejects.toThrow();
    expect(fake.calls).toHaveLength(2);
    expect(tp).toBeDefined();
  });
});
