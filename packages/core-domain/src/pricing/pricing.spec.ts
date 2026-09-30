import { DomainError } from '../errors/domain-error';
import { calculatePrice, applyRounding, selectRule, PricingRule } from './pricing';

const defaultRule: PricingRule = { id: 'default', priority: 0, markupPct: 1, fixedAdd: 0, rounding: 'x.99', minMarginPct: 0.1 };
const base = { cost: '10.00', vatRate: 0.23, channelFeePct: 0, rules: [] as PricingRule[], defaultRule, context: { channel: 'prestashop' } };

describe('pricing', () => {
  describe('calculatePrice', () => {
    it('computes net and gross for cost 10.00, markup 100%, VAT 23%, rounding x.99 (net recomputed from rounded gross)', () => {
      const r = calculatePrice(base);
      expect(r.status).toBe('ok');
      expect(r.gross).toBe('24.99');
      expect(r.net).toBe('20.32'); // 24.99 / 1.23
      expect(r.forced).toBe(false);
      expect(r.ruleId).toBe('default');
    });
    it('rounding none keeps 2 decimal gross', () => {
      const r = calculatePrice({ ...base, defaultRule: { ...defaultRule, rounding: 'none' } });
      expect(r.gross).toBe('24.60');
      expect(r.net).toBe('20.00');
    });
    it('applies fixedAdd before VAT', () => {
      const r = calculatePrice({ ...base, defaultRule: { ...defaultRule, rounding: 'none', fixedAdd: 1 } });
      expect(r.net).toBe('21.00');
      expect(r.gross).toBe('25.83');
    });
    it('picks the highest priority matching rule when several match', () => {
      const rules: PricingRule[] = [
        { id: 'low', priority: 1, markupPct: 0.5, rounding: 'none', minMarginPct: 0, conditions: { channel: 'prestashop' } },
        { id: 'high', priority: 10, markupPct: 2, rounding: 'none', minMarginPct: 0, conditions: { channel: 'prestashop' } },
        { id: 'mid', priority: 5, markupPct: 3, rounding: 'none', minMarginPct: 0 },
      ];
      const r = calculatePrice({ ...base, rules });
      expect(r.ruleId).toBe('high');
      expect(r.net).toBe('30.00');
    });
    it('falls back to the default rule when no condition matches', () => {
      const rules: PricingRule[] = [{ id: 'temu', priority: 9, markupPct: 5, minMarginPct: 0, conditions: { channel: 'temu' } }];
      expect(calculatePrice({ ...base, rules }).ruleId).toBe('default');
    });
    it('returns blocked when margin after channel fee is below min_margin_pct', () => {
      const r = calculatePrice({ ...base, channelFeePct: 0.5 });
      expect(r.status).toBe('blocked');
      expect(r.reason).toBe('MARGIN_BELOW_MIN');
      expect(r.forced).toBe(false);
    });
    it('applies fixed channel fee too', () => {
      const r = calculatePrice({ ...base, channelFeeFixed: '20' });
      expect(r.status).toBe('blocked');
    });
    it('includes absorbed shipping in cost base', () => {
      const r = calculatePrice({ ...base, shippingAbsorbed: '5', defaultRule: { ...defaultRule, rounding: 'none' } });
      expect(r.net).toBe('30.00');
      expect(r.marginPct).toBe('0.5000');
    });
    it('handles cost as string "0.94" and number 0.94 identically', () => {
      expect(calculatePrice({ ...base, cost: '0.94' })).toEqual(calculatePrice({ ...base, cost: 0.94 }));
    });
    it('never produces zero prices (blocked) and rejects negative inputs', () => {
      const zero = calculatePrice({ ...base, cost: 0, defaultRule: { ...defaultRule, rounding: 'none' } });
      expect(zero.status).toBe('blocked');
      expect(zero.reason).toBe('NON_POSITIVE_PRICE');
      expect(() => calculatePrice({ ...base, cost: -1 })).toThrow(DomainError);
      expect(() => calculatePrice({ ...base, shippingAbsorbed: -1 })).toThrow(DomainError);
    });
    it('rounded prices are always positive even for tiny costs', () => {
      const r = calculatePrice({ ...base, cost: '0.01', defaultRule: { ...defaultRule, minMarginPct: 0 } });
      expect(Number(r.gross)).toBeGreaterThan(0);
    });
    it('forced override passes but is flagged forced=true', () => {
      const r = calculatePrice({ ...base, override: { gross: '12.30', force: true } });
      expect(r.status).toBe('ok');
      expect(r.forced).toBe(true);
      expect(r.gross).toBe('12.30');
      expect(r.net).toBe('10.00');
      expect(r.marginPct).toBe('0.0000');
    });
    it('non forced override still passes the margin guard', () => {
      const blocked = calculatePrice({ ...base, override: { gross: '12.30' } });
      expect(blocked.status).toBe('blocked');
      expect(blocked.forced).toBe(false);
      const ok = calculatePrice({ ...base, override: { gross: 30 } });
      expect(ok.status).toBe('ok');
      expect(ok.gross).toBe('30.00');
    });
    it('rejects non positive override even when forced', () => {
      expect(() => calculatePrice({ ...base, override: { gross: 0, force: true } })).toThrow(DomainError);
    });
  });

  describe('selectRule', () => {
    const r = (id: string, priority: number, conditions?: PricingRule['conditions']): PricingRule => ({ id, priority, markupPct: 0, minMarginPct: 0, conditions });
    it('matches category, tag and cost range', () => {
      const rules = [
        r('cat', 5, { category: 'crystals' }),
        r('tag', 4, { tag: 'vip' }),
        r('cost', 3, { costMin: '5', costMax: '20' }),
      ];
      expect(selectRule(rules, defaultRule, { cost: 10, category: 'crystals' }).id).toBe('cat');
      expect(selectRule(rules, defaultRule, { cost: 10, tags: ['vip'] }).id).toBe('tag');
      expect(selectRule(rules, defaultRule, { cost: 10 }).id).toBe('cost');
      expect(selectRule(rules, defaultRule, { cost: 4.99 }).id).toBe('default');
      expect(selectRule(rules, defaultRule, { cost: 20.01 }).id).toBe('default');
      expect(selectRule(rules, defaultRule, { cost: 20 }).id).toBe('cost');
      expect(selectRule([r('c', 1, { costMin: 5 })], defaultRule, { cost: 6 }).id).toBe('c');
      expect(selectRule([r('c', 1, { costMax: 5 })], defaultRule, { cost: 6 }).id).toBe('default');
    });
    it('requires all conditions to match and breaks priority ties by list order', () => {
      const rules = [r('a', 1, { channel: 'temu', category: 'x' }), r('b', 1), r('c', 1)];
      expect(selectRule(rules, defaultRule, { cost: 1, channel: 'temu' }).id).toBe('b');
    });
  });

  describe('applyRounding', () => {
    it.each([
      ['24.60', 'x.99', '24.99'],
      ['24.99', 'x.99', '24.99'],
      ['25.00', 'x.99', '25.99'],
      ['0.30', 'x.99', '0.99'],
      ['24.60', 'x.90', '24.90'],
      ['24.91', 'x.90', '25.90'],
      ['24.614', 'none', '24.61'],
      ['24.615', 'none', '24.62'],
    ])('%s with %s => %s', (g, mode, exp) => {
      expect(applyRounding(g, mode as never).toFixed(2)).toBe(exp);
    });
  });
});
