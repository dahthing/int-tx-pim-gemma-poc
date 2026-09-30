import { createMockDb } from '../testing/mock-db';
import { ListingPayloadBuilderImpl } from './listing-payload.builder';

const ctx = {
  productId: 'p1',
  price: {
    cost: '10',
    vatRate: '0.23',
    rules: [],
    defaultRule: {
      id: 'default',
      priority: 0,
      markupPct: '0.5',
      minMarginPct: '0.1',
      rounding: 'x.99' as const,
    },
  },
  stock: {
    supplierStock: 20,
    buffer: 2,
    published: true,
    supplierProductMissing: false,
    assortmentDisabled: false,
  },
};

function setup() {
  const { db, mock } = createMockDb();
  mock.product.findFirst.mockResolvedValue({
    id: 'p1',
    sku: 'SKU1',
    ean: '123',
    titlePt: 'Titulo',
    shortDescriptionPt: 'curta',
    descriptionPtHtml: '<p>d</p>',
    weightG: 250,
    categoryId: 'cat',
    attributes: {
      enrichment: {
        seoTitle: 'seo t',
        seoDescription: 'seo d',
        bulletPoints: [],
      },
      supplierMissing: false,
      colour: 'azul',
      size: 3,
    },
    compliance: { manufacturer: 'M' },
  });
  mock.categoryMapping.findFirst.mockResolvedValue({
    channelCategoryId: 'ch-cat',
  });
  mock.productMedia.findMany.mockResolvedValue([
    { checksum: 'c1', storageKey: 'k1' },
    { checksum: 'c2', storageKey: 'k2' },
  ]);
  mock.channelListing.findFirst.mockResolvedValue({ externalId: 'ext-9' });
  const enrichment = {
    assertPublishable: jest.fn().mockResolvedValue(undefined),
  };
  const categories = {
    assertPublishable: jest.fn().mockResolvedValue(undefined),
  };
  const media = {
    channelUrls: jest
      .fn()
      .mockResolvedValue(['https://cdn/k1', 'https://cdn/k2']),
  };
  const pricing = { build: jest.fn().mockResolvedValue(ctx) };
  const builder = new ListingPayloadBuilderImpl(
    db,
    enrichment as never,
    categories as never,
    media as never,
    pricing as never,
  );
  return { mock, enrichment, categories, media, pricing, builder };
}

describe('ListingPayloadBuilderImpl', () => {
  it('builds the channel payload from the golden record', async () => {
    const { builder, enrichment, categories } = setup();
    const p = await builder.build('t', 'p1', 'c');
    expect(enrichment.assertPublishable).toHaveBeenCalledWith('t', 'p1');
    expect(categories.assertPublishable).toHaveBeenCalledWith('t', 'p1', 'c');
    expect(p).toEqual({
      sku: 'SKU1',
      ean: '123',
      title: 'Titulo',
      shortDescription: 'curta',
      descriptionHtml: '<p>d</p>',
      weightG: 250,
      priceNet: '15.44',
      vatRate: '0.23',
      stock: 18,
      categoryId: 'ch-cat',
      attributes: { colour: 'azul', size: '3' },
      imageUrls: ['https://cdn/k1', 'https://cdn/k2'],
      imageChecksums: ['c1', 'c2'],
      seoTitle: 'seo t',
      seoDescription: 'seo d',
      compliance: { manufacturer: 'M' },
      active: true,
      enrichmentApproved: true,
      externalId: 'ext-9',
    });
  });

  it('refuses unapproved enrichment and unmapped categories', async () => {
    const a = setup();
    a.enrichment.assertPublishable.mockRejectedValue(new Error('not approved'));
    await expect(a.builder.build('t', 'p1', 'c')).rejects.toThrow(
      'not approved',
    );
    const b = setup();
    b.categories.assertPublishable.mockRejectedValue(new Error('no mapping'));
    await expect(b.builder.build('t', 'p1', 'c')).rejects.toThrow('no mapping');
  });

  it('refuses a margin-blocked price', async () => {
    const { builder, pricing } = setup();
    pricing.build.mockResolvedValue({
      ...ctx,
      price: {
        ...ctx.price,
        rules: [
          {
            id: 'r',
            priority: 1,
            markupPct: '0',
            minMarginPct: '0.9',
            rounding: 'none',
          },
        ],
      },
    });
    await expect(builder.build('t', 'p1', 'c')).rejects.toThrow(/blocked/i);
  });

  it('requires at least one stored image', async () => {
    const { builder, media } = setup();
    media.channelUrls.mockResolvedValue([]);
    await expect(builder.build('t', 'p1', 'c')).rejects.toThrow(/image/i);
  });

  it('falls back for optional golden record fields and omits absent ones', async () => {
    const { builder, mock } = setup();
    mock.product.findFirst.mockResolvedValue({
      id: 'p1',
      sku: 'S',
      ean: null,
      titlePt: null,
      shortDescriptionPt: null,
      descriptionPtHtml: null,
      weightG: null,
      categoryId: 'cat',
      attributes: {},
      compliance: {},
    });
    mock.channelListing.findFirst.mockResolvedValue(null);
    mock.productMedia.findMany.mockResolvedValue([
      { checksum: null, storageKey: 'k1' },
    ]);
    const p = await builder.build('t', 'p1', 'c');
    expect(p).toMatchObject({
      title: 'S',
      descriptionHtml: '',
      weightG: 0,
      attributes: {},
      ean: null,
    });
    expect(p.externalId).toBeUndefined();
    expect(p.seoTitle).toBeUndefined();
    expect(p.imageChecksums).toBeUndefined();
  });

  it('fails when the product or mapping disappeared', async () => {
    const a = setup();
    a.mock.product.findFirst.mockResolvedValue(null);
    await expect(a.builder.build('t', 'p1', 'c')).rejects.toThrow(
      /Product p1 not found/,
    );
    const b = setup();
    b.mock.categoryMapping.findFirst.mockResolvedValue(null);
    await expect(b.builder.build('t', 'p1', 'c')).rejects.toThrow(
      /category mapping/i,
    );
  });
});
