import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ChannelListingResult, IChannelConnector, PriceUpdate, StockUpdate } from '@repo/connector-contracts';
import { availableStock, calculatePrice, toDecimal } from '@repo/core-domain';
import type { ReviewOutcome } from '@repo/connector-temu-eu';
import { DatabaseService } from '@repo/database';
import { ORDER_ALERT_TYPES, PIM_ORDERS_TOKENS } from './constants';
import { asRecord, errorMessage } from './json';
import { decodeListingState, encodeListingState } from './listing-state.codec';
import type { ChannelConnectorResolver, ListingPayloadBuilder, ListingSyncInputProvider, OrderAlertPort } from './ports';

type ListingStatus = 'PENDING' | 'SUBMITTED' | 'LIVE' | 'REJECTED' | 'INACTIVE';

const STATUS_MAP: Record<ChannelListingResult['status'], ListingStatus> = {
  live: 'LIVE',
  submitted: 'SUBMITTED',
  rejected: 'REJECTED',
  inactive: 'INACTIVE',
};
/** Connector reason that only says "nothing changed": not an error. */
const UNCHANGED_REASON = 'payload_unchanged';

export interface PublishResult {
  status: ListingStatus;
  externalId: string;
  skipped: boolean;
}

export interface SyncSummary {
  considered: number;
  stockSent: number;
  priceSent: number;
  blocked: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface ReviewSummary {
  checked: number;
  live: number;
  rejected: number;
  pending: number;
  /** Pending price changes Temu approved / rejected (FR-TEMU-002 AC3). */
  priceApproved: number;
  priceRejected: number;
}

interface ReviewCapable {
  pollReviewStatus?(externalIds: string[]): Promise<ReviewOutcome[]>;
  pollPendingPrices?(): Promise<{ externalId: string; outcome: 'approved' | 'rejected'; reason?: string }[]>;
}

@Injectable()
export class ListingSyncService {
  private readonly logger = new Logger(ListingSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER) private readonly connectors: ChannelConnectorResolver,
    @Inject(PIM_ORDERS_TOKENS.LISTING_PAYLOAD_BUILDER) private readonly payloads: ListingPayloadBuilder,
    @Inject(PIM_ORDERS_TOKENS.LISTING_SYNC_INPUT_PROVIDER) private readonly inputs: ListingSyncInputProvider,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ALERT_PORT) private readonly alerts: OrderAlertPort,
  ) {}

  /** Publish or update one product on a channel. Round-trips the connector's hash / checksums. */
  async publishListing(tenantId: string, productId: string, channelId: string): Promise<PublishResult> {
    const { connector } = await this.channelAndConnector(tenantId, channelId);
    const where = { productId_channelId: { productId, channelId } };
    const existing = await this.db.channelListing.findFirst({ where: { tenantId, productId, channelId } });
    const prev = decodeListingState(existing?.lastPayloadHash);

    let result: ChannelListingResult;
    let payload;
    try {
      payload = await this.payloads.build(tenantId, productId, channelId);
      result = await connector.upsertListing({
        ...payload,
        externalId: existing?.externalId ?? payload.externalId,
        lastPayloadHash: prev.hash,
        lastImageChecksums: prev.imageChecksums,
      });
    } catch (e) {
      const lastError = errorMessage(e);
      await this.db.channelListing.upsert({
        where,
        create: { tenantId, productId, channelId, status: 'PENDING', lastError },
        update: { lastError },
      });
      throw e;
    }

    const status = STATUS_MAP[result.status];
    const reasonIsError = result.reason !== undefined && result.reason !== UNCHANGED_REASON;
    const lastError = result.skipped ? (reasonIsError ? result.reason! : null) : status === 'REJECTED' ? (result.reason ?? 'rejected') : null;
    const packed = result.payloadHash ? encodeListingState(result.payloadHash, result.imageChecksums ?? prev.imageChecksums) : existing?.lastPayloadHash ?? null;
    const shared = {
      status,
      ...(result.externalId && { externalId: result.externalId }),
      ...(result.externalVariantId && { externalVariantId: result.externalVariantId }),
      lastPayloadHash: packed,
      lastError,
      lastSyncedAt: new Date(),
    };
    // A skipped upsert sent nothing, so last_price / last_stock must not move.
    const sent = result.skipped ? {} : { lastPrice: payload.priceNet, lastStock: payload.stock };
    await this.db.channelListing.upsert({
      where,
      create: { tenantId, productId, channelId, ...shared, ...sent },
      update: { ...shared, ...sent },
    });
    return { status, externalId: result.externalId, skipped: result.skipped === true };
  }

  /** Changed-only stock / price batches. Margin-blocked prices are never sent. */
  async syncStockAndPrices(tenantId: string, channelId: string): Promise<SyncSummary> {
    const { connector } = await this.channelAndConnector(tenantId, channelId);
    const listings = await this.db.channelListing.findMany({
      where: { tenantId, channelId, deletedAt: null, status: 'LIVE', externalId: { not: null } },
    });
    const summary: SyncSummary = { considered: 0, stockSent: 0, priceSent: 0, blocked: 0, unchanged: 0, skipped: 0, failed: 0 };
    if (listings.length === 0) return summary;

    const inputs = new Map((await this.inputs.getInputs(tenantId, channelId, listings.map((l) => l.productId))).map((i) => [i.productId, i]));
    const stockItems: StockUpdate[] = [];
    const priceItems: PriceUpdate[] = [];
    const byExternal = new Map<string, (typeof listings)[number]>();
    const nextStock = new Map<string, number>();
    const nextPrice = new Map<string, string>();

    for (const l of listings) {
      const input = inputs.get(l.productId);
      if (!input) continue;
      summary.considered++;
      const externalId = l.externalId!;
      byExternal.set(externalId, l);
      try {
        const ref = { externalId, ...(l.externalVariantId && { externalVariantId: l.externalVariantId }) };
        const available = availableStock(input.stock);
        const price = calculatePrice(input.price);
        let changed = false;
        if (l.lastStock !== available) {
          stockItems.push({ ...ref, available });
          nextStock.set(externalId, available);
          changed = true;
        }
        if (price.status === 'blocked') {
          summary.blocked++;
          await this.alerts.raise({
            tenantId,
            type: ORDER_ALERT_TYPES.PRICE_BLOCKED,
            message: `Price for listing ${l.id} is blocked (${price.reason}); the channel keeps its last price`,
            dedupeKey: `${l.id}:price_blocked:${price.reason}`,
            metadata: { listingId: l.id, marginPct: price.marginPct },
          });
        } else if (l.lastPrice === null || l.lastPrice === undefined || !toDecimal(l.lastPrice.toString()).eq(toDecimal(price.net))) {
          priceItems.push({ ...ref, priceNet: price.net });
          nextPrice.set(externalId, price.net);
          changed = true;
        }
        if (!changed && price.status !== 'blocked') summary.unchanged++;
      } catch (e) {
        summary.failed++;
        this.logger.error(`Sync of listing ${l.id} failed: ${errorMessage(e)}`);
      }
    }

    if (stockItems.length) {
      const res = await connector.updateStock(stockItems);
      summary.stockSent = stockItems.length;
      await this.applyBatch(res.results, byExternal, (id) => ({ lastStock: nextStock.get(id) }), summary);
    }
    if (priceItems.length) {
      const res = await connector.updatePrice(priceItems);
      summary.priceSent = priceItems.length;
      await this.applyBatch(res.results, byExternal, (id) => ({ lastPrice: nextPrice.get(id) }), summary);
    }
    return summary;
  }

  /** Temu review polling: submitted -> live | rejected (with Temu's reason). */
  async pollReviews(tenantId: string, channelId: string): Promise<ReviewSummary> {
    const { connector } = await this.channelAndConnector(tenantId, channelId);
    const summary: ReviewSummary = { checked: 0, live: 0, rejected: 0, pending: 0, priceApproved: 0, priceRejected: 0 };
    const poller = connector as IChannelConnector & ReviewCapable;
    await this.pollPriceReviews(tenantId, channelId, poller, summary);
    if (typeof poller.pollReviewStatus !== 'function') return summary;

    const listings = await this.db.channelListing.findMany({
      where: { tenantId, channelId, deletedAt: null, status: 'SUBMITTED', externalId: { not: null } },
    });
    if (listings.length === 0) return summary;
    summary.checked = listings.length;

    const byExternal = new Map(listings.map((l) => [l.externalId!, l]));
    const outcomes = await poller.pollReviewStatus(listings.map((l) => l.externalId!));
    for (const o of outcomes) {
      const l = o.externalId ? byExternal.get(o.externalId) : undefined;
      if (!l) continue;
      if (o.status === 'live') {
        summary.live++;
        await this.db.channelListing.update({ where: { id: l.id }, data: { status: 'LIVE', lastError: null, lastSyncedAt: new Date() } });
      } else if (o.status === 'rejected') {
        summary.rejected++;
        await this.db.channelListing.update({ where: { id: l.id }, data: { status: 'REJECTED', lastError: o.reason ?? 'rejected', lastSyncedAt: new Date() } });
        await this.alerts.raise({
          tenantId,
          type: ORDER_ALERT_TYPES.LISTING_REJECTED,
          message: `Listing ${l.id} was rejected by the channel: ${o.reason ?? 'no reason given'}`,
          dedupeKey: `${l.id}:rejected`,
          metadata: { listingId: l.id, productId: l.productId },
        });
      } else {
        summary.pending++;
      }
    }
    return summary;
  }

  /** Resolves the price changes Temu was reviewing; without this a persisted pending price would block the listing forever. */
  private async pollPriceReviews(tenantId: string, channelId: string, poller: ReviewCapable, summary: ReviewSummary): Promise<void> {
    if (typeof poller.pollPendingPrices !== 'function') return;
    try {
      for (const o of await poller.pollPendingPrices()) {
        if (o.outcome === 'approved') {
          summary.priceApproved++;
          continue;
        }
        summary.priceRejected++;
        const reason = o.reason ?? 'no reason given';
        // Forget the price we believed was sent so the next sync sends it again (or the margin guard blocks it).
        await this.db.channelListing.updateMany({
          where: { tenantId, channelId, externalId: o.externalId, deletedAt: null },
          data: { lastPrice: null, lastError: `price rejected by the channel: ${reason}` },
        });
        await this.alerts.raise({
          tenantId,
          type: ORDER_ALERT_TYPES.PRICE_BLOCKED,
          message: `Price change for ${o.externalId} was rejected by the channel: ${reason}`,
          dedupeKey: `${channelId}:${o.externalId}:price_rejected`,
          metadata: { externalId: o.externalId, channelId },
        });
      }
    } catch (e) {
      this.logger.error(`Pending price poll failed: ${errorMessage(e)}`);
    }
  }

  private async applyBatch(
    results: { externalId: string; ok: boolean; error?: string; skipped?: boolean }[],
    byExternal: Map<string, { id: string }>,
    sentValue: (externalId: string) => Record<string, number | string | undefined>,
    summary: SyncSummary,
  ): Promise<void> {
    for (const r of results) {
      const l = byExternal.get(r.externalId);
      if (!l) continue;
      if (r.skipped) {
        summary.skipped++;
      } else if (!r.ok) {
        summary.failed++;
        await this.db.channelListing.update({ where: { id: l.id }, data: { lastError: r.error ?? 'update failed' } });
      } else {
        await this.db.channelListing.update({
          where: { id: l.id },
          data: { ...sentValue(r.externalId), lastError: null, lastSyncedAt: new Date() },
        });
      }
    }
  }

  private async channelAndConnector(tenantId: string, channelId: string) {
    const channel = await this.db.channel.findFirst({ where: { id: channelId, tenantId, deletedAt: null } });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);
    const connector = await this.connectors.resolve({ id: channel.id, tenantId, code: channel.code, settings: asRecord(channel.settings) });
    return { channel, connector };
  }
}
