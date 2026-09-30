import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectStorage } from '@repo/pim-catalog';
import { RUNTIME_CONFIG, RUNTIME_DEFAULTS } from '../runtime.constants';
import { sha256Hex, signRequestV4 } from './sigv4';

export type S3Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Buffer },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const encodeKey = (key: string): string =>
  key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
const trimSlash = (s: string): string => s.replace(/\/+$/, '');

/** S3-compatible storage (MinIO locally) over plain fetch with SigV4: no SDK dependency. Path-style addressing. */
@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: S3Fetch = (url, init) =>
      globalThis.fetch(url, init as RequestInit),
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const endpoint = trimSlash(
      this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_ENDPOINT),
    );
    const bucket = this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_BUCKET);
    const signed = signRequestV4({
      method: 'PUT',
      url: `${endpoint}/${bucket}/${encodeKey(key)}`,
      headers: { 'content-type': contentType },
      payloadSha256: sha256Hex(body),
      region:
        this.config.get<string>(RUNTIME_CONFIG.S3_REGION) ??
        RUNTIME_DEFAULTS.S3_REGION,
      service: 's3',
      accessKey: this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_ACCESS_KEY),
      secretKey: this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_SECRET_KEY),
    });
    const res = await this.fetchImpl(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });
    if (!res.ok)
      throw new Error(`Object storage PUT failed with HTTP ${res.status}`);
  }

  publicUrl(key: string): string {
    const base = this.config.get<string>(RUNTIME_CONFIG.S3_PUBLIC_BASE_URL);
    if (base) return `${trimSlash(base)}/${encodeKey(key)}`;
    return `${trimSlash(this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_ENDPOINT))}/${this.config.getOrThrow<string>(RUNTIME_CONFIG.S3_BUCKET)}/${encodeKey(key)}`;
  }
}
