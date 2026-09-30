export const REDACTED = '[REDACTED]';

const SENSITIVE = 'authorization|token|secret|password|passwd|api[_-]?key|cookie|credential';
const SENSITIVE_KEY = new RegExp(SENSITIVE, 'i');

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Redacts userinfo and sensitive query parameters of a URL (absolute or relative). */
export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    for (const key of [...new Set(url.searchParams.keys())]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return input
      .replace(/\/\/[^/@\s?#]*@/, '//')
      .replace(/([?&])([^=&#]*)=([^&#]*)/g, (m, sep: string, key: string) =>
        isSensitiveKey(key) ? `${sep}${key}=${REDACTED}` : m,
      );
  }
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = isSensitiveKey(k) ? REDACTED : v;
  return out;
}

const KEY_VALUE = new RegExp(
  `(["']?)\\b([\\w-]*(?:${SENSITIVE})[\\w-]*)\\1(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s&,;"']+)`,
  'gi',
);

/** Best-effort redaction for free text (error messages, non-JSON bodies). */
export function redactText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/g, (m) => redactUrl(m))
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(KEY_VALUE, `$1$2$1$3${REDACTED}`);
}

function redactDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redactDeep(v, seen);
  }
  return out;
}

function redactString(s: string): string {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.stringify(redactDeep(JSON.parse(t), new WeakSet()));
    } catch {
      /* not JSON: fall through */
    }
  }
  return redactText(s);
}

/** Deep, non-mutating redaction of objects, JSON strings and plain strings. */
export function redact(value: unknown): unknown {
  return redactDeep(value, new WeakSet());
}
