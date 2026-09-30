import { createHash } from 'node:crypto';
import type { ChannelListingPayload } from '@repo/connector-contracts';
import type { Raw, TransportKind } from './endpoints';
import type { PrestaShop9Settings } from './settings';

const DECIMAL = /^\d+(\.\d+)?$/;

export function gramsToKg(g: number): string {
  return (g / 1000).toFixed(3);
}
export function assertDecimal(value: string, what = 'price'): string {
  if (!DECIMAL.test(value)) throw new Error(`Invalid ${what}: "${value}"`);
  return value;
}
/** Native number for the Admin API, string for the Webservice. */
export const numeric = (kind: TransportKind, v: string | number): string | number => (kind === 'admin-api' ? Number(v) : String(v));
export const activeFlag = (kind: TransportKind, on: boolean): string | boolean => (kind === 'admin-api' ? on : on ? '1' : '0');

export function slugify(s: string): string {
  const slug = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'product';
}

export function parsePsDate(s: string): Date {
  if (!s || s.startsWith('0000')) return new Date(0);
  return new Date(`${s.replace(' ', 'T')}Z`);
}
export function formatPsDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const iso = (s: unknown): string | undefined => (s ? parsePsDate(String(s)).toISOString() : undefined);

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Product write body in the shape of the routed transport. */
export function buildProductBody(kind: TransportKind, l: ChannelListingPayload, s: PrestaShop9Settings): Raw {
  const price = assertDecimal(l.priceNet);
  const lang = s.languageId;
  const weight = gramsToKg(l.weightG);
  if (kind === 'admin-api') {
    const loc = (v: string) => ({ [lang]: v });
    const b: Raw = {
      reference: l.sku, weight: Number(weight), price: Number(price), taxRulesGroupId: s.taxRulesGroupId,
      defaultCategoryId: Number(l.categoryId), categoryIds: [Number(l.categoryId)], active: l.active,
      localizedNames: loc(l.title), localizedDescriptions: loc(l.descriptionHtml), localizedLinkRewrites: loc(slugify(l.title)),
    };
    if (l.ean) b.ean13 = l.ean;
    if (l.shortDescription) b.localizedShortDescriptions = loc(l.shortDescription);
    if (l.seoTitle) b.localizedMetaTitles = loc(l.seoTitle);
    if (l.seoDescription) b.localizedMetaDescriptions = loc(l.seoDescription);
    return b;
  }
  const loc = (v: string) => [{ id: String(lang), value: v }];
  const b: Raw = {
    reference: l.sku, weight, price, id_tax_rules_group: String(s.taxRulesGroupId),
    id_category_default: l.categoryId, active: activeFlag(kind, l.active),
    name: loc(l.title), description: loc(l.descriptionHtml), link_rewrite: loc(slugify(l.title)),
    associations: { categories: [{ id: l.categoryId }] },
  };
  if (l.ean) b.ean13 = l.ean;
  if (l.shortDescription) b.description_short = loc(l.shortDescription);
  if (l.seoTitle) b.meta_title = loc(l.seoTitle);
  if (l.seoDescription) b.meta_description = loc(l.seoDescription);
  return b;
}

export const priceBody = (kind: TransportKind, price: string): Raw => ({ price: numeric(kind, assertDecimal(price)) });
export const activeBody = (kind: TransportKind, on: boolean): Raw => ({ active: activeFlag(kind, on) });
export const quantityBody = (kind: TransportKind, qty: number): Raw => ({ quantity: numeric(kind, Math.max(0, Math.trunc(qty))) });
export const trackingBody = (kind: TransportKind, tracking: string): Raw =>
  kind === 'admin-api' ? { trackingNumber: tracking } : { tracking_number: tracking };
export const orderHistoryBody = (kind: TransportKind, orderId: string, stateId: number): Raw =>
  kind === 'admin-api' ? { orderId: Number(orderId), orderStateId: stateId } : { id_order: orderId, id_order_state: String(stateId) };

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

