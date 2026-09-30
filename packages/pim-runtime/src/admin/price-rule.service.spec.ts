import { createMockDb } from '../testing/mock-db';
import { PriceRuleService } from './price-rule.service';

const d = new Date('2026-01-01T00:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  channelId: null,
  priority: 2,
  condition: { channel: 'temu-eu' },
  markupPct: { toString: () => '0.5' },
  fixedAdd: null,
  rounding: 'X99',
  minMarginPct: { toString: () => '0.1' },
  vatRate: { toString: () => '0.23' },
  createdAt: d,
  updatedAt: d,
  deletedAt: null,
  ...over,
});
const setup = () => {
  const { db, mock } = createMockDb();
  return { mock, svc: new PriceRuleService(db) };
};

describe('PriceRuleService', () => {
  it('lists rules by priority and maps decimals and rounding', async () => {
    const { svc, mock } = setup();
    mock.priceRule.findMany.mockResolvedValue([
      row(),
      row({ id: 'r2', rounding: 'NONE', condition: null, markupPct: null }),
    ]);
    const r = await svc.list('t');
    expect(mock.priceRule.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't', deletedAt: null },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    expect(r[0]).toEqual({
      id: 'r1',
      channelId: null,
      priority: 2,
      condition: { channel: 'temu-eu' },
      markupPct: '0.5',
      fixedAdd: null,
      rounding: 'x.99',
      minMarginPct: '0.1',
      vatRate: '0.23',
      createdAt: d.toISOString(),
      updatedAt: d.toISOString(),
    });
    expect(r[1]).toMatchObject({
      rounding: 'none',
      condition: {},
      markupPct: null,
    });
  });

  it('gets one rule and 404s otherwise', async () => {
    const { svc, mock } = setup();
    mock.priceRule.findFirst.mockResolvedValue(row());
    expect((await svc.get('t', 'r1')).id).toBe('r1');
    mock.priceRule.findFirst.mockResolvedValue(null);
    await expect(svc.get('t', 'x')).rejects.toThrow(/Price rule x/);
  });

  it('creates a rule for a known channel', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue({ id: 'c' });
    mock.priceRule.create.mockResolvedValue(row({ channelId: 'c' }));
    await svc.create('t', {
      channelId: 'c',
      priority: 1,
      condition: {},
      markupPct: '0.5',
      rounding: 'x.90',
      vatRate: '0.23',
    });
    expect(mock.priceRule.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't',
        channelId: 'c',
        priority: 1,
        condition: {},
        markupPct: '0.5',
        fixedAdd: null,
        rounding: 'X90',
        minMarginPct: null,
        vatRate: '0.23',
      },
    });
  });

  it('creates a global rule without a channel lookup', async () => {
    const { svc, mock } = setup();
    mock.priceRule.create.mockResolvedValue(row());
    await svc.create('t', {
      priority: 0,
      condition: {},
      rounding: 'none',
      vatRate: '0.23',
    });
    expect(mock.channel.findFirst).not.toHaveBeenCalled();
    expect(mock.priceRule.create.mock.calls[0][0].data.channelId).toBeNull();
  });

  it('rejects an unknown channel', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(
      svc.create('t', {
        channelId: 'zz',
        priority: 0,
        condition: {},
        rounding: 'none',
        vatRate: '0.23',
      }),
    ).rejects.toThrow(/Channel zz/);
  });

  it('applies only the provided fields on update, including clearing values', async () => {
    const { svc, mock } = setup();
    mock.priceRule.findFirst.mockResolvedValue(row());
    mock.priceRule.update.mockResolvedValue(row({ priority: 9 }));
    await svc.update('t', 'r1', {
      priority: 9,
      markupPct: null,
      rounding: 'x.99',
      condition: { tag: 'a' },
      fixedAdd: '1',
      minMarginPct: '0.2',
      vatRate: '0.21',
      channelId: null,
    });
    expect(mock.priceRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        channelId: null,
        priority: 9,
        condition: { tag: 'a' },
        markupPct: null,
        fixedAdd: '1',
        rounding: 'X99',
        minMarginPct: '0.2',
        vatRate: '0.21',
      },
    });
    await svc.update('t', 'r1', { priority: 1 });
    expect(mock.priceRule.update).toHaveBeenLastCalledWith({
      where: { id: 'r1' },
      data: { priority: 1 },
    });
  });

  it('validates the channel on update and 404s missing rules', async () => {
    const { svc, mock } = setup();
    mock.priceRule.findFirst.mockResolvedValue(row());
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(svc.update('t', 'r1', { channelId: 'zz' })).rejects.toThrow(
      /Channel zz/,
    );
    mock.priceRule.findFirst.mockResolvedValue(null);
    await expect(svc.update('t', 'nope', { priority: 1 })).rejects.toThrow(
      /Price rule/,
    );
  });

  it('soft deletes', async () => {
    const { svc, mock } = setup();
    mock.priceRule.findFirst.mockResolvedValue(row());
    mock.priceRule.update.mockResolvedValue(row());
    await svc.remove('t', 'r1');
    expect(mock.priceRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
