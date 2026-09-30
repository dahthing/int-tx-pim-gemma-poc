import { redactText, redactUrl } from './redact';

export interface HttpErrorInit {
  method: string;
  url: string;
  message?: string;
}

export class HttpError extends Error {
  readonly method: string;
  readonly url: string;
  constructor(message: string, init: { method: string; url: string }, options?: ErrorOptions) {
    super(redactText(message), options);
    this.name = new.target.name;
    this.method = init.method;
    this.url = redactUrl(init.url);
  }
}

export class HttpStatusError extends HttpError {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(init: HttpErrorInit & { status: number; bodySnippet?: string }) {
    super(init.message ?? `HTTP ${init.status} ${init.method} ${redactUrl(init.url)}`, init);
    this.status = init.status;
    this.bodySnippet = init.bodySnippet ?? '';
  }
}

export class NetworkError extends HttpError {
  constructor(init: HttpErrorInit & { cause?: unknown }) {
    const reason = init.cause instanceof Error ? init.cause.message : String(init.cause ?? 'unknown');
    super(
      init.message ?? `Network error ${init.method} ${redactUrl(init.url)}: ${reason}`,
      init,
      { cause: init.cause },
    );
  }
}

export class TimeoutError extends HttpError {
  readonly timeoutMs: number;
  constructor(init: HttpErrorInit & { timeoutMs: number }) {
    super(
      init.message ?? `Timeout after ${init.timeoutMs}ms ${init.method} ${redactUrl(init.url)}`,
      init,
    );
    this.timeoutMs = init.timeoutMs;
  }
}
