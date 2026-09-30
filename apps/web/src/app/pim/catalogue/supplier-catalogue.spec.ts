import { TestBed } from '@angular/core/testing';
import { SupplierCatalogue } from './supplier-catalogue';
import { page, supplierProduct } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

const facets = { departments: ['Crystals', 'Oils'], subDepartments: ['Clusters'], families: ['Amethyst'] };

async function setUp(overrides: Record<string, unknown> = {}) {
  const api = {
    supplierProducts: vi
      .fn()
      .mockResolvedValue(page([supplierProduct(), supplierProduct({ id: 'sp2', inAssortment: true, productId: 'p9' })], 45)),
    supplierProductFacets: vi.fn().mockResolvedValue(facets),
    bulkAdd: vi.fn().mockResolvedValue({ results: [{ supplierProductId: 'sp1', ok: true, productId: 'p1' }] }),
    ...overrides,
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(SupplierCatalogue);
  await waitUntil(fixture, () => els(fixture, 'catalogue-row').length > 0 && el(fixture, 'department-select')?.querySelector('option[value="Crystals"]'));
  return { fixture, api };
}

describe('SupplierCatalogue', () => {
  it('requests the first page with no filters and renders stock and cost', async () => {
    const { fixture, api } = await setUp();

    expect(api.supplierProducts).toHaveBeenLastCalledWith({ skip: 0, take: 20 });
    const row = els(fixture, 'catalogue-row')[0].textContent;
    expect(row).toContain('Amethyst cluster');
    expect(row).toContain('12.50');
    expect(row).toContain('7');
  });

  it('builds the query params from the search box and the department/family filters', async () => {
    const { fixture, api } = await setUp();

    setValue(el(fixture, 'search-input'), 'ame');
    el<HTMLButtonElement>(fixture, 'search-button')!.click();
    await waitUntil(fixture, () => api.supplierProducts.mock.lastCall?.[0].search === 'ame');
    expect(api.supplierProducts).toHaveBeenLastCalledWith({ skip: 0, take: 20, search: 'ame' });

    setValue(el(fixture, 'department-select'), 'Crystals');
    await waitUntil(fixture, () => api.supplierProducts.mock.lastCall?.[0].department === 'Crystals');
    expect(api.supplierProducts).toHaveBeenLastCalledWith({ skip: 0, take: 20, search: 'ame', department: 'Crystals' });
    expect(api.supplierProductFacets).toHaveBeenLastCalledWith({ department: 'Crystals' });

    setValue(el(fixture, 'family-select'), 'Amethyst');
    await waitUntil(fixture, () => api.supplierProducts.mock.lastCall?.[0].family === 'Amethyst');
    expect(api.supplierProducts).toHaveBeenLastCalledWith({
      skip: 0,
      take: 20,
      search: 'ame',
      department: 'Crystals',
      family: 'Amethyst',
    });
  });

  it('disables bulk "Add to Gemma" with 0 selected and enables it once a row is selected', async () => {
    const { fixture } = await setUp();
    const button = el<HTMLButtonElement>(fixture, 'bulk-add-button')!;

    expect(button.disabled).toBe(true);

    el(fixture, 'row-select')!.querySelector('input')!.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('1');
  });

  it('does not allow selecting a product that is already in the assortment', async () => {
    const { fixture } = await setUp();
    const boxes = els(fixture, 'row-select').map((box) => box.querySelector('input')!);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
  });

  it('bulk-adds the selected supplier products and clears the selection', async () => {
    const { fixture, api } = await setUp();

    el(fixture, 'row-select')!.querySelector('input')!.click();
    fixture.detectChanges();
    el<HTMLButtonElement>(fixture, 'bulk-add-button')!.click();
    await waitUntil(fixture, () => el(fixture, 'bulk-result'));

    expect(api.bulkAdd).toHaveBeenCalledWith({ supplierProductIds: ['sp1'] });
    expect(el<HTMLButtonElement>(fixture, 'bulk-add-button')!.disabled).toBe(true);
  });

  it('moves to the next page using skip', async () => {
    const { fixture, api } = await setUp();
    el<HTMLButtonElement>(fixture, 'next-page')!.click();
    await waitUntil(fixture, () => api.supplierProducts.mock.lastCall?.[0].skip === 20);
    expect(api.supplierProducts).toHaveBeenLastCalledWith({ skip: 20, take: 20 });
  });
});