export interface ProductRecord { id: string; reference?: string; ean13?: string }
export function parseProductRecord(kind: TransportKind, r: Raw): ProductRecord {
  const id = kind === 'admin-api' ? r.productId ?? r.id : r.id;
  if (id === undefined || id === null) throw new Error('PrestaShop product response carries no id');
  return { id: str(id), reference: r.reference, ean13: r.ean13 || undefined };
}
export const parseCarrierRecord = (kind: TransportKind, r: Raw): { id: string } => ({
  id: str(kind === 'admin-api' ? r.orderCarrierId ?? r.id : r.id),
});

export interface StockRecord { id: string; productId: string; quantity: number }
export function parseStockRecord(kind: TransportKind, r: Raw): StockRecord {
  return kind === 'admin-api'
    ? { id: str(r.stockAvailableId ?? r.id), productId: str(r.productId), quantity: Number(r.quantity) }
    : { id: str(r.id), productId: str(r.id_product), quantity: Number(r.quantity) };
}

export interface NormalizedOrder {
  id: string; currentState: string; placedAt: string; updatedAt?: string; total?: string;
  customerId?: string; addressId?: string;
  lines: Array<{ lineId: string; sku: string; quantity: number; unitPrice?: string }>;
}
export function normalizeOrder(kind: TransportKind, r: Raw): NormalizedOrder {
  if (kind === 'admin-api') {
    return {
      id: str(r.orderId), currentState: str(r.currentState), placedAt: iso(r.dateAdd)!, updatedAt: iso(r.dateUpd),
      total: r.totalPaidTaxIncl === undefined ? undefined : str(r.totalPaidTaxIncl),
      customerId: r.customerId === undefined ? undefined : str(r.customerId),
      addressId: r.deliveryAddressId === undefined ? undefined : str(r.deliveryAddressId),
      lines: ((r.rows ?? []) as Raw[]).map((x) => ({
        lineId: str(x.orderDetailId), sku: str(x.productReference), quantity: Number(x.quantity),
        unitPrice: x.unitPriceTaxExcl === undefined ? undefined : str(x.unitPriceTaxExcl),
      })),
    };
  }
  return {
    id: str(r.id), currentState: str(r.current_state), placedAt: iso(r.date_add)!, updatedAt: iso(r.date_upd),
    total: r.total_paid_tax_incl === undefined ? undefined : str(r.total_paid_tax_incl),
    customerId: r.id_customer === undefined ? undefined : str(r.id_customer),
    addressId: r.id_address_delivery === undefined ? undefined : str(r.id_address_delivery),
    lines: ((r.associations?.order_rows ?? []) as Raw[]).map((x) => ({
      lineId: str(x.id), sku: str(x.product_reference), quantity: Number(x.product_quantity),
      unitPrice: x.unit_price_tax_excl === undefined ? undefined : str(x.unit_price_tax_excl),
    })),
  };
}

export function normalizeCustomer(kind: TransportKind, r: Raw): { name: string; email: string | null } {
  const [f, l] = kind === 'admin-api' ? [r.firstName, r.lastName] : [r.firstname, r.lastname];
  return { name: `${f ?? ''} ${l ?? ''}`.trim(), email: strOrNull(r.email) };
}

export interface NormalizedAddress {
  fullName: string; line1: string; line2: string | null; postalCode: string; city: string; countryId: string; phone: string | null;
}
export function normalizeAddress(kind: TransportKind, r: Raw): NormalizedAddress {
  const a = kind === 'admin-api'
    ? { f: r.firstName, l: r.lastName, country: r.countryId, phone: r.phone || r.mobilePhone }
    : { f: r.firstname, l: r.lastname, country: r.id_country, phone: r.phone || r.phone_mobile };
  return {
    fullName: `${a.f ?? ''} ${a.l ?? ''}`.trim(), line1: str(r.address1 ?? ''), line2: strOrNull(r.address2),
    postalCode: str(r.postcode ?? ''), city: str(r.city ?? ''), countryId: a.country === undefined ? '' : str(a.country),
    phone: strOrNull(a.phone),
  };
}

export function normalizeCountry(kind: TransportKind, r: Raw): { isoCode: string } {
  return { isoCode: str(kind === 'admin-api' ? r.isoCode : r.iso_code) };
}

export function parseToken(body: Raw): { accessToken: string; expiresInSec: number } {
  if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new Error('Token response has no access_token');
  return { accessToken: body.access_token, expiresInSec: Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600 };
}
