import { TestBed } from '@angular/core/testing';
import { CategoryMapping } from './category-mapping';
import { settings } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

async function setUp() {
  const api = {
    supplierPaths: vi.fn().mockResolvedValue({
      items: [{ department: 'Crystals', subDepartment: 'Clusters', family: 'Amethyst', productCount: 3, categoryId: null, channels: [] }],
    }),
    categories: vi.fn().mockResolvedValue({ items: [{ id: 'c1', name: 'Crystals', slug: 'crystals', parentId: null }] }),
    settings: vi.fn().mockResolvedValue(settings()),
    channelCategories: vi.fn().mockResolvedValue({ items: [{ id: 'cc1', parentId: null, name: 'Minerals', leaf: true }] }),
    channelAttributes: vi.fn().mockResolvedValue({ items: [], mandatory: ['Material', 'Origin'] }),
    mapSupplierPath: vi.fn().mockResolvedValue({}),
    createCategory: vi.fn().mockResolvedValue({ id: 'c2', name: 'New', slug: 'new', parentId: null }),
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(CategoryMapping);
  await waitUntil(fixture, () => el(fixture, 'channel-select-0-ch1')?.querySelector('option[value="cc1"]') && el(fixture, 'category-select-0')?.querySelector('option[value="c1"]'));
  return { fixture, api };
}

describe('CategoryMapping', () => {
  it('lists the distinct supplier paths with their product count', async () => {
    const { fixture } = await setUp();
    expect(els(fixture, 'path-row')).toHaveLength(1);
    expect(els(fixture, 'path-row')[0].textContent).toContain('Crystals / Clusters / Amethyst');
  });

  it('saves the internal category and channel categories for a path', async () => {
    const { fixture, api } = await setUp();
    setValue(el(fixture, 'category-select-0'), 'c1');
    setValue(el(fixture, 'channel-select-0-ch1'), 'cc1');
    fixture.detectChanges();
    el<HTMLButtonElement>(fixture, 'save-mapping-0')!.click();
    await waitUntil(fixture, () => api.mapSupplierPath.mock.calls.length > 0);

    expect(api.mapSupplierPath).toHaveBeenCalledWith({
      department: 'Crystals',
      subDepartment: 'Clusters',
      family: 'Amethyst',
      categoryId: 'c1',
      channels: [{ channelId: 'ch1', channelCategoryId: 'cc1' }],
    });
  });

  it('does not save a path without an internal category', async () => {
    const { fixture, api } = await setUp();
    expect(el<HTMLButtonElement>(fixture, 'save-mapping-0')!.disabled).toBe(true);
    expect(api.mapSupplierPath).not.toHaveBeenCalled();
  });

  it('loads the mandatory attributes when a Temu category is chosen', async () => {
    const { fixture, api } = await setUp();
    setValue(el(fixture, 'channel-select-0-ch2'), 'cc1');
    await waitUntil(fixture, () => el(fixture, 'mandatory-0-ch2'));
    expect(api.channelAttributes).toHaveBeenCalledWith('ch2', 'cc1');
    expect(el(fixture, 'mandatory-0-ch2')?.textContent).toContain('Material');
  });

  it('validates the new category name with the shared schema before creating it', async () => {
    const { fixture, api } = await setUp();
    el<HTMLButtonElement>(fixture, 'create-category-button')!.click();
    fixture.detectChanges();
    expect(api.createCategory).not.toHaveBeenCalled();

    setValue(el(fixture, 'category-name-input'), 'New');
    el<HTMLButtonElement>(fixture, 'create-category-button')!.click();
    await waitUntil(fixture, () => api.createCategory.mock.calls.length > 0);
    expect(api.createCategory).toHaveBeenCalledWith({ name: 'New' });
  });
});
