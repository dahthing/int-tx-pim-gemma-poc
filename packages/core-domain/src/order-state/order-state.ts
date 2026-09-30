import { DomainError } from '../errors/domain-error';

export const ORDER_STATES = [
  'imported',
  'routing',
  'supplier_submitted',
  'supplier_dispatched',
  'tracking_pushed',
  'completed',
  'manual_review',
  'supplier_failed',
  'tracking_missing',
  'cancelled',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export const ALLOWED_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  imported: ['routing', 'manual_review', 'cancelled'],
  routing: ['supplier_submitted', 'supplier_failed', 'manual_review', 'cancelled'],
  supplier_submitted: ['supplier_dispatched', 'supplier_failed', 'manual_review'],
  supplier_dispatched: ['tracking_pushed', 'tracking_missing'],
  tracking_pushed: ['completed'],
  tracking_missing: ['tracking_pushed', 'manual_review'],
  manual_review: ['routing', 'cancelled'],
  supplier_failed: ['manual_review', 'routing'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function transition(from: OrderState, to: OrderState): OrderState {
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_ORDER_TRANSITION', `Invalid order transition ${from} -> ${to}`, { from, to });
  }
  return to;
}

export type SupplierOrderStatus = 'none' | 'creating' | 'submitted';

export interface CancelDecision {
  action: 'cancel' | 'delete_supplier_draft' | 'manual_review';
  nextState: OrderState;
}

/** Channel cancellation: creating => delete AW draft; submitted => manual review (no AW cancel endpoint). */
export function decideCancellation(supplierOrder: SupplierOrderStatus): CancelDecision {
  switch (supplierOrder) {
    case 'creating':
      return { action: 'delete_supplier_draft', nextState: 'cancelled' };
    case 'submitted':
      return { action: 'manual_review', nextState: 'manual_review' };
    case 'none':
      return { action: 'cancel', nextState: 'cancelled' };
    default:
      throw new DomainError('INVALID_SUPPLIER_ORDER_STATUS', `Unknown supplier order status ${String(supplierOrder)}`);
  }
}
