import { DomainError } from '@repo/core-domain';
import { resolveCarrier, UnknownCarrierError } from './carriers';
import { computeMaxSupplierCost, shipByAlertDecision, shouldPurgePii } from './order-policy';
import { PendingPriceTracker } from './pending-price';
import { mapReviewStatus } from './review';

describe('mapReviewStatus', () => {
  it.each([
    ['PENDING_REVIEW', 'submitted'],
    ['UNDER_REVIEW', 'submitted'],
    ['APPROVED', 'live'],
    ['ONLINE', 'live'],
    ['REJECTED', 'rejected'],
    ['REVIEW_FAILED', 'rejected'],
  ])('%s -> %s', (raw, status) => {
    expect(mapReviewStatus({ status: raw }).status).toBe(status);
  });
  it('keeps the rejection reason', () => {
    expect(mapReviewStatus({ status: 'REJECTED', reason: 'bad images' })).toEqual({
      status: 'rejected',
      reason: 'bad images',
    });
  });
  it('rejected without a reason gets an explicit placeholder', () => {
    expect(mapReviewStatus({ status: 'REJECTED' }).reason).toMatch(/no reason/i);
  });
  it('unknown statuses stay submitted (non terminal) and are flagged', () => {
    expect(mapReviewStatus({ status: 'WAT' })).toEqual({ status: 'submitted', reason: 'unknown review status: WAT' });
  });
});

describe('PendingPriceTracker', () => {
  it('tracks, reports and resolves', () => {
    const t = new PendingPriceTracker();
    expect(t.isPending('g1')).toBe(false);
    t.markPending('g1', '9.99', new Date(0));
    expect(t.isPending('g1')).toBe(true);
    expect(t.get('g1')).toEqual({ externalId: 'g1', priceNet: '9.99', since: new Date(0) });
    expect(t.pendingIds()).toEqual(['g1']);
    t.resolve('g1');
    expect(t.isPending('g1')).toBe(false);
    expect(t.get('g1')).toBeUndefined();
  });
});

describe('computeMaxSupplierCost', () => {
  it('= net * (1 - minMargin) with Decimal precision', () => {
    expect(computeMaxSupplierCost({ orderNet: '20.00', minMargin: '0.15' }).toString()).toBe('17');
    expect(computeMaxSupplierCost({ orderNet: '0.30', minMargin: '0.10' }).toString()).toBe('0.27');
  });
  it('subtracts absorbed shipping and channel fee', () => {
    expect(
      computeMaxSupplierCost({ orderNet: '20.00', minMargin: '0.15', shippingAbsorbed: '2.00', channelFee: '1.50' }).toString(),
    ).toBe('13.5');
  });
  it('never goes below zero', () => {
    expect(computeMaxSupplierCost({ orderNet: '5', minMargin: '0.1', channelFee: '10' }).toString()).toBe('0');
  });
  it('rejects invalid input', () => {
    expect(() => computeMaxSupplierCost({ orderNet: '0', minMargin: '0.1' })).toThrow(DomainError);
    expect(() => computeMaxSupplierCost({ orderNet: '10', minMargin: '1.5' })).toThrow(DomainError);
    expect(() => computeMaxSupplierCost({ orderNet: 'abc', minMargin: '0.1' })).toThrow(DomainError);
  });
});

describe('shouldPurgePii (90 days after delivery)', () => {
  const delivered = new Date('2026-01-01T00:00:00Z');
  it('not delivered: keep', () => {
    expect(shouldPurgePii({ deliveredAt: null, now: new Date() })).toEqual({ purge: false, purgeAfter: null });
  });
  it('before 90 days: keep', () => {
    const r = shouldPurgePii({ deliveredAt: delivered, now: new Date('2026-03-31T23:59:59Z') });
    expect(r.purge).toBe(false);
    expect(r.purgeAfter).toEqual(new Date('2026-04-01T00:00:00Z'));
  });
  it('at 90 days: purge', () => {
    expect(shouldPurgePii({ deliveredAt: delivered, now: new Date('2026-04-01T00:00:00Z') }).purge).toBe(true);
  });
  it('already purged: nothing to do', () => {
    expect(shouldPurgePii({ deliveredAt: delivered, now: new Date('2027-01-01'), alreadyPurged: true }).purge).toBe(false);
  });
  it('retention days configurable', () => {
    expect(shouldPurgePii({ deliveredAt: delivered, now: new Date('2026-01-11'), retentionDays: 10 }).purge).toBe(true);
  });
});

describe('shipByAlertDecision (12 h before deadline, no tracking)', () => {
  const shipBy = new Date('2026-05-10T12:00:00Z');
  const at = (iso: string, extra = {}) => shipByAlertDecision({ shipByAt: shipBy, hasTracking: false, now: new Date(iso), ...extra });
  it('no alert more than 12 h ahead', () => expect(at('2026-05-09T23:59:00Z').alert).toBe(false));
  it('alerts exactly 12 h ahead', () => expect(at('2026-05-10T00:00:00Z')).toEqual({ alert: true, overdue: false, hoursLeft: 12 }));
  it('alerts and flags overdue after the deadline', () => {
    const r = at('2026-05-10T14:00:00Z');
    expect(r.alert).toBe(true);
    expect(r.overdue).toBe(true);
    expect(r.hoursLeft).toBe(-2);
  });
  it('no alert when tracking present', () => expect(at('2026-05-10T11:00:00Z', { hasTracking: true }).alert).toBe(false));
  it('no alert without a deadline', () =>
    expect(shipByAlertDecision({ shipByAt: null, hasTracking: false, now: new Date() }).alert).toBe(false));
  it('no alert when already alerted', () => expect(at('2026-05-10T11:00:00Z', { alreadyAlerted: true }).alert).toBe(false));
  it('window configurable', () => expect(at('2026-05-09T00:00:00Z', { alertHoursBefore: 48 }).alert).toBe(true));
});

describe('resolveCarrier', () => {
  const table = { dhl: { temuCarrierId: 'C1', temuCarrierName: 'DHL' } };
  it('maps case-insensitively', () => {
    expect(resolveCarrier(table, ' DHL ')).toEqual({ temuCarrierId: 'C1', temuCarrierName: 'DHL' });
  });
  it('throws explicit error on unknown carrier, never guessing', () => {
    expect(() => resolveCarrier(table, 'fedex')).toThrow(UnknownCarrierError);
    try {
      resolveCarrier(table, 'fedex');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('UNKNOWN_CARRIER');
      expect((e as Error).message).toContain('fedex');
    }
  });
  it('does not match Object.prototype keys', () => {
    expect(() => resolveCarrier(table, 'constructor')).toThrow(UnknownCarrierError);
  });
});
