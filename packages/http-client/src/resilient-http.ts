import { HttpStatusError, NetworkError, TimeoutError } from './errors';
import { RateLimiter, defaultSleep } from './rate-limiter';
import { redact, redactUrl } from './redact';

export interface RequestLogEntry {
  connector: string;
  method: string;
  /** Redacted. */
  url: string;
  status?: number;
  durationMs: number;
  correlationId: string;
  /** Redacted error message. */
  error?: string;
  /** 1-based attempt number. */
  attempt: number;
}

export interface RequestLogSink {
  log(entry: RequestLogEntry): void | Promise<void>;
}

export interface HttpResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  text: string;
  json<T = unknown>(): T;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>;
  /** Per attempt, ms. */
  timeout?: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResilientHttpClientOptions {
  connector: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  sink?: RequestLogSink;
  rateLimiter?: { acquire(): Promise<void> };
  requestsPerSecond?: number;
  burst?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  defaultTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  correlationIdGenerator?: () => string;
}

const SNIPPET_MAX = 500;

export class ResilientHttpClient {
  readonly rateLimiter?: { acquire(): Promise<void> };
  private readonly o: Required<
    Pick<
      ResilientHttpClientOptions,
      | 'maxAttempts'
      | 'baseDelayMs'
      | 'maxDelayMs'
      | 'defaultTimeoutMs'
      | 'now'
      | 'sleep'
      | 'random'
      | 'correlationIdGenerator'
    >
  >;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: ResilientHttpClientOptions) {
    this.o = {
      maxAttempts: opts.maxAttempts ?? 5,
      baseDelayMs: opts.baseDelayMs ?? 500,
      maxDelayMs: opts.maxDelayMs ?? 30_000,
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 30_000,
      now: opts.now ?? Date.now,
      sleep: opts.sleep ?? defaultSleep,
      random: opts.random ?? Math.random,
      correlationIdGenerator: opts.correlationIdGenerator ?? (() => crypto.randomUUID()),
    };
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.rateLimiter =
      opts.rateLimiter ??
      (opts.requestsPerSecond
        ? new RateLimiter({
            requestsPerSecond: opts.requestsPerSecond,
            burst: opts.burst,
            now: this.o.now,
            sleep: this.o.sleep,
          })
        : undefined);
  }

  async request(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    const verb = method.toUpperCase();
    const target = this.buildUrl(url, options.query);
    const safeUrl = redactUrl(target);
    const correlationId = this.o.correlationIdGenerator();
    const timeoutMs = options.timeout ?? this.o.defaultTimeoutMs;
    const headers = { ...(options.headers ?? {}) };
    const has = (name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name);
    if (!has('x-correlation-id')) headers['x-correlation-id'] = correlationId;
    let body: string | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'string') body = options.body;
      else {
        body = JSON.stringify(options.body);
        if (!has('content-type')) headers['content-type'] = 'application/json';
      }
    }

    for (let attempt = 1; ; attempt++) {
      await this.rateLimiter?.acquire();
      const started = this.o.now();
      let status: number | undefined;
      let failure: HttpStatusError | NetworkError | TimeoutError | undefined;
      let response: HttpResponse | undefined;
      let retryAfterMs: number | undefined;

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const res = await this.fetchImpl(target, {
          method: verb,
          headers,
          body,
          signal: controller.signal,
        });
        const text = await res.text();
        status = res.status;
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => (resHeaders[k.toLowerCase()] = v));
        if (res.status >= 200 && res.status < 300) {
          response = { status: res.status, headers: resHeaders, text, json: () => parseJson(text) };
        } else {
          failure = new HttpStatusError({
            status: res.status,
            method: verb,
            url: safeUrl,
            bodySnippet: snippet(text),
          });
          retryAfterMs = this.parseRetryAfter(resHeaders['retry-after']);
        }
      } catch (err) {
        failure = timedOut
          ? new TimeoutError({ method: verb, url: safeUrl, timeoutMs })
          : new NetworkError({ method: verb, url: safeUrl, cause: err });
      } finally {
        clearTimeout(timer);
      }

      await this.emit({
        connector: this.opts.connector,
        method: verb,
        url: safeUrl,
        status,
        durationMs: this.o.now() - started,
        correlationId,
        error: failure?.message,
        attempt,
      });

      if (response) return response;
      const f = failure!;
      const retryable =
        !(f instanceof HttpStatusError) ||
        f.status === 408 ||
        f.status === 429 ||
        f.status >= 500;
      if (!retryable || attempt >= this.o.maxAttempts) throw f;
      await this.o.sleep(retryAfterMs ?? this.backoff(attempt));
    }
  }

  private backoff(attempt: number): number {
    const exp = this.o.baseDelayMs * 2 ** (attempt - 1);
    return Math.min(this.o.maxDelayMs, exp * (1 + this.o.random() * 0.25));
  }

  private parseRetryAfter(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * 1000;
    const date = Date.parse(v);
    return Number.isNaN(date) ? undefined : Math.max(0, date - this.o.now());
  }

  private buildUrl(url: string, query: RequestOptions['query']): string {
    const u = this.opts.baseUrl
      ? new URL(url.replace(/^\/+/, ''), this.opts.baseUrl.replace(/\/*$/, '/'))
      : new URL(url);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      for (const item of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(item));
    }
    return u.toString();
  }

  private async emit(entry: RequestLogEntry): Promise<void> {
    if (!this.opts.sink) return;
    try {
      await this.opts.sink.log(entry);
    } catch {
      /* logging must never break a request */
    }
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response body is not valid JSON');
  }
}

function snippet(text: string): string {
  const red = String(redact(text));
  return red.length > SNIPPET_MAX ? `${red.slice(0, SNIPPET_MAX)}…` : red;
}
