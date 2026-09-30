import { foldAlerts, type AlertEventRow } from './alerts';

const ev = (
  id: string,
  key: string,
  action: string,
  at: string,
  diff: unknown = {},
): AlertEventRow => ({
  id,
  entityId: key,
  action,
  createdAt: new Date(at),
  diff,
});

describe('foldAlerts', () => {
  it('keeps one open alert per key using the latest raised content', () => {
    const r = foldAlerts([
      ev('e2', 'k', 'alert.raised', '2026-01-02T00:00:00Z', {
        type: 'margin_break',
        message: 'second',
        productId: 'p',
        channelId: 'c',
        channelOrderId: 'o',
      }),
      ev('e1', 'k', 'alert.raised', '2026-01-01T00:00:00Z', {
        type: 'margin_break',
        message: 'first',
      }),
    ]);
    expect(r).toEqual([
      {
        id: 'e2',
        type: 'margin_break',
        message: 'second',
        dedupeKey: 'k',
        status: 'open',
        raisedAt: '2026-01-02T00:00:00.000Z',
        productId: 'p',
        channelId: 'c',
        channelOrderId: 'o',
      },
    ]);
  });

  it('marks an acknowledged alert and re-opens it when raised again', () => {
    const acked = foldAlerts([
      ev('e1', 'k', 'alert.raised', '2026-01-01T00:00:00Z', {
        type: 't',
        message: 'm',
      }),
      ev('a1', 'k', 'alert.acknowledged', '2026-01-02T00:00:00Z'),
    ]);
    expect(acked[0]).toMatchObject({
      id: 'e1',
      status: 'acknowledged',
      productId: null,
    });
    const reopened = foldAlerts([
      ev('e1', 'k', 'alert.raised', '2026-01-01T00:00:00Z', {
        type: 't',
        message: 'm',
      }),
      ev('a1', 'k', 'alert.acknowledged', '2026-01-02T00:00:00Z'),
      ev('e3', 'k', 'alert.raised', '2026-01-03T00:00:00Z', {
        type: 't',
        message: 'm2',
      }),
    ]);
    expect(reopened[0]).toMatchObject({
      id: 'e3',
      status: 'open',
      message: 'm2',
    });
  });

  it('ignores keys that were never raised, defaults missing content and sorts newest first', () => {
    const r = foldAlerts([
      ev('x', 'orphan', 'alert.acknowledged', '2026-01-01T00:00:00Z'),
      ev('a', 'k1', 'alert.raised', '2026-01-01T00:00:00Z', null),
      ev('b', 'k2', 'alert.raised', '2026-01-05T00:00:00Z', {
        type: 7,
        message: 3,
      }),
    ]);
    expect(r.map((a) => a.id)).toEqual(['b', 'a']);
    expect(r[1]).toMatchObject({ type: 'unknown', message: '' });
  });

  it('keeps equal timestamps stable', () => {
    const r = foldAlerts([
      ev('a', 'k1', 'alert.raised', '2026-01-01T00:00:00Z'),
      ev('b', 'k2', 'alert.raised', '2026-01-01T00:00:00Z'),
    ]);
    expect(r).toHaveLength(2);
  });
});
