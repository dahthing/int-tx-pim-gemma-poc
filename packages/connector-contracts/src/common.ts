export interface PageCursor {
  page?: number;
  perPage?: number;
  token?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: PageCursor | null;
  total?: number;
}

export type ConnectionTestResult =
  | { ok: true; accountName?: string; currency?: string; balance?: string }
  | { ok: false; reason: 'invalid_credentials' | 'reauthorization_required' | 'unreachable' | 'unknown'; message?: string };

export interface BatchItemResult {
  externalId: string;
  ok: boolean;
  error?: string;
}

export interface BatchResult {
  results: BatchItemResult[];
  okCount: number;
  failCount: number;
}
