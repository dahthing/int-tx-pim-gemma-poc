import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QueryClient, injectMutation } from '@tanstack/angular-query-experimental';
import type { ProductDetail } from '@repo/shared-types';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';

/**
 * FR-ENR-002 AC4: only a human "Approve" moves an `ai_draft` to `approved`. Approve stays disabled until a
 * valid AI draft exists (a stored draft with content, and no validation errors from the last generation).
 */
@Component({
  selector: 'app-enrichment-tab',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <p class="mb-3">Status: <strong data-testid="enrichment-status">{{ product().enrichmentStatus }}</strong></p>

    <div class="mb-4 flex gap-2">
      <button mat-stroked-button type="button" data-testid="generate-button" [disabled]="generate.isPending()" (click)="generate.mutate()">
        <mat-icon>auto_awesome</mat-icon> Generate
      </button>
      <button mat-flat-button type="button" data-testid="approve-button" [disabled]="!canApprove()" (click)="approve()">
        <mat-icon>check</mat-icon> Approve
      </button>
    </div>

    @if (errors().length > 0) {
      <ul class="mb-4 text-red-600" data-testid="enrichment-errors">
        @for (e of errors(); track $index) { <li data-testid="enrichment-error">{{ e }}</li> }
      </ul>
    }
    @if (generate.isError()) { <p class="text-red-600">{{ message(generate.error()) }}</p> }
    @if (approveMutation.isError()) { <p class="text-red-600">{{ message(approveMutation.error()) }}</p> }

    @if (product().enrichment; as draft) {
      <section data-testid="draft-preview">
        <h3 class="font-medium">{{ product().titlePt }}</h3>
        <p>{{ product().shortDescriptionPt }}</p>
        <ul class="list-disc pl-6">
          @for (b of draft.bulletPoints; track $index) { <li>{{ b }}</li> }
        </ul>
        <p>SEO title: {{ draft.seoTitle }}</p>
        <p>SEO description: {{ draft.seoDescription }}</p>
      </section>
    } @else {
      <p>No enrichment yet.</p>
    }
  `,
})
export class EnrichmentTab {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  readonly product = input.required<ProductDetail>();
  protected readonly errors = signal<string[]>([]);
  private approving = false;

  protected readonly canApprove = computed(
    () =>
      this.product().enrichmentStatus === 'ai_draft' &&
      this.product().enrichment !== null &&
      this.errors().length === 0 &&
      !this.approveMutation.isPending(),
  );

  protected readonly generate = injectMutation(() => ({
    mutationFn: () => this.api.generateEnrichment(this.product().id),
    onSuccess: (result) => {
      this.errors.set(result.ok ? [] : (result.errors ?? ['The generated content was rejected.']));
      return this.refresh();
    },
  }));

  protected readonly approveMutation = injectMutation(() => ({
    mutationFn: () => this.api.approveEnrichment(this.product().id),
    onSuccess: () => this.refresh(),
    onSettled: () => (this.approving = false),
  }));

  protected approve(): void {
    if (!this.canApprove() || this.approving) return;
    this.approving = true;
    this.approveMutation.mutate();
  }

  private refresh() {
    return this.queryClient.invalidateQueries({ queryKey: ['pim', 'product', this.product().id] });
  }
}
