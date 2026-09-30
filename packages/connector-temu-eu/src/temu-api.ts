/**
 * Single isolation layer for everything Temu-specific: method names, envelope,
 * payload shapes and error codes. ALL of it is PLACEHOLDER until spike S0.8.
 */
import type {
  ChannelAttributeSpec,
  ChannelCategory,
  ChannelListingPayload,
  ChannelOrderRaw,
  PushShipmentCommand,
} from '@repo/connector-contracts';
import { redactText, type ResilientHttpClient } from '@repo/http-client';
import type { Signer } from './signing';

export const TEMU_METHODS = {
  shopInfo: 'bg.mall.info.get',
  categoryTree: 'bg.goods.cats.get',
  categoryAttributes: 'bg.goods.attrs.get',
  goodsAdd: 'bg.goods.add',
  goodsUpdate: 'bg.goods.update',
  goodsOffline: 'bg.goods.offline',
  goodsReview: 'bg.goods.review.status.get',
  stockUpdate: 'bg.goods.stock.update',
  priceUpdate: 'bg.goods.price.update',
  priceReview: 'bg.goods.price.review.get',
  orderList: 'bg.order.list.get',
  shippingInfoDecrypt: 'bg.order.shippinginfo.get',
  shipmentConfirm: 'bg.order.shipment.confirm',
} as const;

export const API_PATH = '/openapi/router';
/** Error codes (placeholders). */
export const TOKEN_ERROR_CODES = new Set([3000002, 3000003]); // expired, revoked
export const CREDENTIAL_ERROR_CODES = new Set([3000001, 7000001]); // bad app key, bad signature

export class TemuApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TemuApiError';
  }
}

interface Envelope<T> {
  success: boolean;
  errorCode?: number;
  errorMsg?: string;
  result?: T;
}

export interface TemuApiClientOptions {
  http: ResilientHttpClient;
  signer: Signer;
  appKey: string;
  appSecret: string;
  accessToken: string;
  now: () => Date;
}

export class TemuApiClient {
  constructor(private readonly o: TemuApiClientOptions) {}

  private scrub(text: string): string {
    let out = redactText(text);
    for (const s of [this.o.appSecret, this.o.accessToken, this.o.appKey]) {
      if (s) out = out.split(s).join('[REDACTED]');
    }
    return out;
  }

  async call<T>(method: string, biz: Record<string, unknown> = {}): Promise<T> {
    const params: Record<string, unknown> = {
      ...biz,
      type: method,
      app_key: this.o.appKey,
      access_token: this.o.accessToken,
      timestamp: String(Math.floor(this.o.now().getTime() / 1000)),
      data_type: 'JSON',
      version: 'V1',
    };
    params['sign'] = this.o.signer.sign(params, this.o.appSecret);
    const res = await this.o.http.request('POST', API_PATH, { body: params });
    const env = res.json<Envelope<T>>();
    if (!env || typeof env.success !== 'boolean') throw new TemuApiError('bad_envelope', 'Unexpected Temu response envelope');
    if (!env.success) {
      throw new TemuApiError(String(env.errorCode ?? 'unknown'), this.scrub(`Temu API error ${env.errorCode}: ${env.errorMsg ?? ''}`));
    }
    return env.result as T;
  }
}

export function isTokenError(e: TemuApiError): boolean {
  return TOKEN_ERROR_CODES.has(Number(e.code));
}
export function isCredentialError(e: TemuApiError): boolean {
  return CREDENTIAL_ERROR_CODES.has(Number(e.code));
}

// ---- request builders -------------------------------------------------------

export function goodsBody(l: ChannelListingPayload): Record<string, unknown> {
  return {
    outSkuSn: l.sku,
    ean: l.ean ?? undefined,
    title: l.title,
    description: l.descriptionHtml,
    weightG: l.weightG,
    price: l.priceNet,
    vatRate: l.vatRate,
    stock: l.stock,
    categoryId: l.categoryId,
    attributes: l.attributes,
    images: l.imageUrls,
    compliance: l.compliance,
    goodsId: l.externalId,
  };
}

export function shipmentBody(cmd: PushShipmentCommand, carrier: { temuCarrierId: string; temuCarrierName: string }) {
  return {
    orderSn: cmd.externalOrderId,
    carrierId: carrier.temuCarrierId,
    carrierName: carrier.temuCarrierName,
    trackingNumber: cmd.trackingNumber,
  };
}

// ---- response shapes & parsers ---------------------------------------------

export interface ItemResult {
  goodsId: string;
  success: boolean;
  pendingReview?: boolean;
  errorMsg?: string;
}
export interface RawOrder {
  orderSn: string;
  status: string;
  createTime: number;
  currency: string;
  totalAmount: string;
  latestShipTime?: number | null;
  items: Array<{ outSkuSn: string; orderItemId?: string; quantity: number; unitPrice?: string }>;
}
export interface RawShipping {
  name: string;
  email?: string | null;
  phone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postCode: string;
  city: string;
  countryCode: string;
}

export function parseCategories(r: { categories: Array<{ catId: string | number; parentCatId: string | number; catName: string; leaf: boolean }> }): ChannelCategory[] {
  return r.categories.map((c) => ({
    id: String(c.catId),
    parentId: String(c.parentCatId) === '0' ? null : String(c.parentCatId),
    name: c.catName,
    leaf: c.leaf,
  }));
}

export function parseAttributes(r: { attributes: Array<{ propId: string; propName: string; required: boolean; values?: string[] }> }): ChannelAttributeSpec[] {
  return r.attributes.map((a) => ({
    id: a.propId,
    name: a.propName,
    mandatory: a.required,
    ...(a.values ? { allowedValues: a.values } : {}),
  }));
}

export function parseOrder(o: RawOrder, s: RawShipping): ChannelOrderRaw {
  return {
    externalId: o.orderSn,
    externalStatus: o.status,
    placedAt: new Date(o.createTime * 1000),
    currency: o.currency,
    total: o.totalAmount,
    shipByAt: o.latestShipTime ? new Date(o.latestShipTime * 1000) : null,
    customer: { name: s.name, email: s.email ?? null, phone: s.phone ?? null },
    shippingAddress: {
      fullName: s.name,
      email: s.email ?? null,
      phone: s.phone ?? null,
      line1: s.addressLine1,
      line2: s.addressLine2 ?? null,
      postalCode: s.postCode,
      city: s.city,
      countryCode: s.countryCode,
    },
    lines: o.items.map((i) => ({
      sku: i.outSkuSn,
      externalLineId: i.orderItemId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
  };
}
