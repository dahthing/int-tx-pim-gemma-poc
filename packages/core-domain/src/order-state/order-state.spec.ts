import { DomainError } from '../errors/domain-error';
import { ORDER_STATES, ALLOWED_TRANSITIONS, OrderState, canTransition, transition, decideCancellation } from './order-state';

/**
 * Transition table (PRD 6.8; arrows out of manual_review / supplier_failed / tracking_missing are
 * not drawn in the PRD and are defined here):
 *  imported            -> routing, manual_review, cancelled
 *  routing             -> supplier_submitted, supplier_failed, manual_review, cancelled
 *  supplier_submitted  -> supplier_dispatched, supplier_failed, manual_review
 *  supplier_dispatched -> tracking_pushed, tracking_missing
 *  tracking_pushed     -> completed
 *  tracking_missing    -> tracking_pushed, manual_review
 *  manual_review       -> routing, cancelled
 *  supplier_failed     -> manual_review, routing
 *  completed, cancelled -> (terminal)
 */
const TABLE: Record<OrderState, OrderState[]> = {
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

describe('order-state', () => {
  it('has exactly the documented states and table', () => {
    expect([...ORDER_STATES].sort()).toEqual(Object.keys(TABLE).sort());
    expect(ALLOWED_TRANSITIONS).toEqual(TABLE);
  });

  const pairs = ORDER_STATES.flatMap((f) => ORDER_STATES.map((t) => [f, t] as const));
  it.each(pairs)('%s -> %s', (from, to) => {
    if (TABLE[from].includes(to)) {
      expect(canTransition(from, to)).toBe(true);
      expect(transition(from, to)).toBe(to);
    } else {
      expect(canTransition(from, to)).toBe(false);
      expect(() => transition(from, to)).toThrow(DomainError);
    }
  });

  it('throws DomainError with code INVALID_ORDER_TRANSITION and for unknown states', () => {
    try {
      transition('completed', 'routing');
      fail('should throw');
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_ORDER_TRANSITION');
    }
    expect(() => transition('bogus' as never, 'routing')).toThrow(DomainError);
    expect(canTransition('bogus' as never, 'routing')).toBe(false);
  });

  describe('decideCancellation', () => {
    it('supplier order creating => delete_supplier_draft', () => expect(decideCancellation('creating')).toEqual({ action: 'delete_supplier_draft', nextState: 'cancelled' }));
    it('supplier order submitted => manual_review', () => expect(decideCancellation('submitted')).toEqual({ action: 'manual_review', nextState: 'manual_review' }));
    it('no supplier order => plain cancel', () => expect(decideCancellation('none')).toEqual({ action: 'cancel', nextState: 'cancelled' }));
    it('unknown supplier status throws', () => expect(() => decideCancellation('weird' as never)).toThrow(DomainError));
  });
});
