import { createMockDb } from '../testing/mock-db';
import { CatalogQueryService } from './catalog-query.service';

const storage = {
  publicUrl: jest.fn((k: string) => `https://cdn/${k}`),
  put: jest.fn(),
};
const d = new Date('2026-01-02T03:04:05Z');

function setup() {
  const { db, mock } = createMockDb();
  return { mock, svc: new CatalogQueryService(db, storage) };
}
const query = { skip: 0, take: 20, sortBy: 'id', sortOrder: 'asc' as const };

describe('CatalogQueryService: supplier catalogue', () => {
  it('lists with filters, a whitelisted sort and mapped rows', async () => {
    const { svc, mock } = setup();
    mock.supplierProduct.findMany.mockResolvedValue([
      {
        id: 'sp1',
        supplierId: 's',
        externalId: 'e',
        code: 'C',
        ean: null,
        name: 'Ametista',
        department: 'D',
        subDepartment: null,
        family: null,
        costPrice: { toString: () => '3.5' },
        currency: 'EUR',
        stock: 4,
        imageMainUrl: null,
        status: 'ACTIVE',
        lastSeenAt: d,
        assortmentItems: [{ id: 'a' }],
        products: [{ id: 'p1' }],
      },
      {
        id: 'sp2',
        supplierId: 's',
        externalId: 'e2',
        code: null,
        ean: null,
        name: 'X',
        department: null,
        subDepartment: null,
        family: null,
        costPrice: null,
        currency: 'EUR',
        stock: 0,
        imageMainUrl: null,
        status: 'MISSING',
        lastSeenAt: d,
        assortmentItems: [],
        products: [],
      },
    ]);
    mock.supplierProduct.count.mockResolvedValue(2);
    const r = await svc.listSupplierProducts('t', {
      ...query,
      sortBy: 'name',
      supplierId: 's',
      department: 'D',
      subDepartment: 'SD',
      family: 'F',
      status: 'active',
      inAssortment: true,
      search: 'ame',
    });
    const args = mock.supplierProduct.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ name: 'asc' });
    expect(args.where).toMatchObject({
      tenantId: 't',
      deletedAt: null,
      supplierId: 's',
      department: 'D',
      subDepartment: 'SD',
      family: 'F',
      status: 'ACTIVE',
      assortmentItems: { some: { status: 'ACTIVE' } },
    });
    expect(args.where.OR).toHaveLength(3);
    expect(r.total).toBe(2);
    expect(r.items[0]).toMatchObject({
      id: 'sp1',
      costPrice: '3.5',
      status: 'active',
      inAssortment: true,
      productId: 'p1',
      lastSeenAt: d.toISOString(),
    });
    expect(r.items[1]).toMatchObject({
      costPrice: null,
      status: 'missing',
      inAssortment: false,
      productId: null,
    });
  });

  it('filters products not yet in the assortment and falls back to id sorting', async () => {
    const { svc, mock } = setup();
    mock.supplierProduct.findMany.mockResolvedValue([]);
    mock.supplierProduct.count.mockResolvedValue(0);
    await svc.listSupplierProducts('t', {
      ...query,
      sortBy: 'hack',
      inAssortment: false,
    });
    const args = mock.supplierProduct.findMany.mock.calls[0][0];
    expect(args.where.assortmentItems).toEqual({ none: { status: 'ACTIVE' } });
    expect(args.orderBy).toEqual({ id: 'asc' });
  });

  it('builds cascading facets', async () => {
    const { svc, mock } = setup();
    mock.supplierProduct.findMany.mockImplementation(
      async (a: { select: Record<string, boolean> }) => {
        const field = Object.keys(a.select)[0] as string;
        return [{ [field]: `${field}-1` }, { [field]: null }];
      },
    );
    const f = await svc.supplierFacets('t', {
      supplierId: 's',
      department: 'D',
      subDepartment: 'SD',
    });
    expect(f).toEqual({
      departments: ['department-1'],
      subDepartments: ['subDepartment-1'],
      families: ['family-1'],
    });
    const familyCall = mock.supplierProduct.findMany.mock.calls.find(
      (c: [{ select: object }]) => 'family' in c[0].select,
    )[0];
    expect(familyCall.where).toMatchObject({
      supplierId: 's',
      department: 'D',
      subDepartment: 'SD',
    });
  });

  it('builds facets without filters', async () => {
    const { svc, mock } = setup();
    mock.supplierProduct.findMany.mockResolvedValue([]);
    expect(await svc.supplierFacets('t', {})).toEqual({
      departments: [],
      subDepartments: [],
      families: [],
    });
  });
});

const listing = {
  channelId: 'c',
  channel: { code: 'temu-eu' },
  status: 'LIVE',
  externalId: 'x',
  lastPrice: { toString: () => '9.99' },
  lastStock: 3,
  lastError: null,
  lastSyncedAt: d,
};

