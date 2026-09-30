import { TestBed } from '@angular/core/testing';
import { EnrichmentTab } from './enrichment-tab';
import { enrichment, productDetail } from '../testing/fixtures';
import { el, els, providePimTesting, waitUntil } from '../testing/pim-test-utils';

function setUp(product: Record<string, unknown>, api: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(EnrichmentTab);
  fixture.componentRef.setInput('product', product);
  fixture.detectChanges();
  return fixture;
}

describe('EnrichmentTab', () => {
  it('keeps Approve disabled until a valid AI draft exists', () => {
    const fixture = setUp(productDetail());
    expect(el<HTMLButtonElement>(fixture, 'approve-button')!.disabled).toBe(true);
    expect(el<HTMLButtonElement>(fixture, 'generate-button')!.disabled).toBe(false);
  });

  it('enables Approve for an ai_draft with enrichment content and approves once', async () => {
    const approveEnrichment = vi.fn().mockResolvedValue({ enrichmentStatus: 'approved' });
    const fixture = setUp(productDetail({ enrichmentStatus: 'ai_draft', enrichment: enrichment() }), { approveEnrichment });

    const approve = el<HTMLButtonElement>(fixture, 'approve-button')!;
    expect(approve.disabled).toBe(false);
    expect(el(fixture, 'draft-preview')?.textContent).toContain('Ponto um');

    approve.click();
    approve.click();
    await waitUntil(fixture, () => approveEnrichment.mock.calls.length > 0);
    expect(approveEnrichment).toHaveBeenCalledTimes(1);
    expect(approveEnrichment).toHaveBeenCalledWith('p1');
  });

  it('disables Approve once the product is already approved', () => {
    const fixture = setUp(productDetail({ enrichmentStatus: 'approved', enrichment: enrichment() }));
    expect(el<HTMLButtonElement>(fixture, 'approve-button')!.disabled).toBe(true);
  });

  it('shows the validation errors of a rejected generation and keeps Approve disabled', async () => {
    const generateEnrichment = vi.fn().mockResolvedValue({ ok: false, errors: ['Title too long', 'Forbidden term: cura'] });
    const fixture = setUp(productDetail({ enrichmentStatus: 'ai_draft', enrichment: enrichment() }), { generateEnrichment });

    el<HTMLButtonElement>(fixture, 'generate-button')!.click();
    await waitUntil(fixture, () => els(fixture, 'enrichment-error').length > 0);

    expect(generateEnrichment).toHaveBeenCalledWith('p1');
    expect(els(fixture, 'enrichment-error').map((e) => e.textContent?.trim())).toEqual([
      'Title too long',
      'Forbidden term: cura',
    ]);
    expect(el<HTMLButtonElement>(fixture, 'approve-button')!.disabled).toBe(true);
  });
});
