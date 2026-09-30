import type {
  BatchItemResult,
  BatchResult,
  ChannelAttributeSpec,
  ChannelCategory,
  ChannelListingPayload,
  ChannelListingResult,
  ChannelOrderRaw,
  ConnectionTestResult,
  ConnectorCapabilities,
  IChannelConnector,
  Page,
  PageCursor,
  PriceUpdate,
  PushShipmentCommand,
  StockUpdate,
} from '@repo/connector-contracts';
import {
  HttpStatusError,
  NetworkError,
  ResilientHttpClient,
  TimeoutError,
  type FetchLike,
  type RequestLogSink,
} from '@repo/http-client';
import { resolveCarrier, type CarrierTable } from './carriers';
import { formatMissing, validateListing, type ListingValidationOptions } from './listing-validator';
import { PendingPriceTracker, type PendingPriceStore } from './pending-price';
import { mapReviewStatus, type ReviewOutcome } from './review';
import { PlaceholderSigner, type Signer } from './signing';
import {
  TEMU_METHODS,
  TemuApiClient,
  TemuApiError,
  goodsBody,
  isCredentialError,
  isTokenError,
  parseAttributes,
  parseCategories,
  parseOrder,
  shipmentBody,
  type ItemResult,
  type RawOrder,
  type RawShipping,
} from './temu-api';
import { AWAITING_SHIPMENT } from './order-import';

export interface TemuEuConnectorConfig {
  /** EU gateway host, e.g. https://... (never hardcoded). */
  gatewayHost: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  carrierTable: CarrierTable;
  signer?: Signer;
  fetchImpl?: FetchLike;
  sink?: RequestLogSink;
  pendingPrices?: PendingPriceStore;
  validation?: ListingValidationOptions;
  requestsPerSecond?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export interface PriceReviewOutcome {
  externalId: string;
  outcome: 'approved' | 'rejected';
  reason?: string;
}

const PAGE_SIZE = 20;

export class TemuEuConnector implements IChannelConnector {
  readonly code = 'temu-eu';
  private readonly api: TemuApiClient;
  private readonly pending: PendingPriceStore;
  private readonly now: () => Date;
  private readonly attrCache = new Map<string, ChannelAttributeSpec[]>();

  constructor(private readonly cfg: TemuEuConnectorConfig) {
    this.now = cfg.now ?? (() => new Date());
    this.pending = cfg.pendingPrices ?? new PendingPriceTracker();
    this.api = new TemuApiClient({
      http: new ResilientHttpClient({
        connector: this.code,
        baseUrl: cfg.gatewayHost,
        fetchImpl: cfg.fetchImpl,
        sink: cfg.sink,
        requestsPerSecond: cfg.requestsPerSecond,
        maxAttempts: cfg.maxAttempts,
      }),
      signer: cfg.signer ?? new PlaceholderSigner(),
      appKey: cfg.appKey,
      appSecret: cfg.appSecret,
      accessToken: cfg.accessToken,
      now: this.now,
    });
  }

  capabilities(): ConnectorCapabilities {
    return { listingWrite: true, stockWrite: true, priceWrite: true, orderRead: true, shipmentWrite: true, categoryTreeRead: true };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const r = await this.api.call<{ mallName?: string; currency?: string }>(TEMU_METHODS.shopInfo);
      return { ok: true, accountName: r.mallName, currency: r.currency };
    } catch (e) {
      if (e instanceof TemuApiError) {
        if (isTokenError(e)) return { ok: false, reason: 'reauthorization_required', message: e.message };
        if (isCredentialError(e)) return { ok: false, reason: 'invalid_credentials', message: e.message };
        return { ok: false, reason: 'unknown', message: e.message };
      }
      if (e instanceof HttpStatusError) {
        if (e.status === 401 || e.status === 403) return { ok: false, reason: 'reauthorization_required', message: e.message };
        if (e.status >= 500) return { ok: false, reason: 'unreachable', message: e.message };
      }
      if (e instanceof NetworkError || e instanceof TimeoutError) return { ok: false, reason: 'unreachable', message: e.message };
      return { ok: false, reason: 'unknown', message: (e as Error).message };
    }
  }

  async getCategoryTree(): Promise<ChannelCategory[]> {
    return parseCategories(await this.api.call(TEMU_METHODS.categoryTree));
  }

  async getCategoryAttributes(categoryId: string): Promise<ChannelAttributeSpec[]> {
    const cached = this.attrCache.get(categoryId);
    if (cached) return cached;
    const specs = parseAttributes(await this.api.call(TEMU_METHODS.categoryAttributes, { categoryId }));
    this.attrCache.set(categoryId, specs);
    return specs;
  }

  async upsertListing(listing: ChannelListingPayload): Promise<ChannelListingResult> {
    const specs = listing.categoryId.trim() ? await this.getCategoryAttributes(listing.categoryId) : [];
    const check = validateListing(listing, specs, this.cfg.validation);
    if (!check.ok) {
      return { externalId: listing.externalId ?? '', status: 'inactive', skipped: true, reason: formatMissing(check.missing) };
    }
    const method = listing.externalId ? TEMU_METHODS.goodsUpdate : TEMU_METHODS.goodsAdd;
    const r = await this.api.call<{ goodsId: string; skuId?: string }>(method, { goods: goodsBody(listing) });
    return { externalId: r.goodsId, ...(r.skuId ? { externalVariantId: r.skuId } : {}), status: 'submitted' };
  }

