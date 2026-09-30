import { decryptSecret, encryptSecret } from '@repo/core-domain';

export interface TemuCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
}
export type EncryptedTemuCredentials = Record<keyof TemuCredentials, string>;

export function encryptCredentials(c: TemuCredentials, key: Buffer): EncryptedTemuCredentials {
  return {
    appKey: encryptSecret(c.appKey, key),
    appSecret: encryptSecret(c.appSecret, key),
    accessToken: encryptSecret(c.accessToken, key),
  };
}

export function decryptCredentials(c: EncryptedTemuCredentials, key: Buffer): TemuCredentials {
  return {
    appKey: decryptSecret(c.appKey, key),
    appSecret: decryptSecret(c.appSecret, key),
    accessToken: decryptSecret(c.accessToken, key),
  };
}
