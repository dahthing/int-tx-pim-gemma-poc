import { Inject, Injectable } from '@nestjs/common';
import type { StockUpdate } from '@repo/connector-contracts';
import { DatabaseService } from '@repo/database';
import type { ListingStockZeroer } from '@repo/pim-catalog';
import {
  PIM_ORDERS_TOKENS,
  type ChannelConnectorResolver,
  type ChannelRef,
} from '@repo/pim-orders';

/** FR-ING-001 AC3: a product missing at the supplier is sold out on every channel right away. */
@Injectable()
export class ConnectorListingStockZeroer implements ListingStockZeroer {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER)
    private readonly connectors: ChannelConnectorResolver,
  ) {}

  async zeroStock(tenantId: string, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const listings = await this.db.channelListing.findMany({
      where: {
        tenantId,
        productId: { in: productIds },
        deletedAt: null,
        externalId: { not: null },
      },
      include: { channel: true },
    });
    const byChannel = new Map<
      string,
      { ref: ChannelRef; items: StockUpdate[] }
    >();
    for (const l of listings) {
      if (!l.externalId) continue;
      const entry = byChannel.get(l.channelId) ?? {
        ref: {
          id: l.channel.id,
          tenantId,
          code: l.channel.code,
          settings: l.channel.settings,
        },
        items: [],
      };
      entry.items.push({
        externalId: l.externalId,
        ...(l.externalVariantId && { externalVariantId: l.externalVariantId }),
        available: 0,
      });
      byChannel.set(l.channelId, entry);
    }
    // Record the zero locally first: the next sync must not resurrect the old stock if a channel call fails.
    await this.db.channelListing.updateMany({
      where: { tenantId, productId: { in: productIds } },
      data: { lastStock: 0 },
    });
    for (const { ref, items } of byChannel.values()) {
      const connector = await this.connectors.resolve(ref);
      await connector.updateStock(items);
    }
  }
}
