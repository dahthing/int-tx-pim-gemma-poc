import { CATEGORY_PATH_SEPARATOR } from '@repo/pim-catalog';

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;
/** Prisma Decimal | string | number | null -> decimal string | null. */
export const dec = (
  v: { toString(): string } | null | undefined,
): string | null => (v === null || v === undefined ? null : v.toString());
export const lower = <T extends string>(v: T): Lowercase<T> =>
  v.toLowerCase() as Lowercase<T>;
export const upper = <T extends string>(v: T): Uppercase<T> =>
  v.toUpperCase() as Uppercase<T>;

/** Mirrors pim-catalog's normalizedKey (not exported by that package): lookup key of a supplier category path. */
export function normalizeSegment(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function pathKey(
  department?: string | null,
  sub?: string | null,
  family?: string | null,
): string {
  return [department, sub, family]
    .map(normalizeSegment)
    .join(CATEGORY_PATH_SEPARATOR);
}

/** Validates a client supplied sort column against a whitelist (never pass raw input to Prisma `orderBy`). */
export function orderBy(
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  allowed: readonly string[],
  fallback: string,
): Record<string, 'asc' | 'desc'> {
  return { [allowed.includes(sortBy) ? sortBy : fallback]: sortOrder };
}