  /** Review polling job: maps Temu review status onto submitted / live / rejected. */
  async pollReviewStatus(externalIds: string[]): Promise<ReviewOutcome[]> {
    if (externalIds.length === 0) return [];
    const r = await this.api.call<{ reviews: Array<{ goodsId: string; status: string; reason?: string }> }>(
      TEMU_METHODS.goodsReview,
      { goodsIds: externalIds },
    );
    return r.reviews.map((x) => ({ externalId: x.goodsId, ...mapReviewStatus(x) }));
  }

  async updateStock(items: StockUpdate[]): Promise<BatchResult> {
    if (items.length === 0) return summarize([]);
    const payload = items.map((i) => ({
      goodsId: i.externalId,
      skuId: i.externalVariantId,
      quantity: Math.max(0, Math.floor(i.available)),
    }));
    return this.batch(TEMU_METHODS.stockUpdate, { items: payload }, items.map((i) => i.externalId));
  }

  async updatePrice(items: PriceUpdate[]): Promise<BatchResult> {
    const skipped: BatchItemResult[] = [];
    const toSend: PriceUpdate[] = [];
    for (const i of items) {
      if (this.pending.isPending(i.externalId)) {
        skipped.push({ externalId: i.externalId, ok: true, skipped: true, error: 'price change pending Temu review' });
      } else toSend.push(i);
    }
    if (toSend.length === 0) return summarize(skipped);
    const sent = await this.batch(
      TEMU_METHODS.priceUpdate,
      { items: toSend.map((i) => ({ goodsId: i.externalId, skuId: i.externalVariantId, price: i.priceNet })) },
      toSend.map((i) => i.externalId),
      (r) => {
        if (r.success && r.pendingReview) {
          const p = toSend.find((i) => i.externalId === r.goodsId);
          if (p) this.pending.markPending(p.externalId, p.priceNet, this.now());
        }
      },
    );
    return summarize([...sent.results, ...skipped]);
  }

  /** Resolves pending price changes once Temu has reviewed them. */
  async pollPendingPrices(): Promise<PriceReviewOutcome[]> {
    const ids = this.pending.pendingIds();
    if (ids.length === 0) return [];
    const r = await this.api.call<{ results: Array<{ goodsId: string; status: string; reason?: string }> }>(
      TEMU_METHODS.priceReview,
      { goodsIds: ids },
    );
    const out: PriceReviewOutcome[] = [];
    for (const x of r.results) {
      if (x.status === 'APPROVED') out.push({ externalId: x.goodsId, outcome: 'approved' });
      else if (x.status === 'REJECTED') out.push({ externalId: x.goodsId, outcome: 'rejected', reason: x.reason });
      else continue;
      this.pending.resolve(x.goodsId);
    }
    return out;
  }

  async deactivateListing(externalId: string): Promise<void> {
    await this.api.call(TEMU_METHODS.goodsOffline, { goodsId: externalId });
  }

  async listOrdersSince(since: Date, cursor?: PageCursor): Promise<Page<ChannelOrderRaw>> {
    const pageNo = cursor?.page ?? 1;
    const pageSize = cursor?.perPage ?? PAGE_SIZE;
    const list = await this.api.call<{ total: number; orders: RawOrder[] }>(TEMU_METHODS.orderList, {
      status: AWAITING_SHIPMENT,
      updatedSince: Math.floor(since.getTime() / 1000),
      pageNo,
      pageSize,
    });
    const items: ChannelOrderRaw[] = [];
    for (const o of list.orders) {
      const ship = await this.api.call<RawShipping>(TEMU_METHODS.shippingInfoDecrypt, { orderSn: o.orderSn });
      items.push(parseOrder(o, ship));
    }
    return {
      items,
      total: list.total,
      nextCursor: pageNo * pageSize < list.total ? { page: pageNo + 1, perPage: pageSize } : null,
    };
  }

  async pushShipment(cmd: PushShipmentCommand): Promise<void> {
    const carrier = resolveCarrier(this.cfg.carrierTable, cmd.carrierCode);
    if (!cmd.trackingNumber.trim()) throw new Error('Tracking number is required to confirm a shipment');
    await this.api.call(TEMU_METHODS.shipmentConfirm, shipmentBody(cmd, carrier));
  }

  private async batch(
    method: string,
    body: Record<string, unknown>,
    ids: string[],
    onItem?: (r: ItemResult) => void,
  ): Promise<BatchResult> {
    let results: ItemResult[];
    try {
      results = (await this.api.call<{ results: ItemResult[] }>(method, body)).results;
    } catch (e) {
      return summarize(ids.map((externalId) => ({ externalId, ok: false, error: (e as Error).message })));
    }
    return summarize(
      ids.map((externalId): BatchItemResult => {
        const r = results.find((x) => x.goodsId === externalId);
        if (!r) return { externalId, ok: false, error: 'missing from Temu response' };
        onItem?.(r);
        return r.success ? { externalId, ok: true } : { externalId, ok: false, error: r.errorMsg ?? 'rejected by Temu' };
      }),
    );
  }
}

function summarize(results: BatchItemResult[]): BatchResult {
  const okCount = results.filter((r) => r.ok).length;
  return { results, okCount, failCount: results.length - okCount };
}
