import { randomBytes } from 'node:crypto';
import { DomainError } from '../errors/domain-error';
import { encryptSecret, decryptSecret } from './crypto';

const key = randomBytes(32);

describe('crypto', () => {
  it('roundtrips, including unicode and empty strings', () => {
    for (const s of ['secret-token', 'çãõ ✓', '']) expect(decryptSecret(encryptSecret(s, key), key)).toBe(s);
  });
  it('uses a random IV (same plaintext => different ciphertext)', () => {
    expect(encryptSecret('a', key)).not.toBe(encryptSecret('a', key));
  });
  it('detects tampering of ciphertext, tag and iv', () => {
    const raw = Buffer.from(encryptSecret('hello world', key), 'base64');
    for (const idx of [0, 13, raw.length - 1]) {
      const t = Buffer.from(raw);
      t[idx] = (t[idx] ?? 0) ^ 1;
      expect(() => decryptSecret(t.toString('base64'), key)).toThrow(DomainError);
    }
  });
  it('fails with wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32))).toThrow(DomainError);
  });
  it('rejects bad key length and malformed payload', () => {
    expect(() => encryptSecret('x', randomBytes(16))).toThrow(DomainError);
    expect(() => decryptSecret('x', randomBytes(16))).toThrow(DomainError);
    expect(() => decryptSecret('AAAA', key)).toThrow(DomainError);
  });
});
