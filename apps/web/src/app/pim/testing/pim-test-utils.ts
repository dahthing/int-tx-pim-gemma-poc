import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { PimApi } from '../pim-api';

/** Providers for a PIM screen under test: a retry-less query client, a fake `PimApi` and an empty router. */
export function providePimTesting(api: Partial<Record<keyof PimApi, unknown>>) {
  return [
    provideTanStackQuery(
      new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
    ),
    provideRouter([]),
    { provide: PimApi, useValue: api },
  ];
}

/**
 * Polls with real macrotask ticks + detectChanges until `predicate` holds — TanStack Query's pending-task
 * integration does not reliably unblock `whenStable()` here (same approach as dashboard.spec.ts).
 */
export async function waitUntil(
  fixture: ComponentFixture<unknown>,
  predicate: () => unknown = () => true,
  attempts = 60,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    fixture.detectChanges();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitUntil: condition not met in time');
}

export function el<T extends HTMLElement = HTMLElement>(fixture: ComponentFixture<unknown>, testId: string): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${testId}"]`);
}

export function els<T extends HTMLElement = HTMLElement>(fixture: ComponentFixture<unknown>, testId: string): T[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll<T>(`[data-testid="${testId}"]`)];
}

/** Sets a native input/select/textarea value and fires the events Angular listens to. */
export function setValue(element: HTMLElement | null, value: string): void {
  const control = element as HTMLInputElement | null;
  if (!control) throw new Error('setValue: element not found');
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}
