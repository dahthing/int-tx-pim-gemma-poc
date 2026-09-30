import type {
  BatchItemResult, BatchResult, ChannelListingPayload, ChannelListingResult, ChannelOrderRaw, ConnectionTestResult,
  ConnectorCapabilities, IChannelConnector, Page, PageCursor, PriceUpdate, PushShipmentCommand, StockUpdate,
} from '@repo/connector-contracts';
import { canonicalJson } from '@repo/core-domain';
import {
  HttpStatusError, NetworkError, redactText, ResilientHttpClient, TimeoutError,
  type FetchLike, type RequestLogSink,
} from '@repo/http-client';
import {
  activeBody, buildProductBody, formatPsDate, normalizeAddress, normalizeCountry, normalizeCustomer, normalizeOrder,
  orderHistoryBody, parseCarrierRecord, parseProductRecord, parseStockRecord, priceBody, quantityBody, sha256,
  trackingBody, type ProductRecord,
} from './mapper';
import type { PrestaShop9Settings } from './settings';
import { TokenRequestError } from './token-provider';
import { TransportRouter } from './transport';

export interface PrestaShop9ConnectorOptions {
  settings: PrestaShop9Settings;
  fetchImpl?: FetchLike;
  sink?: RequestLogSink;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Returns the subset of SKUs that exist in the PIM; orders with other SKUs are flagged manual_review. */
  knownSkus?: (skus: string[]) => Promise<Iterable<string>>;
}

const DEFAULT_PER_PAGE = 50;

export class PrestaShop9Connector implements IChannelConnector {
  readonly code = 'prestashop9';
  private readonly routes: TransportRouter;

  constructor(private readonly o: PrestaShop9ConnectorOptions) {
    const http = new ResilientHttpClient({
      connector: this.code, baseUrl: o.settings.baseUrl, fetchImpl: o.fetchImpl, sink: o.sink,
      now: o.now, sleep: o.sleep, maxAttempts: o.maxAttempts,
    });
    this.routes = new TransportRouter(o.settings, http, o.now);
  }

  capabilities(): ConnectorCapabilities {
    return {
      listingWrite: true, stockWrite: true, priceWrite: true, orderRead: true, shipmentWrite: true,
      catalogRead: false, assortmentWrite: false, stockRead: false, costRead: false, mediaRead: false,
      dropshipOrderWrite: false, trackingRead: false, categoryTreeRead: false,
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const shops = await this.routes.for('shops').list('shops', { limit: 1 });
      return { ok: true, accountName: shops[0]?.name ? String(shops[0].name) : undefined, currency: this.currency };
    } catch (e) {
      const message = redactText(e instanceof Error ? e.message : String(e));
      if (e instanceof TokenRequestError && e.status !== undefined && e.status >= 400 && e.status < 500) return { ok: false, reason: 'invalid_credentials', message };
      if (e instanceof HttpStatusError && (e.status === 401 || e.status === 403)) return { ok: false, reason: 'invalid_credentials', message };
      if (e instanceof NetworkError || e instanceof TimeoutError) return { ok: false, reason: 'unreachable', message };
      return { ok: false, reason: 'unknown', message };
    }
  }

  async upsertListing(l: ChannelListingPayload): Promise<ChannelListingResult> {
    const products = this.routes.for('products');
    const body = buildProductBody(products.kind, l, this.o.settings);
    const checksums = l.imageChecksums ?? l.imageUrls;
    const payloadHash = sha256(canonicalJson({ body, images: [...checksums].sort(), stock: Math.max(0, l.stock) }));
    const status = l.active ? 'live' : 'inactive';

    if (l.externalId && l.lastPayloadHash === payloadHash) {
      return { externalId: l.externalId, status, skipped: true, reason: 'payload_unchanged', payloadHash, imageChecksums: checksums };
    }

    let id = l.externalId;
    if (!id) id = (await this.findBy('reference', l.sku))?.id ?? (l.ean ? (await this.findBy('ean13', l.ean))?.id : undefined);
    const isNew = !id;
    if (id) {
      await products.update('products', id, body);
    } else {
      id = parseProductRecord(products.kind, await products.create('products', body)).id;
    }

    await this.setStock(id, l.stock);

    const prev = l.lastImageChecksums;
    const unchanged = !isNew && prev !== undefined && sameSet(prev, checksums);
    if (!unchanged) await this.replaceImages(id, l.imageUrls, !isNew);
    return { externalId: id, status, payloadHash, imageChecksums: checksums };
  }

  async updateStock(items: StockUpdate[]): Promise<BatchResult> {
    return batch(items, (i) => i.externalId, (i) => this.setStock(i.externalId, i.available));
  }

  async updatePrice(items: PriceUpdate[]): Promise<BatchResult> {
    const products = this.routes.for('products');
    return batch(items, (i) => i.externalId, async (i) => {
      await products.update('products', i.externalId, priceBody(products.kind, i.priceNet));
    });
  }

  async deactivateListing(externalId: string): Promise<void> {
    const products = this.routes.for('products');
    await products.update('products', externalId, activeBody(products.kind, false));
  }