describe('CatalogQueryService: products', () => {
  it('lists products with filters and listing summaries', async () => {
    const { svc, mock } = setup();
    mock.product.findMany.mockResolvedValue([
      {
        id: 'p',
        sku: 'S',
        ean: null,
        titlePt: 'T',
        status: 'PUBLISHED',
        enrichmentStatus: 'APPROVED',
        categoryId: null,
        updatedAt: d,
        listings: [listing],
      },
    ]);
    mock.product.count.mockResolvedValue(1);
    const r = await svc.listProducts('t', {
      ...query,
      sortBy: 'sku',
      status: 'published',
      enrichmentStatus: 'approved',
      channelId: 'c',
      search: 'S',
    });
    const args = mock.product.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      tenantId: 't',
      deletedAt: null,
      status: 'PUBLISHED',
      enrichmentStatus: 'APPROVED',
      listings: { some: { channelId: 'c', deletedAt: null } },
    });
    expect(args.orderBy).toEqual({ sku: 'asc' });
    expect(r.items[0]!.listings[0]).toEqual({
      channelId: 'c',
      channelCode: 'temu-eu',
      status: 'live',
      externalId: 'x',
      lastPrice: '9.99',
      lastStock: 3,
      lastError: null,
      lastSyncedAt: d.toISOString(),
    });
    expect(r.items[0]).toMatchObject({
      status: 'published',
      enrichmentStatus: 'approved',
    });
  });

  it('lists without optional filters', async () => {
    const { svc, mock } = setup();
    mock.product.findMany.mockResolvedValue([]);
    mock.product.count.mockResolvedValue(0);
    await svc.listProducts('t', query);
    expect(mock.product.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't',
      deletedAt: null,
    });
  });

  const full = {
    id: 'p',
    sku: 'S',
    ean: '1',
    titlePt: 'T',
    shortDescriptionPt: 's',
    descriptionPtHtml: '<p>d</p>',
    brand: 'B',
    weightG: 5,
    status: 'DRAFT',
    enrichmentStatus: 'AI_DRAFT',
    categoryId: 'c',
    attributes: {
      colour: 'azul',
      enrichment: {
        bulletPoints: ['a'],
        seoTitle: 't',
        seoDescription: 'd',
        suggestedAttributes: { k: 'v' },
      },
    },
    compliance: { manufacturer: 'M' },
    supplierProduct: {
      id: 'sp',
      name: 'N',
      department: 'D',
      subDepartment: null,
      family: null,
      costPrice: { toString: () => '2' },
      stock: 9,
      status: 'ACTIVE',
    },
    media: [
      {
        id: 'm1',
        sourceUrl: 'https://aw/1.jpg',
        storageKey: 'k1',
        mime: 'image/jpeg',
        position: 0,
        checksum: 'c1',
      },
      {
        id: 'm2',
        sourceUrl: 'https://aw/2.jpg',
        storageKey: null,
        mime: null,
        position: 1,
        checksum: null,
      },
    ],
    listings: [listing],
    createdAt: d,
    updatedAt: d,
  };

  it('returns the golden record detail with our storage URLs, never the supplier hotlink as url', async () => {
    const { svc, mock } = setup();
    mock.product.findFirst.mockResolvedValue(full);
    const r = await svc.productDetail('t', 'p');
    expect(r.media).toEqual([
      {
        id: 'm1',
        sourceUrl: 'https://aw/1.jpg',
        url: 'https://cdn/k1',
        mime: 'image/jpeg',
        position: 0,
        checksum: 'c1',
      },
      {
        id: 'm2',
        sourceUrl: 'https://aw/2.jpg',
        url: null,
        mime: null,
        position: 1,
        checksum: null,
      },
    ]);
    expect(r.enrichment).toEqual({
      bulletPoints: ['a'],
      seoTitle: 't',
      seoDescription: 'd',
      suggestedAttributes: { k: 'v' },
    });
    expect(r.supplier).toMatchObject({
      supplierProductId: 'sp',
      costPrice: '2',
      status: 'active',
    });
    expect(r.status).toBe('draft');
  });

  it('handles products without supplier, enrichment or attributes', async () => {
    const { svc, mock } = setup();
    mock.product.findFirst.mockResolvedValue({
      ...full,
      supplierProduct: null,
      attributes: null,
      compliance: null,
      media: [],
      listings: [],
    });
    const r = await svc.productDetail('t', 'p');
    expect(r).toMatchObject({
      supplier: null,
      enrichment: null,
      attributes: {},
      compliance: {},
    });
    mock.product.findFirst.mockResolvedValue({
      ...full,
      attributes: { enrichment: {} },
    });
    expect((await svc.productDetail('t', 'p')).enrichment).toEqual({
      bulletPoints: [],
      seoTitle: null,
      seoDescription: null,
      suggestedAttributes: {},
    });
  });

  it('404s an unknown product', async () => {
    const { svc } = setup();
    await expect(svc.productDetail('t', 'nope')).rejects.toThrow(/not found/);
  });
});

