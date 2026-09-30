import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ChannelOrderRaw, PageCursor } from '@repo/connector-contracts';
import { encryptSecret } from '@repo/core-domain';
import { DatabaseService } from '@repo/database';
import { MANUAL_REVIEW_REASONS, PIM_ORDERS_DEFAULTS, PIM_ORDERS_TOKENS } from './constants';
import { classifyChannelStatus } from './channel-status';
import { asJson, asRecord, errorMessage } from './json';
import { encodeOrderLines } from './order-lines.codec';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderStateService } from './order-state.service';
import { ShipmentService } from './shipment.service';
import type {
  ChannelConnectorResolver,
  EncryptionKeyProvider,
  OrderRoutingEnqueuer,
} from './ports';

export interface ImportSummary {
  fetched: number;
  imported: number;
  manualReview: number;
  duplicates: number;
  failed: number;
  enqueueFailed: number;
  /** Known orders the channel cancelled (FR-ORD-001 AC2). */
  cancelled: number;
  /** Known orders the channel reports delivered (FR-TEMU-004 AC2). */
  delivered: number;
  /** Unknown orders already cancelled / delivered on the channel: never imported. */
  ignored: number;
}

type Outcome = 'imported' | 'manual_review' | 'duplicate' | 'cancelled' | 'delivered' | 'ignored';

interface ChannelCtx {
  code: string;
  settings: unknown;
}