  async listOrdersSince(since: Date, cursor?: PageCursor): Promise<Page<ChannelOrderRaw>> {
    const orders = this.routes.for('orders');
    const page = cursor?.page ?? 1;
    const perPage = cursor?.perPage ?? DEFAULT_PER_PAGE;
    const s = this.o.settings;
    const raw = await orders.list('orders', {
      filter: { current_state: s.paidStateIds.map(String) },
      since: { field: 'date_upd', value: formatPsDate(since) },
      sort: 'date_upd_ASC', limit: perPage, offset: (page - 1) * perPage,
    });
    const paid = new Set(s.paidStateIds.map(String));
    const seen = new Set<string>();
    const normalized = raw
      .map((r) => normalizeOrder(orders.kind, r))
      .filter((o) => paid.has(o.currentState) && !seen.has(o.id) && !!seen.add(o.id));

    const known = this.o.knownSkus
      ? new Set(await this.o.knownSkus([...new Set(normalized.flatMap((o) => o.lines.map((x) => x.sku)))]))
      : undefined;
    const customers = new Map<string, Promise<ReturnType<typeof normalizeCustomer>>>();
    const countries = new Map<string, Promise<string>>();
    const memo = <T>(m: Map<string, Promise<T>>, key: string, f: () => Promise<T>) => (m.has(key) ? m.get(key)! : m.set(key, f()).get(key)!);

    const items: ChannelOrderRaw[] = [];
    for (const o of normalized) {
      const customer = o.customerId
        ? await memo(customers, o.customerId, async () => { const t = this.routes.for('customers'); return normalizeCustomer(t.kind, await t.get('customers', o.customerId!)); })
        : { name: '', email: null };
      const t = this.routes.for('addresses');
      const addr = o.addressId ? normalizeAddress(t.kind, await t.get('addresses', o.addressId)) : undefined;
      const countryCode = addr?.countryId
        ? await memo(countries, addr.countryId, async () => { const c = this.routes.for('countries'); return normalizeCountry(c.kind, await c.get('countries', addr.countryId)).isoCode; })
        : '';
      const item: ChannelOrderRaw = {
        externalId: o.id, externalStatus: o.currentState, placedAt: new Date(o.placedAt), currency: this.currency, total: o.total ?? '0',
        customer: { name: customer.name, email: customer.email, phone: addr?.phone ?? null },
        shippingAddress: {
          fullName: addr?.fullName ?? customer.name, email: customer.email, phone: addr?.phone ?? null, line1: addr?.line1 ?? '',
          line2: addr?.line2 ?? null, postalCode: addr?.postalCode ?? '', city: addr?.city ?? '', countryCode,
        },
        lines: o.lines.map((x) => ({ sku: x.sku, externalLineId: x.lineId, quantity: x.quantity, unitPrice: x.unitPrice })),
      };
      const unknown = known ? [...new Set(o.lines.map((x) => x.sku).filter((k) => !known.has(k)))] : [];
      if (unknown.length) item.manualReview = { reason: 'unknown_sku', unknownSkus: unknown };
      items.push(item);
    }
    return { items, nextCursor: raw.length >= perPage ? { page: page + 1, perPage } : null };
  }

  async pushShipment(cmd: PushShipmentCommand): Promise<void> {
    const orders = this.routes.for('orders');
    const carriers = this.routes.for('order_carriers');
    const order = normalizeOrder(orders.kind, await orders.get('orders', cmd.externalOrderId));
    const rows = await carriers.list('order_carriers', { filter: { id_order: cmd.externalOrderId } });
    if (!rows.length) throw new Error(`Order ${cmd.externalOrderId} has no order carrier`);
    const carrier = parseCarrierRecord(carriers.kind, rows[rows.length - 1]!);
    await carriers.update('order_carriers', carrier.id, trackingBody(carriers.kind, cmd.trackingNumber));
    const shipped = this.o.settings.shippedStateId;
    if (order.currentState !== String(shipped)) {
      const histories = this.routes.for('order_histories');
      await histories.create('order_histories', orderHistoryBody(histories.kind, cmd.externalOrderId, shipped));
    }
  }

  private get currency(): string {
    return this.o.settings.currency ?? 'EUR';
  }

  private async findBy(field: 'reference' | 'ean13', value: string): Promise<ProductRecord | undefined> {
    const products = this.routes.for('products');
    const rows = await products.list('products', { filter: { [field]: value }, limit: 1 });
    return rows[0] ? parseProductRecord(products.kind, rows[0]) : undefined;
  }

  private async setStock(productId: string, qty: number): Promise<void> {
    const t = this.routes.for('stock_availables');
    const rows = await t.list('stock_availables', { filter: { id_product: productId, id_product_attribute: '0' }, limit: 1 });
    if (!rows[0]) throw new Error(`No stock_available row for product ${productId}`);
    await t.update('stock_availables', parseStockRecord(t.kind, rows[0]).id, quantityBody(t.kind, qty));
  }

  private async replaceImages(productId: string, urls: string[], removeExisting: boolean): Promise<void> {
    const t = this.routes.for('images');
    if (removeExisting) for (const imageId of await t.listImages(productId)) await t.removeImage(productId, imageId);
    for (const url of urls) await t.addImage(productId, url);
  }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

async function batch<T>(items: T[], idOf: (i: T) => string, run: (i: T) => Promise<void>): Promise<BatchResult> {
  const results: BatchItemResult[] = [];
  for (const item of items) {
    try {
      await run(item);
      results.push({ externalId: idOf(item), ok: true });
    } catch (e) {
      results.push({ externalId: idOf(item), ok: false, error: redactText(e instanceof Error ? e.message : String(e)) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return { results, okCount, failCount: results.length - okCount };
}
