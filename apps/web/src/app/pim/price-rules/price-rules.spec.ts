import { TestBed } from '@angular/core/testing';
import { PriceRules } from './price-rules';
import { priceRule, settings } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

async function setUp() {
  const api = {
    priceRules: vi.fn().mockResolvedValue({ items: [priceRule()] }),
    settings: vi.fn().mockResolvedValue(settings()),
    createPriceRule: vi.fn().mockResolvedValue(priceRule({ id: 'r2' })),
    updatePriceRule: vi.fn().mockResolvedValue(priceRule()),
    deletePriceRule: vi.fn().mockResolvedValue({}),
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(PriceRules);
  await waitUntil(fixture, () => els(fixture, 'rule-row').length > 0);
  return { fixture, api };
}

describe('PriceRules', () => {
  it('lists rules with percentages shown as percents', async () => {
    const { fixture } = await setUp();
    const row = els(fixture, 'rule-row')[0].textContent;
    expect(row).toContain('50%');
    expect(row).toContain('23%');
  });

  it('refuses to create a rule when the shared schema rejects the form and shows the error', async () => {
    const { fixture, api } = await setUp();
    setValue(el(fixture, 'markupPct-input'), 'abc');
    el<HTMLButtonElement>(fixture, 'save-rule-button')!.click();
    fixture.detectChanges();

    expect(api.createPriceRule).not.toHaveBeenCalled();
    expect(el(fixture, 'form-error')).not.toBeNull();
  });

  it('creates a rule with fractions as decimal strings', async () => {
    const { fixture, api } = await setUp();
    setValue(el(fixture, 'vatRate-input'), '0.23');
    setValue(el(fixture, 'markupPct-input'), '0.5');
    setValue(el(fixture, 'rounding-select'), 'x.99');
    el<HTMLButtonElement>(fixture, 'save-rule-button')!.click();
    await waitUntil(fixture, () => api.createPriceRule.mock.calls.length > 0);

    expect(api.createPriceRule).toHaveBeenCalledWith({
      priority: 0,
      condition: {},
      markupPct: '0.5',
      rounding: 'x.99',
      vatRate: '0.23',
    });
  });

  it('edits an existing rule through PATCH and deletes through DELETE', async () => {
    const { fixture, api } = await setUp();
    el<HTMLButtonElement>(fixture, 'edit-rule-button')!.click();
    fixture.detectChanges();
    expect((el(fixture, 'vatRate-input') as HTMLInputElement).value).toBe('0.23');
    setValue(el(fixture, 'markupPct-input'), '0.6');
    el<HTMLButtonElement>(fixture, 'save-rule-button')!.click();
    await waitUntil(fixture, () => api.updatePriceRule.mock.calls.length > 0);
    expect(api.updatePriceRule).toHaveBeenCalledWith('r1', expect.objectContaining({ markupPct: '0.6', vatRate: '0.23' }));

    el<HTMLButtonElement>(fixture, 'delete-rule-button')!.click();
    await waitUntil(fixture, () => api.deletePriceRule.mock.calls.length > 0);
    expect(api.deletePriceRule).toHaveBeenCalledWith('r1');
  });
});
