import type { ChannelOrderRaw, PlaceDropshipOrderCommand } from '@repo/connector-contracts';
import type { Money } from '@repo/core-domain';
import { computeMaxSupplierCost } from './order-policy';

export const AWAITING_SHIPMENT = 'AWAITING_SHIPMENT';

export interface OrderImportOptions {
  minMargin: Money;
  seenExternalIds: Set<string>;
  shippingAbsorbed?: Money;
  channelFee?: Money;
  tenantDefaults?: { email: string; phone: string };
}

export type OrderImportDecision =
  | { action: 'skip'; reason: 'already_imported' | 'not_awaiting_shipment'; idempotencyKey: string }
  | {
      action: 'import';
      idempotencyKey: string;
      shipByAt: Date | null;
      command: PlaceDropshipOrderCommand;
    };

/** Pure mapping: decides whether to import and builds the FR-AW-006 command. */
export function buildOrderImport(order: ChannelOrderRaw, opts: OrderImportOptions): OrderImportDecision {
  const idempotencyKey = `temu-eu:${order.externalId}`;
  if (opts.seenExternalIds.has(order.externalId)) return { action: 'skip', reason: 'already_imported', idempotencyKey };
  if (order.externalStatus !== AWAITING_SHIPMENT) return { action: 'skip', reason: 'not_awaiting_shipment', idempotencyKey };
  const defaults = opts.tenantDefaults ?? { email: '', phone: '' };
  const maxSupplierCost = computeMaxSupplierCost({
    orderNet: order.total,
    minMargin: opts.minMargin,
    shippingAbsorbed: opts.shippingAbsorbed,
    channelFee: opts.channelFee,
  }).toFixed(2, 1);
  return {
    action: 'import',
    idempotencyKey,
    shipByAt: order.shipByAt ?? null,
    command: {
      channelCode: 'TEMU',
      channelOrderId: order.externalId,
      recipient: {
        ...order.shippingAddress,
        email: order.shippingAddress.email ?? order.customer.email ?? defaults.email,
        phone: order.shippingAddress.phone ?? order.customer.phone ?? defaults.phone,
      },
      lines: order.lines.map((l) => ({ externalPortfolioId: l.sku, quantity: l.quantity })),
      maxSupplierCost,
      tenantDefaults: defaults,
    },
  };
}
