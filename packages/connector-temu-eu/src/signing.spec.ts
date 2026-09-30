import { PlaceholderSigner, buildSignaturePayload, signParams } from './signing';

// PLACEHOLDER vectors: computed from the assumed algorithm, NOT from Temu docs.
// Replace with the official vectors in spike S0.8 (see docs/spikes/temu-eu-assumptions.md).
const BASE = {
  type: 'bg.test.method',
  app_key: 'test_app_key',
  access_token: 'test_token',
  timestamp: '1700000000',
  data_type: 'JSON',
};

describe('signing (PLACEHOLDER algorithm, S0.8)', () => {
  it('builds the payload: secret + sorted key/value pairs + secret', () => {
    expect(buildSignaturePayload({ b: '2', a: '1' }, 's')).toBe('sa1b2s');
  });

  it('ignores sign, undefined and null; serialises objects as JSON', () => {
    expect(buildSignaturePayload({ z: { k: 1 }, a: true, sign: 'x', u: undefined, n: null }, 's')).toBe(
      's' + 'atrue' + 'z{"k":1}' + 's',
    );
  });

  it('PLACEHOLDER vector 1 (md5, uppercase hex)', () => {
    expect(signParams(BASE, 'test_secret', 'md5')).toBe('DC5B75E6F7A44CC04D47A663766B4504');
  });

  it('PLACEHOLDER vector 2 (sha256, uppercase hex)', () => {
    expect(signParams(BASE, 'test_secret', 'sha256')).toBe(
      '1DB36C1CDBD3CB505B2F656D266A2A7FC043F8744A4DF1D9B23D7A384F2127A8',
    );
  });

  it('PLACEHOLDER vector 3 (ordering and exclusions do not change the signature)', () => {
    const expected = '5EE29085AF57D942F21F1C5BA3C2A90A';
    expect(signParams({ b: '2', a: '1' }, 's', 'md5')).toBe(expected);
    expect(signParams({ a: '1', b: '2', sign: 'zzz', c: undefined }, 's', 'md5')).toBe(expected);
  });

  it('PLACEHOLDER vector 4 (object values)', () => {
    expect(signParams({ z: { k: 1 }, a: true }, 's', 'md5')).toBe('A8AD95089A3C6316DCAF9B82958AE099');
  });

  it('PlaceholderSigner implements the Signer interface and defaults to md5', () => {
    expect(new PlaceholderSigner().sign(BASE, 'test_secret')).toBe('DC5B75E6F7A44CC04D47A663766B4504');
    expect(new PlaceholderSigner('sha256').sign(BASE, 'test_secret')).toHaveLength(64);
  });

  it('rejects an empty secret', () => {
    expect(() => signParams(BASE, '', 'md5')).toThrow(/secret/i);
  });
});
