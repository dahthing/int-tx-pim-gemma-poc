import { CredentialVault } from './credential-vault';

const key = Buffer.alloc(32, 3);
const vault = () =>
  new CredentialVault({ getKey: jest.fn().mockResolvedValue(key) });

describe('CredentialVault', () => {
  it('round-trips JSON and never stores plaintext', async () => {
    const v = vault();
    const enc = await v.encrypt('t', { token: 'super-secret' });
    expect(enc).not.toContain('super-secret');
    expect(await v.decrypt('t', enc)).toEqual({ token: 'super-secret' });
  });

  it('returns null for an empty envelope', async () => {
    expect(await vault().decrypt('t', null)).toBeNull();
    expect(await vault().decrypt('t', '')).toBeNull();
  });

  it('fails on a tampered envelope', async () => {
    const v = vault();
    const enc = await v.encrypt('t', { a: 1 });
    const bad = Buffer.from(enc, 'base64');
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    await expect(v.decrypt('t', bad.toString('base64'))).rejects.toThrow();
  });
});
