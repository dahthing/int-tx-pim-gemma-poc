import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type {
  RecipientAddress,
  SupplierAssortmentItemRaw,
  SupplierMediaRaw,
  SupplierOrderLineStatus,
  SupplierProductRaw,
} from '@repo/connector-contracts';
import type { AwImage, AwPortfolioItem, AwProduct, AwTransaction } from './aw.types';

/** Money string/number to a plain decimal string. Never goes through float arithmetic. */
export function parseDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') throw new Error('Invalid decimal: empty');
  try {
    return new Decimal(typeof value === 'number' ? String(value) : value.trim()).toFixed();
  } catch {
    throw new Error('Invalid decimal value');
  }
}

export function mapProduct(p: AwProduct): SupplierProductRaw {
  return {
    externalId: String(p.id),
    code: p.code,
    slug: p.slug,
    ean: p.ean_barcode ?? null,
    name: p.name,
    description: p.description ?? null,
    descriptionExtra: p.description_extra ?? null,
    departmentName: p.department?.name ?? p.department_name ?? null,
    subDepartmentName: p.sub_department?.name ?? p.sub_department_name ?? null,
    familyName: p.family?.name ?? p.family_name ?? null,
    costPrice: parseDecimal(p.price),
    currency: p.currency_code,
    stock: p.current_stock,
    grossWeightG: p.gross_weight ?? null,
    imageMainUrl: p.image?.original_2x ?? p.image?.original ?? null,
    rawPayload: p as Record<string, unknown>,
  };
}

export function mapPortfolioItem(p: AwPortfolioItem): SupplierAssortmentItemRaw {
  return {
    externalPortfolioId: String(p.id),
    itemId: p.item_id === null || p.item_id === undefined ? undefined : String(p.item_id),
    code: p.code,
    quantityLeft: p.quantity_left,
    weight: p.weight ?? null,
    price: p.price === undefined ? undefined : parseDecimal(p.price),
    sellingPrice:
      p.selling_price === null || p.selling_price === undefined ? null : parseDecimal(p.selling_price),
    status: (p.state ?? p.status) === 'disabled' ? 'disabled' : 'active',
  };
}

/** Only `source.original` is used; items without it (thumbnail only) are dropped. */
export function mapImages(images: AwImage[]): SupplierMediaRaw[] {
  const out: SupplierMediaRaw[] = [];
  for (const i of images) {
    const url = i.source?.original;
    if (url) out.push({ uuid: i.uuid, name: i.name, mimeType: i.mime_type, url });
  }
  return out;
}

export function mapOrderStatus(state: string | undefined | null): string {
  return state ? state.toLowerCase() : 'unknown';
}

export function mapTransaction(t: AwTransaction): SupplierOrderLineStatus {
  return {
    transactionId: String(t.id),
    quantityOrdered: t.quantity_ordered ?? 0,
    quantityDispatched: t.quantity_dispatched ?? 0,
    quantityFail: t.quantity_fail ?? 0,
    quantityCancelled: t.quantity_cancelled ?? 0,
  };
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function addressChecksum(
  a: Pick<RecipientAddress, 'line1' | 'postalCode' | 'city' | 'countryCode'> & { line2?: string | null },
): string {
  return createHash('sha256')
    .update([a.line1, a.line2, a.postalCode, a.city, a.countryCode].map(norm).join('|'))
    .digest('hex');
}
