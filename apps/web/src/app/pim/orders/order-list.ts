import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { orderStatusSchema } from '@repo/shared-types';
import { errorMessage } from '../forms';
import { PimApi, type ListParams } from '../pim-api';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-order-list',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Orders</h1>
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Status</mat-label>
        <select matNativeControl data-testid="status-select" (change)="status.set($any($event.target).value || undefined); skip.set(0)">
          <option value="">All</option>
          @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </mat-form-field>
      <form class="flex items-center gap-2" (submit)="$event.preventDefault(); applySearch()">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <input matInput data-testid="search-input" [formControl]="searchControl" />
        </mat-form-field>
        <button mat-stroked-button type="submit" data-testid="search-button">Search</button>
      </form>
    </div>

    @if (orders.isError()) { <p class="text-red-600">{{ message(orders.error()) }}</p> }
    <table class="w-full text-left">
      <thead><tr><th>Order</th><th>Channel</th><th>Placed</th><th>Status</th><th>Supplier order</th><th>Total</th><th>Tracking</th></tr></thead>
      <tbody>
        @for (o of orders.data()?.items ?? []; track o.id) {
          <tr data-testid="order-row">
            <td><a [routerLink]="['/pim/orders', o.id]" class="underline">{{ o.externalId }}</a></td>
            <td>{{ o.channelCode }}</td>
            <td>{{ o.placedAt | date: 'short' : 'Europe/Lisbon' }}</td>
            <td data-testid="order-status">{{ o.status }}</td>
            <td>{{ o.supplierOrder?.externalOrderId ?? '-' }}</td>
            <td>{{ o.totalGross }} {{ o.currency }}</td>
            <td>{{ o.hasTracking ? 'yes' : 'no' }}</td>
          </tr>
        }
      </tbody>
    </table>
    <div class="mt-3 flex items-center gap-3">
      <button mat-button type="button" [disabled]="skip() === 0" (click)="skip.set(skip() - pageSize)">Previous</button>
      <span>{{ total() }} orders</span>
      <button mat-button type="button" [disabled]="skip() + pageSize >= total()" (click)="skip.set(skip() + pageSize)">Next</button>
    </div>
  `,
})
export class OrderList {
  private readonly api = inject(PimApi);
  protected readonly message = errorMessage;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly statuses = orderStatusSchema.options;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly status = signal<string | undefined>(undefined);
  protected readonly search = signal<string | undefined>(undefined);
  protected readonly skip = signal(0);

  private readonly params = computed<ListParams>(() => ({
    skip: this.skip(),
    take: PAGE_SIZE,
    ...(this.status() ? { status: this.status() } : {}),
    ...(this.search() ? { search: this.search() } : {}),
  }));

  protected readonly orders = injectQuery(() => ({
    queryKey: ['pim', 'orders', this.params()],
    queryFn: () => this.api.orders(this.params()),
    placeholderData: keepPreviousData,
  }));
  protected readonly total = computed(() => this.orders.data()?.meta.total ?? 0);

  protected applySearch(): void {
    this.search.set(this.searchControl.value.trim() || undefined);
    this.skip.set(0);
  }
}
