import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeFetch, type FakeCall, type FakeFetch, type FakeStep } from '@repo/http-client';

export const FIXTURE_DIR = __dirname;

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

export type Route = FakeStep | ((call: FakeCall) => FakeStep);

/** Routes keyed "METHOD /path" (query string ignored). Unknown routes answer 404. */
export function routedFetch(routes: Record<string, Route>): FakeFetch {
  return createFakeFetch((call) => {
    const u = new URL(call.url);
    const r = routes[`${call.method} ${u.pathname}`];
    if (!r) return { status: 404, body: { message: 'no route' } };
    return typeof r === 'function' ? r(call) : r;
  });
}

export const ok = (fixture: string, status = 200): FakeStep => ({ status, body: loadFixture(fixture) });
