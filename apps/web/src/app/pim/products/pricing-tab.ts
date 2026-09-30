import { Component, inject, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';

const REASONS: Record<string, string> = {
  MARGIN_BELOW_MIN: 'Margin below minimum',
  NON_POSITIVE_PRICE: 'Price is not positive',
};

@Component({
  selector: 'app-pricing-tab',
  imports: [MatButtonModule, MatChipsModule],
  template: `
    @if (pricing.isError()) { <p class="text-red-600">{{ message(pricing.error()) }}</p> }
    <table class="w-full text-left">
      <thead><tr><th>Channel</th><th>Net</th><th>Gross</th><th>Margin</th><th>Status</th><th></th></tr></thead>
      <tbody>
        @for (q of pricing.data()?.quotes ?? []; track q.channelId) {
          <tr data-testid="quote-row">
            <td>{{ q.channelCode }}</td>
            <td>{{ q.net ?? '-' }}</td>
            <td>{{ q.gross ?? '-' }}</td>
            <td>{{ percent(q.marginPct) }}</td>
            <td>
              @if (q.status === 'blocked') {
                <mat-chip data-testid="blocked-badge">blocked</mat-chip>
                <span data-testid="blocked-reason">{{ reason(q.reason, q.error) }}</span>
              } @else {
                ok
              }
            </td>
            <td>
              <button mat-button type="button" (click)="requote.mutate(q.channelId)">Recalculate</button>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class PricingTab {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  readonly productId = input.required<string>();

  protected readonly pricing = injectQuery(() => ({
    queryKey: ['pim', 'pricing', this.productId()],
    queryFn: () => this.api.pricing(this.productId()),
  }));

  protected readonly requote = injectMutation(() => ({
    mutationFn: (channelId: string) => this.api.quotePrice(this.productId(), { channelId }),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'pricing', this.productId()] }),
  }));

  protected percent(fraction: string | null): string {
    return fraction === null ? '-' : `${(Number(fraction) * 100).toFixed(1)}%`;
  }

  protected reason(code: string | null, error: string | null): string {
    return (code ? (REASONS[code] ?? code) : '') || (error ?? '');
  }
}