@Injectable()
export class ChannelOrderImportService {
  private readonly logger = new Logger(ChannelOrderImportService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER) private readonly connectors: ChannelConnectorResolver,
    @Inject(PIM_ORDERS_TOKENS.ENCRYPTION_KEY_PROVIDER) private readonly keys: EncryptionKeyProvider,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ROUTING_ENQUEUER) private readonly routing: OrderRoutingEnqueuer,
    private readonly cancellation: OrderCancellationService,
    private readonly shipments: ShipmentService,
    private readonly states: OrderStateService,
  ) {}

  async importChannel(tenantId: string, channelId: string): Promise<ImportSummary> {
    const channel = await this.db.channel.findFirst({ where: { id: channelId, tenantId, deletedAt: null } });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);

    const settings = asRecord(channel.settings);
    const cursorKey = PIM_ORDERS_DEFAULTS.ORDER_CURSOR_SETTING;
    const since = new Date(String(settings[cursorKey] ?? PIM_ORDERS_DEFAULTS.ORDER_POLL_EPOCH));
    const connector = await this.connectors.resolve({ id: channel.id, tenantId, code: channel.code, settings: channel.settings });
    const key = await this.keys.getKey(tenantId);

    const summary: ImportSummary = { fetched: 0, imported: 0, manualReview: 0, duplicates: 0, failed: 0, enqueueFailed: 0, cancelled: 0, delivered: 0, ignored: 0 };
    let newest: Date | null = null;
    let cursor: PageCursor | undefined;
    do {
      const page = await connector.listOrdersSince(since, cursor);
      for (const raw of page.items) {
        summary.fetched++;
        if (!newest || raw.placedAt > newest) newest = raw.placedAt;
        try {
          const outcome = await this.importOne(tenantId, channelId, raw, key, summary, channel);
          if (outcome === 'duplicate') summary.duplicates++;
          else if (outcome === 'cancelled') summary.cancelled++;
          else if (outcome === 'delivered') summary.delivered++;
          else if (outcome === 'ignored') summary.ignored++;
          else if (outcome === 'manual_review') summary.manualReview++;
          else summary.imported++;
        } catch (e) {
          summary.failed++;
          this.logger.error(`Import of ${raw.externalId} failed: ${errorMessage(e)}`);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    // Never move the cursor past an order we failed to persist.
    if (newest && summary.failed === 0) {
      await this.db.channel.update({
        where: { id: channelId },
        data: { settings: asJson({ ...settings, [cursorKey]: newest.toISOString() }) },
      });
    }
    return summary;
  }

  private async importOne(
    tenantId: string,
    channelId: string,
    raw: ChannelOrderRaw,
    key: Buffer,
    summary: ImportSummary,
    channel: ChannelCtx,
  ): Promise<Outcome> {
    const existing = await this.db.channelOrder.findUnique({
      where: { channelId_externalId: { channelId, externalId: raw.externalId } },
    });
    const kind = classifyChannelStatus(channel.code, channel.settings, raw.externalStatus);
    if (existing) return this.syncKnownOrder(tenantId, existing, raw.externalStatus, kind);
    // Orders that are already over on the channel are only ever tracked, never imported.
    if (kind !== 'open') return 'ignored';

    const reviewReason = await this.reviewReason(tenantId, raw);
    const created = await this.persist(tenantId, channelId, raw, key, reviewReason);
    if (created === null) return 'duplicate';
    if (reviewReason) return 'manual_review';

    try {
      await this.routing.enqueueRouting({ tenantId, channelOrderId: created.id });
    } catch (e) {
      summary.enqueueFailed++;
      this.logger.error(`Routing enqueue for ${created.id} failed: ${errorMessage(e)}`);
    }
    return 'imported';
  }

  /**
   * A known order: store the new external status and act on a channel-side cancellation (FR-ORD-001 AC2) or delivery
   * (FR-TEMU-004 AC2). The status is stored only after the action succeeded, so a failed attempt is retried by the next poll.
   */
  private async syncKnownOrder(
    tenantId: string,
    existing: { id: string; externalStatus: string | null; internalStatus: string },
    externalStatus: string,
    kind: 'cancelled' | 'delivered' | 'open',
  ): Promise<Outcome> {
    if (existing.externalStatus === externalStatus) return 'duplicate';
    let outcome: Outcome = 'duplicate';
    if (kind === 'cancelled') {
      await this.cancellation.handleChannelCancellation(tenantId, existing.id);
      outcome = 'cancelled';
    } else if (kind === 'delivered') {
      if (this.states.canReach(existing.internalStatus, 'COMPLETED')) {
        await this.shipments.markDelivered(tenantId, existing.id, new Date());
        outcome = 'delivered';
      } else {
        this.logger.warn(`Order ${existing.id} is ${existing.internalStatus}; channel delivery cannot complete it`);
      }
    }
    await this.db.channelOrder.update({ where: { id: existing.id }, data: { externalStatus } });
    return outcome;
  }

  private async reviewReason(tenantId: string, raw: ChannelOrderRaw): Promise<string | null> {
    if (raw.manualReview) return raw.manualReview.reason;
    const skus = [...new Set(raw.lines.map((l) => l.sku))];
    const known = await this.db.product.findMany({
      where: { tenantId, deletedAt: null, sku: { in: skus } },
      select: { sku: true },
    });
    const knownSkus = new Set(known.map((p) => p.sku));
    return skus.every((s) => knownSkus.has(s)) ? null : MANUAL_REVIEW_REASONS.UNKNOWN_SKU;
  }

  private async persist(
    tenantId: string,
    channelId: string,
    raw: ChannelOrderRaw,
    key: Buffer,
    reviewReason: string | null,
  ): Promise<{ id: string } | null> {
    try {
      return await this.db.channelOrder.create({
        data: {
          tenantId,
          channelId,
          externalId: raw.externalId,
          externalStatus: raw.externalStatus,
          placedAt: raw.placedAt,
          customer: encryptSecret(JSON.stringify(raw.customer), key),
          shippingAddress: encryptSecret(JSON.stringify(raw.shippingAddress), key),
          lines: asJson(
            encodeOrderLines({ items: raw.lines, shipByAt: raw.shipByAt ?? null, manualReviewReason: reviewReason }),
          ),
          totalGross: raw.total,
          currency: raw.currency,
          internalStatus: reviewReason ? 'MANUAL_REVIEW' : 'IMPORTED',
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === PIM_ORDERS_DEFAULTS.PRISMA_UNIQUE_VIOLATION) return null;
      throw e;
    }
  }
}
