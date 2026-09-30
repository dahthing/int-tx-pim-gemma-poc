import { z } from 'zod';

/**
 * Form inputs yield `''` for an untouched optional field, which the shared request schemas (`.min(1)`,
 * fraction regexes, ...) would reject. Recursively maps blank strings to `undefined` and drops nested groups
 * that end up empty, so the same schema validates the raw form value and builds the request body.
 */
export function blankToUndefined(value: unknown): unknown {
  return normalise(value, true);
}

function normalise(value: unknown, isRoot: boolean): unknown {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (Array.isArray(value) || value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, normalise(child, false)] as const)
    .filter(([, child]) => child !== undefined);
  if (entries.length === 0 && !isRoot) return undefined;
  return Object.fromEntries(entries);
}

/** Wraps a shared request schema so it can be handed to `zodValidator()` on a form group with blank inputs. */
export function formSchema<T extends z.ZodType>(schema: T): z.ZodType {
  return z.preprocess(blankToUndefined, schema);
}

/** First human-readable message out of a `zodValidator` group error (`{ zod: { path: message } }`). */
export function zodMessages(errors: Record<string, unknown> | null): string[] {
  const zod = errors?.['zod'];
  if (typeof zod === 'string') return [zod];
  return zod && typeof zod === 'object' ? Object.values(zod as Record<string, string>) : [];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
