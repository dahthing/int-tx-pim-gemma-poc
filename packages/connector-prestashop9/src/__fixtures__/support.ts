import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeFetch, type FakeCall, type FakeStep, type FakeFetch } from '@repo/http-client';
import type { PrestaShop9Settings } from '../settings';

export const SECRETS = { clientSecret: 'SECRET-CS-123', wsKey: 'WSKEY-999', token: 'tok-abc' };

export function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8'));
}
export function fixtureNames(): string[] {
  return readdirSync(__dirname).filter((f) => f.endsWith('.json'));
}

export const ALL_WS: PrestaShop9Settings['routing'] = {
  products: 'webservice', stock_availables: 'webservice', orders: 'webservice', order_carriers: 'webservice',
  order_histories: 'webservice', customers: 'webservice', addresses: 'webservice', countries: 'webservice',
  images: 'webservice', shops: 'webservice',
};

export function makeSettings(over: Partial<PrestaShop9Settings> = {}): PrestaShop9Settings {
  return {
    baseUrl: 'https://shop.example.com',
    adminApi: { clientId: 'cid', clientSecret: SECRETS.clientSecret, scopes: ['product_read', 'product_write'] },
    webservice: { key: SECRETS.wsKey },
    taxRulesGroupId: 3, languageId: 1, paidStateIds: [2, 3], shippedStateId: 4, currency: 'EUR',
    ...over,
  };
}

type Handler = FakeStep | ((call: FakeCall, url: URL) => FakeStep);
export type Route = [method: string, path: RegExp | string, handler: Handler];

/** Routes by "METHOD pathname"; first match wins; unmatched calls answer 599. */
export function router(routes: Route[]): FakeFetch {
  return createFakeFetch((call) => {
    const url = new URL(call.url);
    for (const [m, p, h] of routes) {
      if (m !== call.method) continue;
      if (typeof p === 'string' ? url.pathname === p : p.test(url.pathname)) return typeof h === 'function' ? h(call, url) : h;
    }
    return { status: 599, body: `unmatched ${call.method} ${url.pathname}` };
  });
}
export const json = (body: unknown, status = 200): FakeStep => ({ status, body });
