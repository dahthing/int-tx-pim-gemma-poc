import { createHash } from 'node:crypto';

/**
 * PLACEHOLDER (spike S0.8): the real Temu signing algorithm is unconfirmed.
 * Assumed (PDD-style open platform): sort params by key, concatenate key+value,
 * wrap with the app secret, hash, uppercase hex. See docs/spikes/temu-eu-assumptions.md.
 */
export type SignParamValue = unknown;
export type SignParams = Record<string, SignParamValue>;
export type SignHash = 'md5' | 'sha256';

/** Swap this implementation once S0.8 confirms the real algorithm. */
export interface Signer {
  sign(params: SignParams, appSecret: string): string;
}

const stringify = (v: object | string | number | boolean): string =>
  typeof v === 'object' ? JSON.stringify(v) : String(v);

export function buildSignaturePayload(params: SignParams, appSecret: string): string {
  const body = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => k + stringify(params[k] as object | string | number | boolean))
    .join('');
  return appSecret + body + appSecret;
}

export function signParams(params: SignParams, appSecret: string, hash: SignHash = 'md5'): string {
  if (!appSecret) throw new Error('App secret is required to sign a request');
  return createHash(hash).update(buildSignaturePayload(params, appSecret), 'utf8').digest('hex').toUpperCase();
}

export class PlaceholderSigner implements Signer {
  constructor(private readonly hash: SignHash = 'md5') {}
  sign(params: SignParams, appSecret: string): string {
    return signParams(params, appSecret, this.hash);
  }
}
