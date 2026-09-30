import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EncryptionKeyProvider } from '@repo/pim-orders';
import { RUNTIME_CONFIG } from '../runtime.constants';

const KEY_BYTES = 32;

/** One AES-256 key for the whole POC, from `PIM_ENCRYPTION_KEY` (base64). Lazy so apps that never decrypt can boot without it. */
@Injectable()
export class ConfigEncryptionKeyProvider implements EncryptionKeyProvider {
  private key?: Buffer;

  constructor(private readonly config: ConfigService) {}

  async getKey(_tenantId: string): Promise<Buffer> {
    if (!this.key) {
      const key = Buffer.from(
        this.config.getOrThrow<string>(RUNTIME_CONFIG.ENCRYPTION_KEY),
        'base64',
      );
      if (key.length !== KEY_BYTES)
        throw new Error(
          `${RUNTIME_CONFIG.ENCRYPTION_KEY} must decode to ${KEY_BYTES} bytes`,
        );
      this.key = key;
    }
    return this.key;
  }
}
