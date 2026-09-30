import { DomainError, toDecimal, type Money } from '@repo/core-domain';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface MaxCostInput {
  /** Order total, net of VAT (decimal). */
  orderNet: Money;
  /** Minimum margin as a fraction (0.15 = 15%), same convention as core-domain margin guard. */
  minMargin: Money;
  shippingAbsorbed?: Money;
  channelFee?: Money;
}

/** max_supplier_cost = net*(1-minMargin) - shippingAbsorbed - channelFee, floored at 0. */
export function computeMaxSupplierCost(i: MaxCostInput): ReturnType<typeof toDecimal> {
  const net = toDecimal(i.orderNet, 'orderNet');
  const margin = toDecimal(i.minMargin, 'minMargin');
  if (net.lte(0)) throw new DomainError('INVALID_NET', 'Order net total must be positive');
  if (margin.lt(0) || margin.gte(1)) throw new DomainError('INVALID_MARGIN', 'minMargin must be in [0, 1)');
  const cost = net
    .times(toDecimal(1).minus(margin))
    .minus(toDecimal(i.shippingAbsorbed ?? 0, 'shippingAbsorbed'))
    .minus(toDecimal(i.channelFee ?? 0, 'channelFee'));
  return cost.lt(0) ? toDecimal(0) : cost;
}

export interface PurgeInput {
  deliveredAt: Date | null;
  now: Date;
  alreadyPurged?: boolean;
  retentionDays?: number;
}

export function shouldPurgePii(i: PurgeInput): { purge: boolean; purgeAfter: Date | null } {
  if (!i.deliveredAt) return { purge: false, purgeAfter: null };
  const purgeAfter = new Date(i.deliveredAt.getTime() + (i.retentionDays ?? 90) * DAY);
  return { purge: !i.alreadyPurged && i.now.getTime() >= purgeAfter.getTime(), purgeAfter };
}

export interface ShipByInput {
  shipByAt: Date | null;
  hasTracking: boolean;
  now: Date;
  alertHoursBefore?: number;
  alreadyAlerted?: boolean;
}

export function shipByAlertDecision(i: ShipByInput): { alert: boolean; overdue: boolean; hoursLeft: number | null } {
  if (!i.shipByAt) return { alert: false, overdue: false, hoursLeft: null };
  const hoursLeft = (i.shipByAt.getTime() - i.now.getTime()) / HOUR;
  const within = hoursLeft <= (i.alertHoursBefore ?? 12);
  return { alert: within && !i.hasTracking && !i.alreadyAlerted, overdue: hoursLeft < 0, hoursLeft };
}
