import { DomainError } from '../errors/domain-error';
import { computeMarginPct, isBelowMinMargin } from './margin-guard';

describe('margin-guard', () => {
  it('computes (net - cost - shipping - fee) / net', () => {
    expect(computeMarginPct({ net: '20.00', cost: '10', shippingAbsorbed: '2', channelFee: '1' }).toFixed(4)).toBe('0.3500');
  });
  it('accepts numbers and strings identically', () => {
    const a = computeMarginPct({ net: 20, cost: 10, shippingAbsorbed: 0, channelFee: 0 });
    const b = computeMarginPct({ net: '20', cost: '10', shippingAbsorbed: '0', channelFee: '0' });
    expect(a.equals(b)).toBe(true);
  });
  it('throws for non positive net', () => {
    expect(() => computeMarginPct({ net: 0, cost: 1, shippingAbsorbed: 0, channelFee: 0 })).toThrow(DomainError);
  });
  it('throws for invalid money input', () => {
    expect(() => computeMarginPct({ net: 'abc', cost: 1, shippingAbsorbed: 0, channelFee: 0 })).toThrow(DomainError);
  });
  it('detects margin below the minimum', () => {
    expect(isBelowMinMargin('0.19', '0.2')).toBe(true);
    expect(isBelowMinMargin('0.2', '0.2')).toBe(false);
  });
});
