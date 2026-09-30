import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';

@Component({
  selector: 'app-pim-dashboard',
  imports: [DatePipe, MatButtonModule, MatChipsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">PIM dashboard</h1>

    @if (dashboard.isPending()) {
      <mat-spinner diameter="32" />
    }
    @if (dashboard.isError()) {
      <p data-testid="dashboard-error" class="text-red-600">{{ message(dashboard.error()) }}</p>
    }
    @if (dashboard.data(); as data) {
      <div class="mb-6 flex flex-wrap gap-4" data-testid="counts">
        <span>Failed syncs (24h): {{ data.counts.failedSyncRuns24h }}</span>
        <span>Open alerts: {{ data.counts.openAlerts }}</span>
        <span>Failed orders: {{ data.counts.failedOrders }}</span>
        <span>Manual review: {{ data.counts.manualReviewOrders }}</span>
        <span>Missing supplier products: {{ data.counts.missingSupplierProducts }}</span>
      </div>

      <div class="mb-2 flex items-center gap-2">
        <h2 class="text-lg font-medium">Latest sync runs</h2>
        <button mat-stroked-button type="button" data-testid="sync-catalog" (click)="sync.mutate('catalog')">
          <mat-icon>sync</mat-icon> Sync catalogue
        </button>
        <button mat-stroked-button type="button" data-testid="sync-stock" (click)="sync.mutate('stock-cost')">
          <mat-icon>sync</mat-icon> Sync stock/cost
        </button>
      </div>
      <table class="mb-6 w-full text-left">
        <thead>
          <tr><th>Job</th><th>Connector</th><th>Status</th><th>Started</th><th>Errors</th></tr>
        </thead>
        <tbody>
          @for (run of data.lastSyncRuns; track run.id) {
            <tr data-testid="sync-run">
              <td>{{ run.kind }}</td>
              <td>{{ run.connector }}</td>
              <td>{{ run.status }}</td>
              <td>{{ run.startedAt | date: 'short' : 'Europe/Lisbon' }}</td>
              <td>{{ run.errorSummary }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5">No sync runs yet.</td></tr>
          }
        </tbody>
      </table>

      <h2 class="mb-2 text-lg font-medium">Alerts</h2>
      <ul>
        @for (alert of data.alerts; track alert.id) {
          <li data-testid="alert" class="flex items-center gap-3 py-1">
            <mat-icon>warning</mat-icon>
            <span class="font-medium">{{ alert.type }}</span>
            <span class="grow">{{ alert.message }}</span>
            <button
              mat-button
              type="button"
              data-testid="ack-button"
              [disabled]="acknowledge.isPending()"
              (click)="acknowledge.mutate(alert.id)"
            >
              Acknowledge
            </button>
          </li>
        } @empty {
          <li>No open alerts.</li>
        }
      </ul>
    }
  `,
})
export class PimDashboard {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  protected readonly dashboard = injectQuery(() => ({
    queryKey: ['pim', 'dashboard'],
    queryFn: () => this.api.dashboard(),
  }));

  protected readonly acknowledge = injectMutation(() => ({
    mutationFn: (id: string) => this.api.acknowledgeAlert(id),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'dashboard'] }),
  }));

  protected readonly sync = injectMutation(() => ({
    mutationFn: (kind: 'catalog' | 'stock-cost') => this.api.triggerSync(kind),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'dashboard'] }),
  }));
}
