import Decimal from 'decimal.js';
import type {
  AssortmentOverrides,
  ConnectionTestResult,
  ConnectorCapabilities,
  ISourceConnector,
  Page,
  PageCursor,
  PlaceDropshipOrderCommand,
  SupplierAssortmentItemRaw,
  SupplierMediaRaw,
  SupplierOrderProgress,
  SupplierOrderResult,
  SupplierOrderStatus,
  SupplierProductRaw,
} from '@repo/connector-contracts';
import {
  HttpStatusError,
  ResilientHttpClient,
  defaultSleep,
  paginate,
  redactText,
  type FetchLike,
  type HttpResponse,
  type RequestLogSink,
} from '@repo/http-client';
import {
  addressChecksum,
  mapImages,
  mapOrderStatus,
  mapPortfolioItem,
  mapProduct,
  mapTransaction,
  parseDecimal,
} from './aw-mappers';
import type { AwImage, AwLaravelPage, AwPortfolioItem, AwProduct, AwTransaction } from './aw.types';

export const AW_BASE_URLS = {
  production: 'https://api.aiku.io',
  staging: 'https://api.aiku-sandbox.uk',
} as const;

export interface AwAikuConnectorOptions {
  token: string;
  environment: keyof typeof AW_BASE_URLS;
  fetchImpl?: FetchLike;
  sink?: RequestLogSink;
  sleep?: (ms: number) => Promise<void>;
  /** Default 2 (FR-HTTP-001 AC3). */
  requestsPerSecond?: number;
  /** HTTP attempts per request (default 5). */
  maxAttempts?: number;
  /** Default 50, max 150. */
  perPage?: number;
  /** Extra saga-level attempts per step after the HTTP client gave up (default 3). */
  maxSagaRetries?: number;
  /** Called after every completed saga step so the caller can persist progress. */
  onProgress?: (progress: SupplierOrderProgress) => void | Promise<void>;
}

const INCLUDE = 'department,sub_department,family';
const MAX_PER_PAGE = 150;

class SagaAbort extends Error {
  constructor(readonly result: SupplierOrderResult) {
    super('saga aborted');
  }
}

export class AwAikuConnector implements ISourceConnector {
  readonly code = 'aw-aiku';
  private readonly http: ResilientHttpClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly perPage: number;
  private readonly sagaRetries: number;

  constructor(private readonly opts: AwAikuConnectorOptions) {
    this.sleep = opts.sleep ?? defaultSleep;
    this.perPage = opts.perPage ?? 50;
    this.sagaRetries = opts.maxSagaRetries ?? 3;
    this.http = new ResilientHttpClient({
      connector: this.code,
      baseUrl: AW_BASE_URLS[opts.environment],
      fetchImpl: opts.fetchImpl,
      sink: opts.sink,
      sleep: opts.sleep,
      requestsPerSecond: opts.requestsPerSecond ?? 2,
      maxAttempts: opts.maxAttempts,
    });
  }

  capabilities(): ConnectorCapabilities {
    return {
      catalogRead: true,
      assortmentWrite: true,
      stockRead: true,
      costRead: true,
      mediaRead: true,
      dropshipOrderWrite: true,
      trackingRead: false, // S0.1 unresolved
    };
  }

  // ---- plumbing -------------------------------------------------------------

  private scrub(text: string): string {
    const t = this.opts.token;
    return redactText(t ? text.split(t).join('[REDACTED]') : text);
  }

