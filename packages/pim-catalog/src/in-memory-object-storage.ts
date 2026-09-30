import type { ObjectStorage } from './ports';

/** Fake S3-compatible storage for tests and local development. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  constructor(private readonly baseUrl = 'https://storage.local') {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
