import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../errors/domain-error';

const IV_LEN = 12;
const TAG_LEN = 16;

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new DomainError('INVALID_KEY', 'Encryption key must be a 32-byte Buffer');
  }
}

/** AES-256-GCM. Output: base64(iv[12] | authTag[16] | ciphertext). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key);
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_LEN + TAG_LEN) throw new DomainError('INVALID_CIPHERTEXT', 'Ciphertext is malformed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
  } catch {
    throw new DomainError('DECRYPTION_FAILED', 'Decryption failed (wrong key or tampered data)');
  }
}
