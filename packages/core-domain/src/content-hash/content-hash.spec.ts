import { canonicalJson, contentHash } from './content-hash';

const content = { name: 'Quartz', description: 'Nice', ean: '123', categories: ['a', 'b'], weightG: 100, imageUrl: 'http://x/1.jpg' };

describe('content-hash', () => {
  it('is a 64 hex char SHA-256', () => expect(contentHash(content)).toMatch(/^[0-9a-f]{64}$/));
  it('same content with different key order => same hash', () => {
    const reordered = { imageUrl: content.imageUrl, weightG: 100, categories: ['a', 'b'], ean: '123', description: 'Nice', name: 'Quartz' };
    expect(contentHash(reordered)).toBe(contentHash(content));
  });
  it('price or stock change => same content hash', () => {
    expect(contentHash({ ...content, price: 5, stock: 3 } as never)).toBe(contentHash({ ...content, price: 9, stock: 0 } as never));
    expect(contentHash({ ...content, price: 5 } as never)).toBe(contentHash(content));
  });
  it('name change => different hash', () => expect(contentHash({ ...content, name: 'Other' })).not.toBe(contentHash(content)));
  it('each content field affects the hash', () => {
    const h = contentHash(content);
    for (const patch of [{ description: 'x' }, { shortDescription: 'x' }, { ean: '9' }, { categories: ['a'] }, { weightG: 1 }, { imageUrl: 'y' }, { imageUrls: ['y'] }]) {
      expect(contentHash({ ...content, ...patch })).not.toBe(h);
    }
  });
  it('undefined equals absent', () => expect(contentHash({ ...content, ean: undefined })).toBe(contentHash({ name: 'Quartz', description: 'Nice', categories: ['a', 'b'], weightG: 100, imageUrl: 'http://x/1.jpg' })));
  it('canonicalJson sorts keys deeply and keeps array order', () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }, 2], a: 'x', u: undefined })).toBe('{"a":"x","b":[{"a":null,"z":1},2]}');
  });
});
