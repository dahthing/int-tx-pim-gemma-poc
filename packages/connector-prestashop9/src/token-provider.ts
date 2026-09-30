import { HttpStatusError, NetworkError, TimeoutError, type ResilientHttpClient } from '@repo/http-client';
import { parseToken } from './mapper';

export class TokenRequestError extends Error {
  constructor(readonly status: number | undefined) {
    super(`PrestaShop token request failed${status ? ` with HTTP ${status}` : ''}`);
    this.name = 'TokenRequestError';
  }
}

export interface TokenProviderOptions {
  http: ResilientHttpClient;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  /** Injectable clock, epoch ms. */
  now?: () => number;
}

const SAFETY_MARGIN_MS = 60_000;

/** OAuth2 client credentials token, cached until 60 s before expiry. */
export class TokenProvider {
  private token?: { value: string; refreshAt: number };
  private inflight?: Promise<string>;
  private readonly now: () => number;

  constructor(private readonly o: TokenProviderOptions) {
    this.now = o.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) return this.token.value;
    this.inflight ??= this.fetchToken().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  invalidate(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.o.clientId, client_secret: this.o.clientSecret });
    if (this.o.scopes?.length) form.set('scope', this.o.scopes.join(' '));
    let parsed: ReturnType<typeof parseToken>;
    try {
      const res = await this.o.http.request('POST', this.o.tokenUrl, {
        body: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      });
      parsed = parseToken(res.json());
    } catch (e) {
      // Never forward the original error: it may echo the client secret.
      if (e instanceof HttpStatusError) throw new TokenRequestError(e.status);
      if (e instanceof NetworkError || e instanceof TimeoutError) throw e;
      throw new TokenRequestError(undefined);
    }
    this.token = { value: parsed.accessToken, refreshAt: this.now() + parsed.expiresInSec * 1000 - SAFETY_MARGIN_MS };
    return parsed.accessToken;
  }
}
