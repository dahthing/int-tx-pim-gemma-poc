import { TestBed } from '@angular/core/testing';
import { ProductListPage } from './product-list';
import { page, productListItem } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

async function setUp() {
  const api = { products: vi.fn().mockResolvedValue(page([productListItem()])) };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(ProductListPage);
  await waitUntil(fixture, () => els(fixture, 'product-row').length > 0);
  return { fixture, api };
}

describe('ProductListPage', () => {
  it('shows one status chip per channel listing', async () => {
    const { fixture } = await setUp();
    const chips = els(fixture, 'listing-chip').map((c) => c.textContent?.trim());
    expect(chips).toEqual(['prestashop9: live', 'temu-eu: pending']);
    expect(els(fixture, 'product-row')[0].textContent).toContain('SKU-1');
  });

  it('passes the status and enrichment filters to the API', async () => {
    const { fixture, api } = await setUp();
    expect(api.products).toHaveBeenLastCalledWith({ skip: 0, take: 20 });

    setValue(el(fixture, 'status-select'), 'draft');
    await waitUntil(fixture, () => api.products.mock.lastCall?.[0].status === 'draft');
    setValue(el(fixture, 'enrichment-select'), 'ai_draft');
    await waitUntil(fixture, () => api.products.mock.lastCall?.[0].enrichmentStatus === 'ai_draft');

    expect(api.products).toHaveBeenLastCalledWith({ skip: 0, take: 20, status: 'draft', enrichmentStatus: 'ai_draft' });
  });
});
