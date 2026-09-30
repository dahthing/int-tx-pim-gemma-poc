import type { Prisma } from '@repo/database';

export const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

export function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Error text safe to persist (no stack, bounded). */
export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 500);
}
