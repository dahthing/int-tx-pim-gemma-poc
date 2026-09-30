import { HttpStatusError, NetworkError, TimeoutError } from './errors';
import { createFakeFetch } from './fake-fetch';
import { RateLimiter } from './rate-limiter';
import { ResilientHttpClient, RequestLogEntry, ResilientHttpClientOptions } from './resilient-http';

function setup(steps: Parameters<typeof createFakeFetch>[0], extra: Partial<ResilientHttpClientOptions> = {}) {
  let t = 0;
  const sleeps: number[] = [];
  const logs: RequestLogEntry[] = [];
  const fetchImpl = createFakeFetch(steps);
  let id = 0;
  const client = new ResilientHttpClient({
    connector: 'aw',
    fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0,
    correlationIdGenerator: () => `cid-${++id}`,
    sink: { log: (e) => void logs.push(e) },
    ...extra,
  });
  return { client, fetchImpl, sleeps, logs, advance: (ms: number) => (t += ms) };
}

describe('ResilientHttpClient', () => {
  describe('success path', () => {
    it('returns status, lowercase headers, json and text', async () => {
      const { client } = setup([{ status: 200, body: { ok: 1 }, headers: { 'X-Foo': 'bar' } }]);
      const res = await client.request('GET', 'http://h.test/a');
      expect(res.status).toBe(200);
      expect(res.headers['x-foo']).toBe('bar');
      expect(res.json()).toEqual({ ok: 1 });
      expect(res.text).toBe('{"ok":1}');
    });

    it('json() throws a helpful error on invalid JSON', async () => {
      const { client } = setup([{ body: 'not json' }]);
      const res = await client.request('GET', 'http://h.test/a');
      expect(() => res.json()).toThrow(/JSON/);
    });

    it('appends query (skipping undefined), sends headers and JSON body', async () => {
      const { client, fetchImpl } = setup([{ status: 200 }]);
      await client.request('POST', 'http://h.test/a?x=1', {
        query: { page: 2, q: 'a b', skip: undefined, flag: true },
        headers: { Authorization: 'Bearer t0k' },
        body: { hello: 'w' },
      });
      const call = fetchImpl.calls[0]!;
      expect(call.url).toBe('http://h.test/a?x=1&page=2&q=a+b&flag=true');
      expect(call.method).toBe('POST');
      expect(call.headers.authorization).toBe('Bearer t0k');
      expect(call.headers['content-type']).toBe('application/json');
      expect(call.body).toBe('{"hello":"w"}');
    });

    it('passes string bodies through and keeps a caller content-type', async () => {
      const { client, fetchImpl } = setup([{ status: 200 }]);
      await client.request('POST', 'http://h.test/a', {
        body: 'a=1',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      expect(fetchImpl.calls[0]!.body).toBe('a=1');
      expect(fetchImpl.calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    });

    it('resolves relative urls against baseUrl', async () => {
      const { client, fetchImpl } = setup([{ status: 200 }], { baseUrl: 'http://base.test/api/' });
      await client.request('GET', '/things');
      expect(fetchImpl.calls[0]!.url).toBe('http://base.test/api/things');
    });

    it('uses the global fetch when fetchImpl is omitted', async () => {
      const spy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const client = new ResilientHttpClient({ connector: 'x' });
      await client.request('GET', 'http://h.test');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('has working default clock, sleep, random and id generator', async () => {
      const logs: RequestLogEntry[] = [];
      const client = new ResilientHttpClient({
        connector: 'x',
        baseDelayMs: 1,
        fetchImpl: createFakeFetch([{ status: 503 }, { status: 200 }]),
        sink: { log: (e) => void logs.push(e) },
      });
      await client.request('GET', 'http://h.test');
      expect(logs).toHaveLength(2);
      expect(logs[0]!.correlationId).toMatch(/[0-9a-f-]{36}/);
      expect(logs[0]!.correlationId).toBe(logs[1]!.correlationId);
    });
  });

  describe('retry on 429 / 5xx / 408 / network', () => {
    it('retries 429 honouring Retry-After seconds', async () => {
      const { client, sleeps, fetchImpl } = setup([
        { status: 429, headers: { 'Retry-After': '3' } },
        { status: 200, body: {} },
      ]);
      const res = await client.request('GET', 'http://h.test/a');
      expect(res.status).toBe(200);
      expect(sleeps).toEqual([3000]);
      expect(fetchImpl.calls).toHaveLength(2);
    });

    it('honours Retry-After as an HTTP date', async () => {
      const { client, sleeps } = setup(
        [
          { status: 503, headers: { 'Retry-After': new Date(10_000).toUTCString() } },
          { status: 200 },
        ],
        {},
      );
      await client.request('GET', 'http://h.test/a');
      expect(sleeps).toEqual([10_000]);
    });

    it('ignores unparsable Retry-After and falls back to backoff', async () => {
      const { client, sleeps } = setup([
        { status: 503, headers: { 'Retry-After': 'soon' } },
        { status: 200 },
      ]);
      await client.request('GET', 'http://h.test/a');
      expect(sleeps).toEqual([500]);
    });

    it('never waits less than zero for past Retry-After dates', async () => {
      const { client, sleeps, advance } = setup([
        { status: 503, headers: { 'Retry-After': new Date(1000).toUTCString() } },
        { status: 200 },
      ]);
      advance(5000);
      await client.request('GET', 'http://h.test/a');
      expect(sleeps).toEqual([0]);
    });

    it('retries 503 up to 5 attempts with exponential backoff then throws HttpStatusError', async () => {
      const { client, sleeps, fetchImpl } = setup([{ status: 503, body: 'down' }]);
      const err = await client.request('GET', 'http://h.test/a').catch((e) => e);
      expect(err).toBeInstanceOf(HttpStatusError);
      expect(err.status).toBe(503);
      expect(err.bodySnippet).toBe('down');
      expect(fetchImpl.calls).toHaveLength(5);
      expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    });

    it('retries 500, 502, 504 and 408', async () => {
      for (const status of [408, 500, 502, 504]) {
        const { client, fetchImpl } = setup([{ status }, { status: 200 }]);
        await client.request('GET', 'http://h.test/a');
        expect(fetchImpl.calls).toHaveLength(2);
      }
    });

    it('adds jitter on top of the exponential delay and caps at maxDelayMs', async () => {
      const { client, sleeps } = setup([{ status: 503 }], {
        random: () => 0.5,
        maxDelayMs: 1500,
        maxAttempts: 4,
      });
      await client.request('GET', 'http://h.test/a').catch(() => undefined);
      // 500*1.125, then 1000*1.125 capped to 1500, 1500
      expect(sleeps).toEqual([562.5, 1125, 1500]);
    });

    it('retries network errors then succeeds', async () => {
      const { client, fetchImpl } = setup([
        { error: new TypeError('fetch failed') },
        { status: 200 },
      ]);
      await client.request('GET', 'http://h.test/a');
      expect(fetchImpl.calls).toHaveLength(2);
    });

    it('throws NetworkError after exhausting attempts', async () => {
      const { client, fetchImpl } = setup([{ error: new TypeError('fetch failed') }]);
      const err = await client.request('GET', 'http://h.test/a').catch((e) => e);
      expect(err).toBeInstanceOf(NetworkError);
      expect(fetchImpl.calls).toHaveLength(5);
    });

    it('respects a custom maxAttempts', async () => {
      const { client, fetchImpl } = setup([{ status: 500 }], { maxAttempts: 2 });
      await client.request('GET', 'http://h.test/a').catch(() => undefined);
      expect(fetchImpl.calls).toHaveLength(2);
    });
  });

  describe('no retry on other 4xx', () => {
    it.each([400, 401, 404, 422])('does not retry %i', async (status) => {
      const { client, fetchImpl, sleeps } = setup([{ status, body: { message: 'nope' } }]);
      const err = await client.request('GET', 'http://h.test/a').catch((e) => e);
      expect(err).toBeInstanceOf(HttpStatusError);
      expect(err.status).toBe(status);
      expect(fetchImpl.calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    });
  });

  describe('timeout', () => {
    it('aborts a hanging request with TimeoutError and retries it', async () => {
      const { client, fetchImpl } = setup([{ hang: true }], { maxAttempts: 2 });
      const err = await client.request('GET', 'http://h.test/a', { timeout: 5 }).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.timeoutMs).toBe(5);
      expect(fetchImpl.calls).toHaveLength(2);
    });

    it('uses defaultTimeoutMs and recovers when a retry answers', async () => {
      const { client } = setup([{ hang: true }, { status: 200 }], { defaultTimeoutMs: 5 });
      expect((await client.request('GET', 'http://h.test/a')).status).toBe(200);
    });
  });

  describe('rate limiting', () => {
    it('acquires a token for every attempt, including retries', async () => {
      const limiter = { acquire: jest.fn().mockResolvedValue(undefined) };
      const { client } = setup([{ status: 503 }, { status: 200 }], { rateLimiter: limiter });
      await client.request('GET', 'http://h.test/a');
      expect(limiter.acquire).toHaveBeenCalledTimes(2);
    });

    it('builds a RateLimiter from requestsPerSecond', async () => {
      const { client, sleeps } = setup([{ status: 200 }], { requestsPerSecond: 2 });
      await client.request('GET', 'http://h.test/a');
      await client.request('GET', 'http://h.test/a');
      expect(sleeps).toEqual([500]);
      expect(client.rateLimiter).toBeInstanceOf(RateLimiter);
    });
  });

  describe('logging and redaction', () => {
    it('logs every attempt with the same correlation id and sends it as a header', async () => {
      const { client, logs, fetchImpl } = setup([{ status: 503 }, { status: 200 }]);
      await client.request('GET', 'http://h.test/a');
      expect(logs.map((l) => l.status)).toEqual([503, 200]);
      expect(logs.every((l) => l.correlationId === 'cid-1')).toBe(true);
      expect(logs[0]!).toMatchObject({ connector: 'aw', method: 'GET', url: 'http://h.test/a' });
      expect(typeof logs[0]!.durationMs).toBe('number');
      expect(fetchImpl.calls[0]!.headers['x-correlation-id']).toBe('cid-1');
    });

    it('new correlation id for each request', async () => {
      const { client, logs } = setup([{ status: 200 }]);
      await client.request('GET', 'http://h.test/a');
      await client.request('GET', 'http://h.test/a');
      expect(logs.map((l) => l.correlationId)).toEqual(['cid-1', 'cid-2']);
    });

    it('measures durationMs from the injected clock', async () => {
      let t = 0;
      const logs: RequestLogEntry[] = [];
      const client = new ResilientHttpClient({
        connector: 'c',
        now: () => t,
        fetchImpl: (async () => {
          t += 42;
          return new Response('{}');
        }) as any,
        sink: { log: (e) => void logs.push(e) },
      });
      await client.request('GET', 'http://h.test');
      expect(logs[0]!.durationMs).toBe(42);
    });

    it('never leaks Authorization, query secrets, userinfo or body secrets to the sink or errors', async () => {
      const { client, logs } = setup([
        {
          status: 400,
          body: { password: 'bodysecret', message: 'bad', echoed: 'Bearer leakedtoken' },
        },
      ]);
      const err = await client
        .request('POST', 'http://usr:pwd@h.test/a?token=qtok&api_key=qkey&page=1', {
          headers: { Authorization: 'Bearer supersecret' },
          body: { password: 'bodysecret', secret: 'bs2' },
        })
        .catch((e) => e);
      const dump = JSON.stringify([logs, err.message, err.bodySnippet, err.url, err.stack]);
      for (const s of ['supersecret', 'qtok', 'qkey', 'usr:pwd', 'pwd', 'bodysecret', 'bs2', 'leakedtoken']) {
        expect(dump).not.toContain(s);
      }
      expect(dump).toContain('page=1');
    });

    it('logs network errors with redacted error text and no status', async () => {
      const { client, logs } = setup([
        { error: new TypeError('connect failed http://u:p@h.test/?token=zzz') },
      ], { maxAttempts: 1 });
      await client.request('GET', 'http://h.test/a').catch(() => undefined);
      expect(logs[0]!.status).toBeUndefined();
      expect(logs[0]!.error).toContain('connect failed');
      expect(logs[0]!.error).not.toMatch(/zzz|u:p/);
    });

    it('logs http failures with an error message', async () => {
      const { client, logs } = setup([{ status: 404 }]);
      await client.request('GET', 'http://h.test/a').catch(() => undefined);
      expect(logs[0]!).toMatchObject({ status: 404 });
      expect(logs[0]!.error).toContain('404');
    });

    it('a failing or async sink never breaks the request', async () => {
      const client = new ResilientHttpClient({
        connector: 'c',
        fetchImpl: createFakeFetch([{ status: 200 }]),
        sink: {
          log: async () => {
            throw new Error('db down');
          },
        },
      });
      expect((await client.request('GET', 'http://h.test')).status).toBe(200);
      const client2 = new ResilientHttpClient({
        connector: 'c',
        fetchImpl: createFakeFetch([{ status: 200 }]),
        sink: {
          log: () => {
            throw new Error('sync boom');
          },
        },
      });
      expect((await client2.request('GET', 'http://h.test')).status).toBe(200);
    });

    it('truncates long body snippets', async () => {
      const { client } = setup([{ status: 400, body: 'x'.repeat(5000) }]);
      const err = await client.request('GET', 'http://h.test/a').catch((e) => e);
      expect(err.bodySnippet.length).toBeLessThanOrEqual(520);
    });
  });
});
