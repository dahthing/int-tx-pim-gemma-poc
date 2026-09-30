import { DomainError } from '../errors/domain-error';
import { availableStock } from './stock';

const ok = { published: true, supplierProductMissing: false, assortmentDisabled: false };

describe('stock', () => {
  it('stock 10, buffer 2 => 8', () => expect(availableStock({ ...ok, supplierStock: 10, buffer: 2 })).toBe(8));
  it('stock 1, buffer 2 => 0', () => expect(availableStock({ ...ok, supplierStock: 1, buffer: 2 })).toBe(0));
  it('cap applied after buffer', () => {
    expect(availableStock({ ...ok, supplierStock: 100, buffer: 5, cap: 50 })).toBe(50);
    expect(availableStock({ ...ok, supplierStock: 54, buffer: 5, cap: 50 })).toBe(49);
    expect(availableStock({ ...ok, supplierStock: 10, buffer: 5, cap: 50 })).toBe(5);
  });
  it('defaults buffer to 0 when omitted', () => expect(availableStock({ ...ok, supplierStock: 3 })).toBe(3));
  it('returns 0 when not published', () => expect(availableStock({ ...ok, published: false, supplierStock: 10, buffer: 0 })).toBe(0));
  it('returns 0 when supplier product missing', () => expect(availableStock({ ...ok, supplierProductMissing: true, supplierStock: 10 })).toBe(0));
  it('returns 0 when assortment disabled', () => expect(availableStock({ ...ok, assortmentDisabled: true, supplierStock: 10 })).toBe(0));
  it('treats negative stock as 0 and floors fractions', () => {
    expect(availableStock({ ...ok, supplierStock: -4 })).toBe(0);
    expect(availableStock({ ...ok, supplierStock: 7.9, buffer: 2 })).toBe(5);
  });
  it('rejects invalid numbers', () => {
    expect(() => availableStock({ ...ok, supplierStock: NaN })).toThrow(DomainError);
    expect(() => availableStock({ ...ok, supplierStock: 1, buffer: -1 })).toThrow(DomainError);
    expect(() => availableStock({ ...ok, supplierStock: 1, cap: -1 })).toThrow(DomainError);
  });
});
