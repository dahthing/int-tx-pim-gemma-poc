import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { enrichmentStatusSchema, productStatusSchema } from '@repo/shared-types';
import { errorMessage } from '../forms';
import { PimApi, type ListParams } from '../pim-api';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-product-list',
  imports: [RouterLink, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Products</h1>
    <div class="mb-4 flex gap-3">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Status</mat-label>
        <select matNativeControl data-testid="status-select" (change)="status.set($any($event.target).value || undefined); skip.set(0)">
          <option value="">All</option>
          @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Enrichment</mat-label>
        <select matNativeControl data-testid="enrichment-select" (change)="enrichment.set($any($event.target).value || undefined); skip.set(0)">
          <option value="">All</option>
          @for (s of enrichmentStatuses; track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </mat-form-field>
    </div>

    @if (products.isError()) {
      <p class="text-red-600">{{ message(products.error()) }}</p>
    }
    <table class="w-full text-left">
      <thead><tr><th>SKU</th><th>Title</th><th>Status</th><th>Enrichment</th><th>Channels</th></tr></thead>
      <tbody>
        @for (item of products.data()?.items ?? []; track item.id) {
          <tr data-testid="product-row">
            <td><a [routerLink]="['/pim/products', item.id]" class="underline">{{ item.sku }}</a></td>
            <td>{{ item.titlePt }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.enrichmentStatus }}</td>
            <td>
              <mat-chip-set>
                @for (l of item.listings; track l.channelId) {
                  <mat-chip data-testid="listing-chip">{{ l.channelCode }}: {{ l.status }}</mat-chip>
                }
              </mat-chip-set>
            </td>
          </tr>
        }
      </tbody>
    </table>
    <div class="mt-3 flex items-center gap-3">
      <button mat-button type="button" [disabled]="skip() === 0" (click)="skip.set(skip() - pageSize)">Previous</button>
      <span>{{ total() }} products</span>
      <button mat-button type="button" [disabled]="skip() + pageSize >= total()" (click)="skip.set(skip() + pageSize)">Next</button>
    </div>
  `,
})
export class ProductListPage {
  private readonly api = inject(PimApi);
  protected readonly message = errorMessage;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly statuses = productStatusSchema.options;
  protected readonly enrichmentStatuses = enrichmentStatusSchema.options;

  protected readonly status = signal<string | undefined>(undefined);
  protected readonly enrichment = signal<string | undefined>(undefined);
  protected readonly skip = signal(0);

  private readonly params = computed<ListParams>(() => ({
    skip: this.skip(),
    take: PAGE_SIZE,
    ...(this.status() ? { status: this.status() } : {}),
    ...(this.enrichment() ? { enrichmentStatus: this.enrichment() } : {}),
  }));

  protected readonly products = injectQuery(() => ({
    queryKey: ['pim', 'products', this.params()],
    queryFn: () => this.api.products(this.params()),
    placeholderData: keepPreviousData,
  }));
  protected readonly total = computed(() => this.products.data()?.meta.total ?? 0);
}
