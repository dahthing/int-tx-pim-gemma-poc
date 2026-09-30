import { loadFixture } from './__fixtures__/load';
import {
  mapImages,
  mapOrderStatus,
  mapPortfolioItem,
  mapProduct,
  mapTransaction,
  parseDecimal,
  addressChecksum,
} from './aw-mappers';

describe('parseDecimal', () => {
  it('parses strings and numbers without float drift', () => {
    expect(parseDecimal('0.94')).toBe('0.94');
    expect(parseDecimal(1.5)).toBe('1.5');
    expect(parseDecimal('0.1')).toBe('0.1');
  });
  it('rejects invalid input', () => {
    expect(() => parseDecimal('abc')).toThrow();
    expect(() => parseDecimal(null)).toThrow();
  });
});

describe('mapProduct', () => {
  const page = loadFixture('products-page-1.json');
  it('maps the AAL-07 example exactly', () => {
    expect(mapProduct(page.data[0])).toMatchObject({
      externalId: '1201',
      code: 'AAL-07',
      slug: 'aal-07-selenite-wand',
      ean: '5601234567890',
      name: 'Selenite Wand 20cm',
      description: 'Natural selenite wand.',
      descriptionExtra: 'Cleanse with moonlight.',
      departmentName: 'Crystals',
      subDepartmentName: 'Wands',
      familyName: 'Selenite',
      costPrice: '0.94',
      currency: 'EUR',
      stock: 267,
      grossWeightG: 19,
      imageMainUrl: 'https://cdn.aiku.test/p/1201@2x.jpg',
    });
  });
  it('tolerates null description/image/relations and numeric price', () => {
    const p = mapProduct(page.data[1]);
    expect(p.description).toBeNull();
    expect(p.costPrice).toBe('1.5');
    expect(p.imageMainUrl).toBeNull();
    expect(p.departmentName).toBeNull();
    expect(p.grossWeightG).toBeNull();
    expect(p.ean).toBeNull();
  });
  it('preserves unknown fields in rawPayload', () => {
    expect(mapProduct(page.data[0]).rawPayload).toHaveProperty('brand_new_unknown_field', { a: 1 });
  });
  it('falls back to image.original and flat *_name fields', () => {
    const p = mapProduct({
      id: 1, code: 'X', name: 'n', price: '1', currency_code: 'EUR', current_stock: 1,
      image: { original: 'o.jpg' }, department_name: 'D', sub_department_name: 'S', family_name: 'F',
    });
    expect(p.imageMainUrl).toBe('o.jpg');
    expect([p.departmentName, p.subDepartmentName, p.familyName]).toEqual(['D', 'S', 'F']);
  });
});

describe('mapPortfolioItem', () => {
  it('maps listing items and disabled state', () => {
    const [a, b] = loadFixture('my-products.json').data;
    expect(mapPortfolioItem(a)).toEqual({
      externalPortfolioId: '3761386', itemId: '77001', code: 'AAL-07', quantityLeft: 267,
      weight: 19, price: '0.94', sellingPrice: '2.5', status: 'active',
    });
    expect(mapPortfolioItem(b)).toMatchObject({ status: 'disabled', sellingPrice: null, weight: null });
  });
});

describe('mapImages', () => {
  it('returns source.original and ignores thumbnails', () => {
    const out = mapImages(loadFixture('images.json').data);
    expect(out).toEqual([
      { uuid: 'b1c2', name: 'front.jpg', mimeType: 'image/jpeg', url: 'https://cdn.aiku.test/i/front.jpg' },
    ]);
  });
});

describe('order mappers', () => {
  it('lowercases state', () => {
    expect(mapOrderStatus('Dispatched')).toBe('dispatched');
    expect(mapOrderStatus(undefined)).toBe('unknown');
  });
  it('maps transactions', () => {
    expect(mapTransaction(loadFixture('transactions-fail.json').data[0])).toEqual({
      transactionId: '4001', quantityOrdered: 2, quantityDispatched: 1, quantityFail: 1, quantityCancelled: 0,
    });
    expect(mapTransaction({ id: 1 })).toMatchObject({ quantityOrdered: 0, quantityFail: 0 });
  });
  it('address checksum ignores case, spacing and accents-insensitive whitespace', () => {
    const a = { line1: 'Rua das Flores 10', postalCode: '1000-001', city: 'Lisboa', countryCode: 'PT' };
    expect(addressChecksum(a)).toBe(addressChecksum({ ...a, line1: ' rua das  flores 10', city: 'LISBOA', line2: null }));
    expect(addressChecksum(a)).not.toBe(addressChecksum({ ...a, city: 'Porto' }));
  });
});
