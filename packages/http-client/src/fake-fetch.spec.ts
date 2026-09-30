import { createFakeFetch } from './fake-fetch';

describe('createFakeFetch', () => {
  it('serves steps in order, repeats the last, and records calls', async () => {
    const f = createFakeFetch([{ status: 500 }, { status: 200, body: { a: 1 }, headers: { 'x-y': 'z' } }]);
    const r1 = await f('http://t/1', { method: 'POST', body: 'b' });
    expect(r1.status).toBe(500);
    const r2 = await f('http://t/2');
    expect(await r2.json()).toEqual({ a: 1 });
    expect(r2.headers.get('x-y')).toBe('z');
    expect((await f('http://t/3')).status).toBe(200);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]!).toMatchObject({ url: 'http://t/1', method: 'POST', body: 'b' });
    expect(f.calls[2]!.method).toBe('GET');
  });

  it('serialises objects as JSON and passes strings through', async () => {
    const f = createFakeFetch([{ body: 'plain' }]);
    expect(await (await f('http://t')).text()).toBe('plain');
    const g = createFakeFetch([{ body: { a: 1 } }]);
    expect(await (await g('http://t')).text()).toBe('{"a":1}');
    const h = createFakeFetch([{ status: 204 }]);
    expect(await (await h('http://t')).text()).toBe('');
  });

  it('rejects with a configured error', async () => {
    const f = createFakeFetch([{ error: new TypeError('fetch failed') }]);
    await expect(f('http://t')).rejects.toThrow('fetch failed');
  });

  it('supports function handlers receiving call index', async () => {
    const f = createFakeFetch((call, i) => ({ status: 200, body: { u: call.url, i } }));
    expect(await (await f('http://t/a')).json()).toEqual({ u: 'http://t/a', i: 0 });
  });

  it('hangs until aborted when hang is set', async () => {
    const f = createFakeFetch([{ hang: true }]);
    const ac = new AbortController();
    const p = f('http://t', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when already aborted and hang is set', async () => {
    const f = createFakeFetch([{ hang: true }]);
    const ac = new AbortController();
    ac.abort();
    await expect(f('http://t', { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when an empty sequence is exhausted', async () => {
    await expect(createFakeFetch([])('http://t')).rejects.toThrow(/no more/i);
  });

  it('accepts URL objects and header instances', async () => {
    const f = createFakeFetch([{}]);
    await f(new URL('http://t/x'), { headers: new Headers({ A: 'b' }) });
    expect(f.calls[0]!.url).toBe('http://t/x');
    expect(f.calls[0]!.headers.a).toBe('b');
  });
});
