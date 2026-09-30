import { createHash } from 'node:crypto';

export interface ContentFields {
  name?: string;
  shortDescription?: string;
  description?: string;
  ean?: string;
  categories?: string[];
  weightG?: number | string;
  imageUrl?: string;
  imageUrls?: string[];
}

const CONTENT_KEYS = ['name', 'shortDescription', 'description', 'ean', 'categories', 'weightG', 'imageUrl', 'imageUrls'] as const;

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const parts = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 (hex) of the canonical JSON of content fields only; price and stock are ignored. */
export function contentHash(content: ContentFields): string {
  const picked: Record<string, unknown> = {};
  for (const k of CONTENT_KEYS) if (content[k] !== undefined) picked[k] = content[k];
  return createHash('sha256').update(canonicalJson(picked)).digest('hex');
}
