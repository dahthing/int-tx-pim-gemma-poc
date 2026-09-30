import { decodeOrderLines, encodeOrderLines, updateOrderMeta } from './order-lines.codec';

describe('order-lines codec', () => {
  it('round-trips items, ship-by and meta', () => {
    const shipByAt = new Date('2026-10-01T10:00:00.000Z');
    const enc = encodeOrderLines({ items: [{ sku: 'A', quantity: 2 }], shipByAt, manualReviewReason: 'unknown_sku' });
    const dec = decodeOrderLines(JSON.parse(JSON.stringify(enc)));
    expect(dec.items).toEqual([{ sku: 'A', quantity: 2 }]);
    expect(dec.shipByAt).toEqual(shipByAt);
    expect(dec.manualReviewReason).toBe('unknown_sku');
    expect(dec.shipByAlertedAt).toBeNull();
    expect(dec.deliveredAt).toBeNull();
    expect(dec.piiPurgedAt).toBeNull();
  });

  it('encodes null ship-by and tolerates a legacy bare array', () => {
    expect(decodeOrderLines(encodeOrderLines({ items: [], shipByAt: null })).shipByAt).toBeNull();
    const legacy = decodeOrderLines([{ sku: 'B', quantity: 1 }]);
    expect(legacy.items).toEqual([{ sku: 'B', quantity: 1 }]);
    expect(legacy.shipByAt).toBeNull();
    expect(decodeOrderLines(null).items).toEqual([]);
  });

  it('updateOrderMeta patches dates immutably', () => {
    const base = encodeOrderLines({ items: [{ sku: 'A', quantity: 1 }], shipByAt: null });
    const at = new Date('2026-01-01T00:00:00.000Z');
    const next = updateOrderMeta(base, { deliveredAt: at, piiPurgedAt: at, shipByAlertedAt: at });
    const dec = decodeOrderLines(next);
    expect(dec.deliveredAt).toEqual(at);
    expect(dec.piiPurgedAt).toEqual(at);
    expect(dec.shipByAlertedAt).toEqual(at);
    expect(decodeOrderLines(base).deliveredAt).toBeNull();
  });
});
