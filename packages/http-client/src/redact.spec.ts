import { REDACTED, redact, redactHeaders, redactText, redactUrl } from './redact';

describe('redactUrl', () => {
  it('removes userinfo', () => {
    expect(redactUrl('https://user:pw@host.test/a')).not.toMatch(/user|pw/);
    expect(redactUrl('https://user:pw@host.test/a')).toContain('host.test/a');
  });
  it('redacts sensitive query params but keeps others', () => {
    const out = redactUrl(
      'https://h.test/x?page=2&token=abc&api_key=k1&secret=s&password=p&access_token=z',
    );
    expect(out).toContain('page=2');
    for (const v of ['abc', 'k1', '=s&', '=p&', 'z']) expect(out).not.toContain(v);
    expect(out).toContain(`token=${encodeURIComponent(REDACTED)}`);
  });
  it('handles unparsable/relative urls with regex fallback', () => {
    const out = redactUrl('/rel/path?token=abc&x=1');
    expect(out).not.toContain('abc');
    expect(out).toContain('x=1');
  });
});

describe('redactHeaders', () => {
  it('redacts Authorization case-insensitively and other secret headers', () => {
    const out = redactHeaders({
      Authorization: 'Bearer abc',
      'X-Api-Key': 'k',
      Cookie: 'a=b',
      Accept: 'application/json',
    });
    expect(out.Authorization).toBe(REDACTED);
    expect(out['X-Api-Key']).toBe(REDACTED);
    expect(out.Cookie).toBe(REDACTED);
    expect(out.Accept).toBe('application/json');
  });
});

describe('redact', () => {
  it('deep redacts objects and arrays by key', () => {
    const out = redact({
      a: 1,
      password: 'p',
      nested: { clientSecret: 'x', list: [{ api_key: 'k', ok: true }] },
      token: null,
    }) as any;
    expect(out.a).toBe(1);
    expect(out.password).toBe(REDACTED);
    expect(out.nested.clientSecret).toBe(REDACTED);
    expect(out.nested.list[0]).toEqual({ api_key: REDACTED, ok: true });
    expect(out.token).toBe(REDACTED);
  });
  it('does not mutate input', () => {
    const input = { password: 'p' };
    redact(input);
    expect(input.password).toBe('p');
  });
  it('redacts JSON strings', () => {
    const out = redact('{"password":"p","name":"n"}') as string;
    expect(out).not.toContain('"p"');
    expect(out).toContain('"n"');
  });
  it('redacts bearer tokens and key=value in plain text', () => {
    const out = redact('failed Authorization: Bearer abc.def token=xyz&a=1') as string;
    expect(out).not.toContain('abc.def');
    expect(out).not.toContain('xyz');
    expect(out).toContain('a=1');
  });
  it('redacts urls embedded in strings', () => {
    expect(redact('GET https://u:p@h.test/?token=q')).not.toMatch(/u:p|q$/);
  });
  it('passes primitives through and survives cycles', () => {
    expect(redact(5)).toBe(5);
    expect(redact(undefined)).toBeUndefined();
    const a: any = { x: 1 };
    a.self = a;
    expect((redact(a) as any).x).toBe(1);
  });
});

describe('redactText', () => {
  it('redacts quoted and unquoted secrets', () => {
    const out = redactText('password: "hunter2" and secret=abc Basic dXNlcjpwdw==');
    expect(out).not.toMatch(/hunter2|abc|dXNlcjpwdw/);
  });
});
