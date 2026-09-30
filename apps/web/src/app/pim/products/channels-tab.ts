import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import type { ChannelSettings, ProductDetail } from '@repo/shared-types';
import { errorMessage } from '../forms';
import { PimApi } from '../pim-api';

/** One channel: readiness (what is still missing), publish and unpublish. */
@Component({
  selector: 'app-channel-panel',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <section data-testid="channel-panel" class="mb-4 rounded border p-3">
      <h3 class="font-medium">{{ channel().name ?? channel().code }} ({{ channel().code }})</h3>
      <p>Listing: {{ listing()?.status ?? 'none' }} @if (listing()?.lastError; as err) { - {{ err }} }</p>
      @if (readiness.data(); as r) {
        <p data-testid="readiness-status">{{ r.ready ? 'Ready to publish' : 'Not ready' }}</p>
        <ul class="list-disc pl-6">
          @for (m of r.missing; track $index) {
            <li data-testid="missing-item">{{ m.type }}: {{ m.name }}</li>
          }
        </ul>
      }
      @if (readiness.isError()) { <p class="text-red-600">{{ message(readiness.error()) }}</p> }
      @if (publishMutation.isError()) { <p class="text-red-600">{{ message(publishMutation.error()) }}</p> }
      <div class="mt-2 flex gap-2">
        <button mat-flat-button type="button" data-testid="publish-button" [disabled]="!readiness.data()?.ready || publishMutation.isPending()" (click)="publishMutation.mutate()">
          <mat-icon>publish</mat-icon> Publish
        </button>
        @if (canUnpublish()) {
          <button mat-stroked-button type="button" data-testid="unpublish-button" [disabled]="unpublishMutation.isPending()" (click)="unpublishMutation.mutate()">
            <mat-icon>unpublished</mat-icon> Unpublish
          </button>
        }
      </div>
    </section>
  `,
})
export class ChannelPanel {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;

  readonly product = input.required<ProductDetail>();
  readonly channel = input.required<ChannelSettings>();

  protected readonly listing = computed(() => this.product().listings.find((l) => l.channelId === this.channel().id));
  protected readonly canUnpublish = computed(() => {
    const status = this.listing()?.status;
    return status === 'live' || status === 'pending' || status === 'submitted';
  });

  protected readonly readiness = injectQuery(() => ({
    queryKey: ['pim', 'readiness', this.product().id, this.channel().id],
    queryFn: () => this.api.readiness(this.product().id, this.channel().id),
  }));

  protected readonly publishMutation = injectMutation(() => ({
    mutationFn: () => this.api.publish(this.product().id, this.channel().id),
    onSuccess: () => this.refresh(),
  }));

  protected readonly unpublishMutation = injectMutation(() => ({
    mutationFn: () => this.api.unpublish(this.product().id, this.channel().id),
    onSuccess: () => this.refresh(),
  }));

  private refresh() {
    return Promise.all([
      this.queryClient.invalidateQueries({ queryKey: ['pim', 'product', this.product().id] }),
      this.queryClient.invalidateQueries({ queryKey: ['pim', 'readiness', this.product().id] }),
    ]);
  }
}

@Component({
  selector: 'app-channels-tab',
  imports: [ChannelPanel],
  template: `
    @if (settings.isError()) { <p class="text-red-600">{{ message(settings.error()) }}</p> }
    @for (channel of settings.data()?.channels ?? []; track channel.id) {
      <app-channel-panel [product]="product()" [channel]="channel" />
    } @empty {
      <p>No channels configured. Add one in Settings.</p>
    }
  `,
})
export class ChannelsTab {
  private readonly api = inject(PimApi);
  protected readonly message = errorMessage;

  readonly product = input.required<ProductDetail>();

  protected readonly settings = injectQuery(() => ({
    queryKey: ['pim', 'settings'],
    queryFn: () => this.api.settings(),
  }));
}