  private async call(
    method: string,
    path: string,
    o: { query?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<HttpResponse> {
    try {
      return await this.http.request(method, path, {
        ...o,
        headers: { authorization: `Bearer ${this.opts.token}`, accept: 'application/json' },
      });
    } catch (err) {
      if (err instanceof Error) {
        err.message = this.scrub(err.message);
        if (err instanceof HttpStatusError) (err as { bodySnippet: string }).bodySnippet = this.scrub(err.bodySnippet);
      }
      throw err;
    }
  }

  private async json<T>(method: string, path: string, o?: Parameters<AwAikuConnector['call']>[2]): Promise<T> {
    return (await this.call(method, path, o)).json<T>();
  }

  private pageSize(cursor?: PageCursor): number {
    return Math.min(MAX_PER_PAGE, Math.max(1, cursor?.perPage ?? this.perPage));
  }

  private toPage<R, T>(raw: AwLaravelPage<R>, page: number, perPage: number, map: (r: R) => T): Page<T> {
    const { current_page: cur, last_page: last } = raw.meta ?? {};
    const done = !raw.links?.next || (cur !== undefined && last !== undefined && cur >= last);
    return {
      items: (raw.data ?? []).map(map),
      nextCursor: done ? null : { page: (cur ?? page) + 1, perPage },
      total: undefined,
    };
  }

  // ---- FR-AW-001 ------------------------------------------------------------

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const res = await this.json<{ data?: { name?: string; currency_code?: string; balance?: string | number } }>(
        'GET',
        '/user-profile',
      );
      const d = res.data ?? {};
      return {
        ok: true,
        ...(d.name !== undefined && { accountName: d.name }),
        ...(d.currency_code !== undefined && { currency: d.currency_code }),
        ...(d.balance !== undefined && { balance: String(d.balance) }),
      };
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 401) return { ok: false, reason: 'invalid_credentials' };
      if (err instanceof HttpStatusError) return { ok: false, reason: 'unknown', message: `HTTP ${err.status}` };
      return { ok: false, reason: 'unreachable', message: this.scrub((err as Error).message) };
    }
  }

  // ---- FR-AW-002/003 --------------------------------------------------------

  async listCatalog(cursor?: PageCursor): Promise<Page<SupplierProductRaw>> {
    const page = cursor?.page ?? 1;
    const perPage = this.pageSize(cursor);
    const raw = await this.json<AwLaravelPage<AwProduct>>('GET', '/dropshipping/products', {
      query: { include: INCLUDE, page, per_page: perPage },
    });
    return this.toPage(raw, page, perPage, mapProduct);
  }

  /** Walks the whole catalogue. A failing page rejects after earlier pages were yielded. */
  async *walkCatalog(): AsyncGenerator<{ page: number; items: SupplierProductRaw[] }, void, undefined> {
    const perPage = this.pageSize();
    for await (const p of paginate<AwProduct>((req) =>
      this.json<AwLaravelPage<AwProduct>>('GET', '/dropshipping/products', {
        query: { include: INCLUDE, page: req.page, per_page: perPage },
      }),
    )) {
      yield { page: p.page, items: p.items.map(mapProduct) };
    }
  }

  // ---- FR-AW-004 ------------------------------------------------------------

  async listAssortment(cursor?: PageCursor): Promise<Page<SupplierAssortmentItemRaw>> {
    const page = cursor?.page ?? 1;
    const perPage = this.pageSize(cursor);
    const raw = await this.json<AwLaravelPage<AwPortfolioItem>>('GET', '/dropshipping/products/my-products', {
      query: { page, per_page: perPage },
    });
    return this.toPage(raw, page, perPage, mapPortfolioItem);
  }

  async addToAssortment(supplierProductId: string, _overrides?: AssortmentOverrides): Promise<SupplierAssortmentItemRaw> {
    const res = await this.json<{ data: AwPortfolioItem }>(
      'POST',
      `/dropshipping/products/my-products/${encodeURIComponent(supplierProductId)}/store`,
    );
    return mapPortfolioItem(res.data);
  }

  async removeFromAssortment(assortmentId: string): Promise<void> {
    await this.removeFromAssortmentWithStatus(assortmentId);
  }

  /** 'disabled' when AW disabled the portfolio entry instead of deleting it; both are success. */
  async removeFromAssortmentWithStatus(assortmentId: string): Promise<'deleted' | 'disabled'> {
    const res = await this.call('DELETE', `/dropshipping/products/my-products/${encodeURIComponent(assortmentId)}/delete`);
    return /disabled/i.test(res.text) ? 'disabled' : 'deleted';
  }

  // ---- FR-AW-005 ------------------------------------------------------------

  async listMedia(ref: { kind: 'product' | 'assortment'; id: string }): Promise<SupplierMediaRaw[]> {
    const res = await this.json<{ data?: AwImage[] }>('GET', '/dropshipping/images', {
      query: { id: ref.id, type: ref.kind === 'product' ? 'product' : 'portfolio' },
    });
    return mapImages(res.data ?? []);
  }

  // ---- FR-AW-007 ------------------------------------------------------------

  async getSupplierOrder(externalId: string): Promise<SupplierOrderStatus> {
    const id = encodeURIComponent(externalId);
    const order = (await this.json<{ data: AwOrder }>('GET', `/dropshipping/order/${id}`)).data;
    const tx = (await this.json<{ data?: AwTransaction[] }>('GET', `/dropshipping/order/${id}/transactions`)).data ?? [];
    const lines = tx.map(mapTransaction);
    // S0.1: tracking fields are not documented; map them defensively when present.
    const trackingNumber = order.tracking_number ?? undefined;
    const carrier = order.carrier ?? order.carrier_name ?? undefined;
    return {
      externalId: String(order.id ?? externalId),
      state: mapOrderStatus(order.state),
      totalAmount: order.total_amount === undefined || order.total_amount === null ? undefined : parseDecimal(order.total_amount),
      lines,
      tracking: trackingNumber ? { trackingNumber, ...(carrier && { carrierName: carrier }) } : null,
      alert: lines.some((l) => l.quantityFail > 0 || l.quantityCancelled > 0),
    };
  }

  // ---- FR-AW-006 saga -------------------------------------------------------

  async placeDropshipOrder(cmd: PlaceDropshipOrderCommand): Promise<SupplierOrderResult> {
    const progress: SupplierOrderProgress = { ...cmd.resume };
    if (progress.linesStored) progress.linesStored = [...progress.linesStored];
    let totalAmount: string | undefined;
    const result = (state: SupplierOrderResult['state'], extra: Partial<SupplierOrderResult> = {}): SupplierOrderResult => ({
      state,
      progress,
      ...(progress.orderId && { externalOrderId: progress.orderId }),
      ...(totalAmount !== undefined && { totalAmount }),
      ...extra,
    });
    const step = async (fn: () => Promise<void>) => {
      await this.withRetry(fn);
      await this.opts.onProgress?.(structuredClone(progress));
    };

    if (progress.submitted) return result('submitted');
    const r = cmd.recipient;
    const email = r.email?.trim() || cmd.tenantDefaults.email;
    const phone = r.phone?.trim() || cmd.tenantDefaults.phone;

    try {
      if (!progress.clientId) {
        await step(async () => {
          progress.clientId = await this.findOrCreateClient(cmd, email, phone);
        });
      }
      if (!progress.orderId) {
        await step(async () => {
          const res = await this.json<{ data: { id: number | string } }>(
            'POST',
            `/dropshipping/order/client/${encodeURIComponent(progress.clientId!)}/store`,
          );
          progress.orderId = String(res.data.id);
        });
      }
      const order = encodeURIComponent(progress.orderId!);
      for (const line of cmd.lines) {
        if (progress.linesStored?.includes(line.externalPortfolioId)) continue;
        await step(async () => {
          await this.call('POST', `/dropshipping/order/${order}/portfolio/${encodeURIComponent(line.externalPortfolioId)}/store`, {
            body: { quantity_ordered: line.quantity },
          });
          (progress.linesStored ??= []).push(line.externalPortfolioId);
        });
      }
      if (!progress.noted) {
        await step(async () => {
          await this.call('PATCH', `/dropshipping/order/${order}/update`, {
            body: { public_notes: `${cmd.channelCode}-${cmd.channelOrderId}` },
          });
          progress.noted = true;
        });
      }
      if (!progress.validated) {
        await step(async () => {
          const o = (await this.json<{ data: AwOrder }>('GET', `/dropshipping/order/${order}`)).data;
          const total = new Decimal(parseDecimal(o.total_amount ?? null));
          totalAmount = total.toFixed();
          const expected = cmd.lines.reduce((n, l) => n + l.quantity, 0);
          if (Number(o.item_quantity) !== expected) {
            throw new SagaAbort(result('creating', { alert: 'quantity_mismatch' }));
          }
          if (!total.lessThan(new Decimal(cmd.maxSupplierCost))) {
            throw new SagaAbort(result('creating', { alert: 'cost_exceeds_max' }));
          }
          progress.validated = true;
        });
      }
      await step(async () => {
        await this.call('PATCH', `/dropshipping/order/${order}/submit`);
        progress.submitted = true;
      });
      return result('submitted');
    } catch (err) {
      if (err instanceof SagaAbort) return err.result;
      // After max retries: mark failed, keep the AW order (manual decision in back office).
      return result('failed', { error: this.scrub(err instanceof Error ? err.message : String(err)) });
    }
  }

  private async withRetry(fn: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof SagaAbort || attempt >= this.sagaRetries) throw err;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }

  private async findOrCreateClient(cmd: PlaceDropshipOrderCommand, email: string, phone: string): Promise<string> {
    const r = cmd.recipient;
    const wanted = addressChecksum(r);
    const found = await this.json<{ data?: AwClient[] }>('GET', '/dropshipping/clients', { query: { search: email } });
    const match = (found.data ?? []).find(
      (c) =>
        c.status === 'active' &&
        c.email?.toLowerCase() === email.toLowerCase() &&
        c.address &&
        addressChecksum({
          line1: c.address.address_line_1 ?? '',
          line2: c.address.address_line_2,
          postalCode: c.address.postal_code ?? '',
          city: c.address.locality ?? '',
          countryCode: c.address.country_code ?? '',
        }) === wanted,
    );
    if (match) return String(match.id);
    const created = await this.json<{ data: { id: number | string } }>('POST', '/dropshipping/clients', {
      body: {
        company_name: r.fullName,
        contact_name: r.fullName,
        email,
        phone,
        address: {
          address_line_1: r.line1,
          address_line_2: r.line2 ?? null,
          postal_code: r.postalCode,
          locality: r.city,
          country_code: r.countryCode,
        },
      },
    });
    return String(created.data.id);
  }
}

interface AwOrder {
  id?: number | string;
  state?: string;
  item_quantity?: number | string;
  total_amount?: string | number | null;
  tracking_number?: string | null;
  carrier?: string | null;
  carrier_name?: string | null;
}

interface AwClient {
  id: number | string;
  email?: string;
  status?: string;
  address?: {
    address_line_1?: string;
    address_line_2?: string | null;
    postal_code?: string;
    locality?: string;
    country_code?: string;
  };
}
