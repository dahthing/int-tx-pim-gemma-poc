import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';
import { ChannelsTab } from './channels-tab';
import { EnrichmentTab } from './enrichment-tab';
import { PricingTab } from './pricing-tab';

@Component({
  selector: 'app-product-detail',
  imports: [MatButtonModule, MatIconModule, MatTabsModule, ChannelsTab, EnrichmentTab, PricingTab],
  template: `
    @if (product.isError()) {
      <p data-testid="product-error" class="text-red-600">{{ message(product.error()) }}</p>
    }
    @if (product.data(); as p) {
      <h1 class="mb-1 text-2xl font-semibold" data-testid="product-sku">{{ p.sku }}</h1>
      <p class="mb-4">{{ p.titlePt }} - {{ p.status }}</p>

      <mat-tab-group>
        <mat-tab label="Info">
          <dl class="grid grid-cols-2 gap-2 p-4">
            <dt>EAN</dt><dd>{{ p.ean }}</dd>
            <dt>Brand</dt><dd>{{ p.brand }}</dd>
            <dt>Weight (g)</dt><dd>{{ p.weightG }}</dd>
            <dt>Enrichment</dt><dd>{{ p.enrichmentStatus }}</dd>
            @if (p.supplier; as s) {
              <dt>Supplier product</dt><dd>{{ s.name }} ({{ s.stock }} in stock, cost {{ s.costPrice }})</dd>
            }
            <dt>Description</dt><dd>{{ p.shortDescriptionPt }}</dd>
          </dl>
        </mat-tab>
        <mat-tab label="Media">
          <div class="p-4">
            <button mat-stroked-button type="button" data-testid="import-media" [disabled]="importMedia.isPending()" (click)="importMedia.mutate()">
              <mat-icon>cloud_download</mat-icon> Import media
            </button>
            @if (importMedia.data(); as r) { <span class="ml-2">Imported {{ r.imported }}, skipped {{ r.skipped }}, failed {{ r.failed }}</span> }
            <ul>
              @for (m of p.media; track m.id) { <li>{{ m.position }}. {{ m.url ?? m.sourceUrl }}</li> }
            </ul>
          </div>
        </mat-tab>
        <mat-tab label="Enrichment"><div class="p-4"><app-enrichment-tab [product]="p" /></div></mat-tab>
        <mat-tab label="Pricing"><div class="p-4"><app-pricing-tab [productId]="p.id" /></div></mat-tab>
        <mat-tab label="Channels"><div class="p-4"><app-channels-tab [product]="p" /></div></mat-tab>
      </mat-tab-group>
    }
  `,
})
export class ProductDetailPage {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  /** Route param `:id`, bound through `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly product = injectQuery(() => ({
    queryKey: ['pim', 'product', this.id()],
    queryFn: () => this.api.product(this.id()),
  }));

  protected readonly importMedia = injectMutation(() => ({
    mutationFn: () => this.api.importMedia(this.id()),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'product', this.id()] }),
  }));
}
