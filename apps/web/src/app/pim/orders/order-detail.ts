import { DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';
import { ManualTrackingForm } from './manual-tracking-form';

const RETRYABLE = new Set(['imported', 'routing', 'supplier_failed', 'manual_review', 'tracking_missing']);
const TRACKING_STATES = new Set(['supplier_submitted', 'supplier_dispatched', 'tracking_missing']);

@Component({
  selector: 'app-order-detail',
  imports: [DatePipe, MatButtonModule, MatIconModule, ManualTrackingForm],
  template: `
    @if (order.isError()) { <p class="text-red-600">{{ message(order.error()) }}</p> }
    @if (order.data(); as o) {
      <h1 class="mb-1 text-2xl font-semibold" data-testid="order-external-id">{{ o.externalId }}</h1>
      <p class="mb-4">
        {{ o.channelCode }} - <strong data-testid="order-status">{{ o.status }}</strong>
        - placed {{ o.placedAt | date: 'short' : 'Europe/Lisbon' }}
        @if (o.manualReviewReason) { - review: {{ o.manualReviewReason }} }
      </p>

      <button mat-stroked-button type="button" data-testid="retry-button" [disabled]="!canRetry() || retry.isPending()" (click)="retry.mutate()">
        <mat-icon>replay</mat-icon> Retry
      </button>
      @if (retry.isError()) { <span class="ml-2 text-red-600">{{ message(retry.error()) }}</span> }

      @if (o.supplierOrder; as s) {
        <h2 class="mt-4 text-lg font-medium">Supplier order</h2>
        <p data-testid="supplier-order">{{ s.externalOrderId ?? s.id }} - {{ s.state }} @if (s.lastError) { - {{ s.lastError }} }</p>
      }

      <h2 class="mt-4 text-lg font-medium">Lines</h2>
      <ul>
        @for (l of o.lines; track $index) { <li data-testid="order-line">{{ l.quantity }} x {{ l.sku }} @ {{ l.unitPrice }}</li> }
      </ul>

      <h2 class="mt-4 text-lg font-medium">Shipments</h2>
      <ul>
        @for (s of o.shipments; track s.id) {
          <li>{{ s.carrierName ?? s.carrierCode }} {{ s.trackingNumber }} ({{ s.source }}){{ s.pushError ? ' - ' + s.pushError : '' }}</li>
        } @empty { <li>No shipments.</li> }
      </ul>

      @if (showTrackingForm()) {
        <h2 class="mt-4 text-lg font-medium">Manual tracking</h2>
        <app-manual-tracking-form [orderId]="o.id" />
      }
    }
  `,
})
export class OrderDetailPage {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  /** Route param `:id`, bound through `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly order = injectQuery(() => ({
    queryKey: ['pim', 'order', this.id()],
    queryFn: () => this.api.order(this.id()),
  }));

  protected readonly canRetry = computed(() => RETRYABLE.has(this.order.data()?.status ?? ''));
  protected readonly showTrackingForm = computed(() => TRACKING_STATES.has(this.order.data()?.status ?? ''));

  protected readonly retry = injectMutation(() => ({
    mutationFn: () => this.api.retryOrder(this.id()),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'order', this.id()] }),
  }));
}
