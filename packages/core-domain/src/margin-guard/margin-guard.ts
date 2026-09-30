import Decimal from 'decimal.js';
import { DomainError } from '../errors/domain-error';

export type Money = string | number | Decimal;

/** Parses a money/ratio input into a Decimal; throws DomainError when invalid. */
export function toDecimal(value: Money, field = 'value'): Decimal {
  try {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new DomainError('INVALID_NUMBER', `Invalid numeric value for ${field}`, { field, value });
  }
}

export interface MarginInput {
  net: Money;
  cost: Money;
  shippingAbsorbed: Money;
  channelFee: Money;
}

/** margin_pct = (net - cost - shipping_absorbed - channel_fee) / net (fraction, not rounded). */
export function computeMarginPct(i: MarginInput): Decimal {
  const net = toDecimal(i.net, 'net');
  if (net.lte(0)) throw new DomainError('INVALID_NET', 'Net price must be positive');
  return net
    .minus(toDecimal(i.cost, 'cost'))
    .minus(toDecimal(i.shippingAbsorbed, 'shippingAbsorbed'))
    .minus(toDecimal(i.channelFee, 'channelFee'))
    .div(net);
}

export function isBelowMinMargin(marginPct: Money, minMarginPct: Money): boolean {
  return toDecimal(marginPct).lt(toDecimal(minMarginPct));
}
