import { Inject, Injectable } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '@repo/core-domain';
import {
  PIM_ORDERS_TOKENS,
  type EncryptionKeyProvider,
} from '@repo/pim-orders';

/** Encrypts / decrypts credential objects (Supplier.credentialsEnc, Channel.credentialsEnc) with core-domain AES-GCM. */
@Injectable()
export class CredentialVault {
  constructor(
    @Inject(PIM_ORDERS_TOKENS.ENCRYPTION_KEY_PROVIDER)
    private readonly keys: EncryptionKeyProvider,
  ) {}

  async encrypt(tenantId: string, value: object): Promise<string> {
    return encryptSecret(
      JSON.stringify(value),
      await this.keys.getKey(tenantId),
    );
  }

  async decrypt<T extends object = Record<string, unknown>>(
    tenantId: string,
    envelope: string | null | undefined,
  ): Promise<T | null> {
    if (!envelope) return null;
    return JSON.parse(
      decryptSecret(envelope, await this.keys.getKey(tenantId)),
    ) as T;
  }
}
