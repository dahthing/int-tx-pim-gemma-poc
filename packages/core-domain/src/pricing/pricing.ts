import Decimal from 'decimal.js';
import { DomainError } from '../errors/domain-error';
import { computeMarginPct, isBelowMinMargin, Money, toDecimal } from '../margin-guard/margin-guard';

export type RoundingMode = 'x.99' | 'x.90' | 'none';

export interface RuleConditions {
  channel?: string;
  category?: string;
  costMin?: Money;
  costMax?: Money;
  tag?: string;
}

/** All percentages are fractions (100% markup = 1, 23% VAT = 0.23). Higher priority wins. */
export interface PricingRule {
  id: string;
  priority: number;
  conditions?: RuleConditions;
  markupPct: Money;
  fixedAdd?: Money;
  rounding?: RoundingMode;
  minMarginPct: Money;
}

export interface RuleContext {
  cost: Money;
  channel?: string;
  category?: string;
  tags?: string[];
}

export interface PriceInput {
  cost: Money;
  shippingAbsorbed?: Money;
  vatRate: Money;
  /** Channel fee as a fraction of net price. */
  channelFeePct?: Money;
  /** Fixed channel fee per unit (EUR). */
  channelFeeFixed?: Money;
  rules: PricingRule[];
  defaultRule: PricingRule;
  context?: { channel?: string; category?: string; tags?: string[] };
  override?: { gross: Money; force?: boolean };
}

export type BlockReason = 'MARGIN_BELOW_MIN' | 'NON_POSITIVE_PRICE';

export interface PriceResult {
  status: 'ok' | 'blocked';
  net: string;
  gross: string;
  marginPct: string;
  forced: boolean;
  ruleId: string;
  reason?: BlockReason;
}

function matches(rule: PricingRule, ctx: RuleContext): boolean {
  const c = rule.conditions;
  if (!c) return true;
  if (c.channel !== undefined && c.channel !== ctx.channel) return false;
  if (c.category !== undefined && c.category !== ctx.category) return false;
  if (c.tag !== undefined && !(ctx.tags ?? []).includes(c.tag)) return false;
  const cost = toDecimal(ctx.cost, 'cost');
  if (c.costMin !== undefined && cost.lt(toDecimal(c.costMin))) return false;
  if (c.costMax !== undefined && cost.gt(toDecimal(c.costMax))) return false;
  return true;
}

/** First matching rule by descending priority (stable: list order breaks ties), else the default. */
export function selectRule(rules: PricingRule[], defaultRule: PricingRule, ctx: RuleContext): PricingRule {
  const sorted = rules.map((r, i) => ({ r, i })).sort((a, b) => b.r.priority - a.r.priority || a.i - b.i);
  return sorted.find(({ r }) => matches(r, ctx))?.r ?? defaultRule;
}

/** Rounds gross UP to the next x.99 / x.90 (margin-safe) or to 2 decimals. */
export function applyRounding(gross: Money, mode: RoundingMode): Decimal {
  const g = toDecimal(gross, 'gross');
  if (mode === 'none') return g.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const ending = new Decimal(mode === 'x.99' ? '0.99' : '0.90');
  return g.minus(ending).ceil().plus(ending);
}

export function calculatePrice(input: PriceInput): PriceResult {
  const cost = toDecimal(input.cost, 'cost');
  const shipping = toDecimal(input.shippingAbsorbed ?? 0, 'shippingAbsorbed');
  const vat = toDecimal(input.vatRate, 'vatRate');
  if (cost.lt(0) || shipping.lt(0) || vat.lt(0)) {
    throw new DomainError('INVALID_PRICE_INPUT', 'cost, shippingAbsorbed and vatRate must not be negative');
  }
  const rule = selectRule(input.rules, input.defaultRule, { cost, ...input.context });

  let gross: Decimal;
  if (input.override) {
    gross = toDecimal(input.override.gross, 'override.gross').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (gross.lte(0)) throw new DomainError('INVALID_OVERRIDE', 'Override price must be positive');
  } else {
    const rawNet = cost
      .plus(shipping)
      .times(new Decimal(1).plus(toDecimal(rule.markupPct, 'markupPct')))
      .plus(toDecimal(rule.fixedAdd ?? 0, 'fixedAdd'));
    const rawGross = rawNet.times(vat.plus(1));
    gross = rawGross.lte(0) ? new Decimal(0) : applyRounding(rawGross, rule.rounding ?? 'none');
  }
  const forced = input.override?.force === true;
  const base = { ruleId: rule.id, forced };

  if (gross.lte(0)) {
    return { ...base, status: 'blocked', reason: 'NON_POSITIVE_PRICE', net: '0.00', gross: '0.00', marginPct: '0.0000' };
  }
  const net = gross.div(vat.plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (net.lte(0)) {
    return { ...base, status: 'blocked', reason: 'NON_POSITIVE_PRICE', net: '0.00', gross: gross.toFixed(2), marginPct: '0.0000' };
  }
  const fee = net.times(toDecimal(input.channelFeePct ?? 0, 'channelFeePct')).plus(toDecimal(input.channelFeeFixed ?? 0, 'channelFeeFixed'));
  const margin = computeMarginPct({ net, cost, shippingAbsorbed: shipping, channelFee: fee });
  const result = { ...base, net: net.toFixed(2), gross: gross.toFixed(2), marginPct: margin.toFixed(4) };
  if (isBelowMinMargin(margin, rule.minMarginPct) && !forced) {
    return { ...result, status: 'blocked', reason: 'MARGIN_BELOW_MIN' };
  }
  return { ...result, status: 'ok' };
}
