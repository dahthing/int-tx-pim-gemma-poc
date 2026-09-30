import { TestBed } from '@angular/core/testing';
import { ProductDetailPage } from './product-detail';
import { productDetail } from '../testing/fixtures';
import { el, providePimTesting, waitUntil } from '../testing/pim-test-utils';

describe('ProductDetailPage', () => {
  it('loads the product and offers the five tabs', async () => {
    const api = { product: vi.fn().mockResolvedValue(productDetail()) };
    TestBed.configureTestingModule({ providers: providePimTesting(api) });
    const fixture = TestBed.createComponent(ProductDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    await waitUntil(fixture, () => el(fixture, 'product-sku'));

    expect(api.product).toHaveBeenCalledWith('p1');
    expect(el(fixture, 'product-sku')?.textContent).toContain('SKU-1');
    const text = fixture.nativeElement.textContent as string;
    for (const label of ['Info', 'Media', 'Enrichment', 'Pricing', 'Channels']) expect(text).toContain(label);
  });

  it('shows an error state when the product cannot be loaded', async () => {
    const api = { product: vi.fn().mockRejectedValue(new Error('Not found')) };
    TestBed.configureTestingModule({ providers: providePimTesting(api) });
    const fixture = TestBed.createComponent(ProductDetailPage);
    fixture.componentRef.setInput('id', 'nope');
    await waitUntil(fixture, () => el(fixture, 'product-error'));
    expect(el(fixture, 'product-error')?.textContent).toContain('Not found');
  });
});
