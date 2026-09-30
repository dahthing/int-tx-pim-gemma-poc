import { DomainError } from '../errors/domain-error';

export interface StockInput {
  supplierStock: number;
  buffer?: number;
  cap?: number;
  published: boolean;
  supplierProductMissing: boolean;
  assortmentDisabled: boolean;
}

/** available = max(0, stock - buffer), then capped; 0 if unpublished / missing / disabled. */
export function availableStock(i: StockInput): number {
  const buffer = i.buffer ?? 0;
  for (const [k, v] of [['supplierStock', i.supplierStock], ['buffer', buffer], ['cap', i.cap ?? 0]] as const) {
    if (!Number.isFinite(v)) throw new DomainError('INVALID_STOCK_INPUT', `${k} must be a finite number`);
  }
  if (buffer < 0 || (i.cap !== undefined && i.cap < 0)) {
    throw new DomainError('INVALID_STOCK_INPUT', 'buffer and cap must not be negative');
  }
  if (!i.published || i.supplierProductMissing || i.assortmentDisabled) return 0;
  const afterBuffer = Math.max(0, Math.floor(i.supplierStock) - buffer);
  return i.cap === undefined ? afterBuffer : Math.min(afterBuffer, i.cap);
}