describe('CatalogQueryService: categories and mapping', () => {
  it('lists categories', async () => {
    const { svc, mock } = setup();
    mock.category.findMany.mockResolvedValue([
      { id: 'c', name: 'Cristais', slug: 'cristais', parentId: null, extra: 1 },
    ]);
    expect(await svc.listCategories('t')).toEqual([
      { id: 'c', name: 'Cristais', slug: 'cristais', parentId: null },
    ]);
  });

  it('creates a category with an accent-free slug', async () => {
    const { svc, mock } = setup();
    mock.category.findFirst
      .mockResolvedValueOnce({ id: 'parent' })
      .mockResolvedValueOnce(null);
    mock.category.create.mockResolvedValue({
      id: 'n',
      name: 'Incenso Natural',
      slug: 'incenso-natural',
      parentId: 'parent',
    });
    const r = await svc.createCategory('t', {
      name: 'Incenso Natural',
      parentId: 'parent',
    });
    expect(mock.category.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't',
        name: 'Incenso Natural',
        normalizedName: 'incenso natural',
        slug: 'incenso-natural',
        parentId: 'parent',
      },
    });
    expect(r.slug).toBe('incenso-natural');
  });

  it('rejects duplicate root slugs, unknown parents and empty slugs', async () => {
    const { svc, mock } = setup();
    mock.category.findFirst.mockResolvedValue({ id: 'x' });
    await expect(svc.createCategory('t', { name: 'Cristais' })).rejects.toThrow(
      /already exists/,
    );
    mock.category.findFirst.mockResolvedValue(null);
    await expect(
      svc.createCategory('t', { name: 'Cristais', parentId: 'nope' }),
    ).rejects.toThrow(/Parent category/);
    await expect(svc.createCategory('t', { name: '!!!' })).rejects.toThrow(
      /letters or digits/,
    );
  });

  it('creates a root category', async () => {
    const { svc, mock } = setup();
    mock.category.findFirst.mockResolvedValue(null);
    mock.category.create.mockResolvedValue({
      id: 'n',
      name: 'A',
      slug: 'a',
      parentId: null,
    });
    await svc.createCategory('t', { name: 'A' });
    expect(mock.category.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't', parentId: null, slug: 'a', deletedAt: null },
    });
  });

  it('joins supplier paths with their current mappings', async () => {
    const { svc, mock } = setup();
    mock.supplierProduct.groupBy.mockResolvedValue([
      {
        department: 'Cristais',
        subDepartment: 'Ametista',
        family: null,
        _count: { _all: 7 },
      },
      {
        department: 'Incenso',
        subDepartment: null,
        family: null,
        _count: { _all: 2 },
      },
    ]);
    mock.categoryMapping.findMany.mockResolvedValue([
      {
        normalizedKey: 'cristais>ametista>',
        categoryId: 'cat1',
        channelId: null,
        channelCategoryId: null,
      },
      {
        normalizedKey: 'cristais>ametista>',
        categoryId: 'cat1',
        channelId: 'ch1',
        channelCategoryId: '77',
      },
    ]);
    expect(await svc.supplierPathMappings('t')).toEqual([
      {
        department: 'Cristais',
        subDepartment: 'Ametista',
        family: null,
        productCount: 7,
        categoryId: 'cat1',
        channels: [{ channelId: 'ch1', channelCategoryId: '77' }],
      },
      {
        department: 'Incenso',
        subDepartment: null,
        family: null,
        productCount: 2,
        categoryId: null,
        channels: [],
      },
    ]);
  });

  it('validates mapping targets', async () => {
    const { svc, mock } = setup();
    mock.category.findFirst.mockResolvedValue({ id: 'c' });
    mock.channel.findMany.mockResolvedValue([{ id: 'ch1' }]);
    const ok = await svc.prepareMapping('t', {
      department: 'D',
      categoryId: 'c',
      channels: [{ channelId: 'ch1', channelCategoryId: '1' }],
    });
    expect(ok).toEqual({
      department: 'D',
      subDepartment: null,
      family: null,
      categoryId: 'c',
      channels: [{ channelId: 'ch1', channelCategoryId: '1' }],
    });
    mock.channel.findMany.mockResolvedValue([]);
    await expect(
      svc.prepareMapping('t', {
        department: 'D',
        categoryId: 'c',
        channels: [{ channelId: 'ch9', channelCategoryId: '1' }],
      }),
    ).rejects.toThrow(/Channel ch9/);
    mock.category.findFirst.mockResolvedValue(null);
    await expect(
      svc.prepareMapping('t', {
        department: 'D',
        categoryId: 'c',
        channels: [],
      }),
    ).rejects.toThrow(/Category c/);
  });

  it('skips the channel lookup when there are no channel targets', async () => {
    const { svc, mock } = setup();
    mock.category.findFirst.mockResolvedValue({ id: 'c' });
    await svc.prepareMapping('t', {
      family: 'F',
      categoryId: 'c',
      channels: [],
    });
    expect(mock.channel.findMany).not.toHaveBeenCalled();
  });
});
