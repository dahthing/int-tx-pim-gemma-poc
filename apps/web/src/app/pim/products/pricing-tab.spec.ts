import { TestBed } from '@angular/core/testing';
import { PricingTab } from './pricing-tab';
import { quote } from '../testing/fixtures';
import { el, els, providePimTesting, waitUntil } from '../testing/pim-test-utils';

async function setUp(quotes: unknown[]) {
  const api = { pricing: vi.fn().mockResolvedValue({ quotes }), quotePrice: vi.fn() };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(PricingTab);
  fixture.componentRef.setInput('productId', 'p1');
  await waitUntil(fixture, () => els(fixture, 'quote-row').length > 0);
  return { fixture, api };
}

describe('PricingTab', () => {
  it('shows price and margin for an ok quote without a blocked badge', async () => {
    const { fixture, api } = await setUp([quote()]);
    expect(api.pricing).toHaveBeenCalledWith('p1');
    const row = els(fixture, 'quote-row')[0].textContent;
    expect(row).toContain('24.99');
    expect(row).toContain('35.0%');
    expect(el(fixture, 'blocked-badge')).toBeNull();
  });

  it('shows the blocked badge and the reason for a blocked quote', async () => {
    const { fixture } = await setUp([
      quote({ channelId: 'ch2', channelCode: 'temu-eu', status: 'blocked', net: null, gross: null, marginPct: '0.02', reason: 'MARGIN_BELOW_MIN' }),
    ]);
    expect(el(fixture, 'blocked-badge')?.textContent).toContain('blocked');
    expect(el(fixture, 'blocked-reason')?.textContent).toContain('Margin below minimum');
  });

  it('shows why no quote could be computed', async () => {
    const { fixture } = await setUp([quote({ status: 'blocked', gross: null, net: null, marginPct: null, error: 'Product has no cost' })]);
    expect(el(fixture, 'blocked-reason')?.textContent).toContain('Product has no cost');
  });
});
