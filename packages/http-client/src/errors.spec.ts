import { HttpError, HttpStatusError, NetworkError, TimeoutError } from './errors';

describe('errors', () => {
  it('HttpStatusError carries status and body snippet', () => {
    const e = new HttpStatusError({ status: 503, method: 'GET', url: 'http://h/x', bodySnippet: 'oops' });
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('HttpStatusError');
    expect(e.status).toBe(503);
    expect(e.bodySnippet).toBe('oops');
    expect(e.message).toContain('503');
  });
  it('NetworkError keeps cause, TimeoutError carries timeout', () => {
    const cause = new Error('ECONNRESET');
    const n = new NetworkError({ method: 'GET', url: 'http://h', cause });
    expect(n.cause).toBe(cause);
    expect(n.message).toContain('ECONNRESET');
    const t = new TimeoutError({ method: 'GET', url: 'http://h', timeoutMs: 10 });
    expect(t.timeoutMs).toBe(10);
    expect(t).toBeInstanceOf(HttpError);
    expect(t.name).toBe('TimeoutError');
  });
});
