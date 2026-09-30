import { Injectable } from '@nestjs/common';
import { HttpStatusError, NetworkError } from '@repo/http-client';
import type { DownloadedMedia, MediaDownloader } from '@repo/pim-catalog';
import { RUNTIME_DEFAULTS } from '../runtime.constants';

export interface HttpMediaDownloaderOptions {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Binary download. The http-client `HttpResponse` is text-only, so this uses fetch directly but keeps
 * the package's redacting error types (tokens in signed media URLs never reach logs).
 */
@Injectable()
export class HttpMediaDownloader implements MediaDownloader {
  private readonly fetchImpl: (
    url: string,
    init: RequestInit,
  ) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: HttpMediaDownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((u, i) => globalThis.fetch(u, i));
    this.timeoutMs = options.timeoutMs ?? RUNTIME_DEFAULTS.MEDIA_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? RUNTIME_DEFAULTS.MEDIA_MAX_BYTES;
  }

  async download(url: string): Promise<DownloadedMedia> {
    if (!/^https?:\/\//i.test(url))
      throw new Error('Media URL must use http or https');
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new NetworkError({ method: 'GET', url, cause });
    }
    if (!res.ok)
      throw new HttpStatusError({ method: 'GET', url, status: res.status });
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > this.maxBytes)
      throw new Error(`Media too large (${data.length} bytes)`);
    const header = res.headers.get('content-type')?.split(';')[0]?.trim();
    return { data, mime: header || this.mimeFromUrl(url) };
  }

  private mimeFromUrl(url: string): string {
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
    return (ext && EXTENSION_MIME[ext]) || 'application/octet-stream';
  }
}
