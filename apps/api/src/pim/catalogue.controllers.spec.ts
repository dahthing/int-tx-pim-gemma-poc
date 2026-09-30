import type { INestApplication } from '@nestjs/common';
import { CategoryMappingService, EnrichmentService } from '@repo/pim-catalog';
import {
  CatalogOpsService,
  CatalogQueryService,
  ChannelAdminService,
} from '@repo/pim-runtime';
import request from 'supertest';
import { CategoriesController } from './categories.controller';
import { ProductsController } from './products.controller';
import { SupplierProductsController } from './supplier-products.controller';
import { createTestApp, TENANT_ID } from './testing';

const iso = '2026-09-30T10:00:00.000Z';
const listing = {
  channelId: 'c1',
  channelCode: 'temu-eu',
  status: 'live',
  externalId: 'x',
  lastPrice: '9.99',
  lastStock: 3,
  lastError: null,
  lastSyncedAt: iso,
};

describe('catalogue controllers (HTTP)', () => {
  let app: INestApplication;
  const catalog = {
    listSupplierProducts: jest.fn(),
    supplierFacets: jest.fn(),
    listProducts: jest.fn(),
    productDetail: jest.fn(),
    listCategories: jest.fn(),
    createCategory: jest.fn(),
    supplierPathMappings: jest.fn(),
    prepareMapping: jest.fn(),
  };
  const ops = {
    addToGemma: jest.fn(),
    removeFromGemma: jest.fn(),
    importMedia: jest.fn(),
    quote: jest.fn(),
    quoteAll: jest.fn(),
  };
  const channels = {
    publish: jest.fn(),
    unpublish: jest.fn(),
    categoryTree: jest.fn(),
    loadAttributes: jest.fn(),
  };
  const enrichment = { generate: jest.fn(), approve: jest.fn() };
  const mapping = {
    validatePublishReadiness: jest.fn(),
    mapSupplierPath: jest.fn(),
  };

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [
        SupplierProductsController,
        ProductsController,
        CategoriesController,
      ],
      providers: [
        { provide: CatalogQueryService, useValue: catalog },
        { provide: CatalogOpsService, useValue: ops },
        { provide: ChannelAdminService, useValue: channels },
        { provide: EnrichmentService, useValue: enrichment },
        { provide: CategoryMappingService, useValue: mapping },
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /supplier-products', () => {
    const row = {
      id: 'sp1',
      supplierId: 's',
      externalId: 'e',
      code: 'C1',
      ean: null,
      name: 'Ametista',
      department: 'Cristais',
      subDepartment: null,
      family: null,
      costPrice: '3.5',
      currency: 'EUR',
      stock: 4,
      imageMainUrl: null,
      status: 'active',
      inAssortment: false,
      productId: null,
      lastSeenAt: iso,
    };

    it('validates and coerces the query, paginates and strips unknown fields', async () => {
      catalog.listSupplierProducts.mockResolvedValue({
        items: [{ ...row, rawPayload: { secret: 1 } }],
        total: 45,
      });
      const res = await request(app.getHttpServer())
        .get(
          '/supplier-products?skip=20&take=10&department=Cristais&inAssortment=false&search=ame',
        )
        .expect(200);
      expect(catalog.listSupplierProducts).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          skip: 20,
          take: 10,
          department: 'Cristais',
          inAssortment: false,
          search: 'ame',
          sortBy: 'id',
          sortOrder: 'asc',
        }),
      );
      expect(res.body.meta).toEqual({
        total: 45,
        totalPages: 5,
        page: 3,
        pageSize: 10,
      });
      expect(res.body.items[0]).toEqual(row);
    });

    it('rejects invalid queries', async () => {
      await request(app.getHttpServer())
        .get('/supplier-products?take=1000')
        .expect(400);
      await request(app.getHttpServer())
        .get('/supplier-products?inAssortment=maybe')
        .expect(400);
      expect(catalog.listSupplierProducts).not.toHaveBeenCalled();
    });
  });

  it('GET /supplier-products/facets', async () => {
    catalog.supplierFacets.mockResolvedValue({
      departments: ['A'],
      subDepartments: [],
      families: [],
    });
    const res = await request(app.getHttpServer())
      .get('/supplier-products/facets?department=A')
      .expect(200);
    expect(res.body).toEqual({
      departments: ['A'],
      subDepartments: [],
      families: [],
    });
    expect(catalog.supplierFacets).toHaveBeenCalledWith(TENANT_ID, {
      department: 'A',
    });
  });

  describe('POST /supplier-products/bulk-add', () => {
    it('adds to Gemma and returns per-item results', async () => {
      ops.addToGemma.mockResolvedValue([
        { supplierProductId: 'a', ok: true, productId: 'p1' },
        { supplierProductId: 'b', ok: false, error: 'nope' },
      ]);
      const res = await request(app.getHttpServer())
        .post('/supplier-products/bulk-add')
        .send({ supplierProductIds: ['a', 'b'], supplierId: 's1' })
        .expect(200);
      expect(ops.addToGemma).toHaveBeenCalledWith(TENANT_ID, ['a', 'b'], 's1');
      expect(res.body.results).toHaveLength(2);
    });

    it('rejects an empty selection', async () => {
      await request(app.getHttpServer())
        .post('/supplier-products/bulk-add')
        .send({ supplierProductIds: [] })
        .expect(400);
      expect(ops.addToGemma).not.toHaveBeenCalled();
    });
  });

  describe('products', () => {
    const item = {
      id: 'p1',
      sku: 'S',
      ean: null,
      titlePt: 'T',
      status: 'draft',
      enrichmentStatus: 'none',
      categoryId: null,
      listings: [listing],
      updatedAt: iso,
    };

    it('GET /products lists with filters', async () => {
      catalog.listProducts.mockResolvedValue({ items: [item], total: 1 });
      const res = await request(app.getHttpServer())
        .get('/products?status=draft&enrichmentStatus=none&channelId=c1')
        .expect(200);
      expect(catalog.listProducts).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          status: 'draft',
          enrichmentStatus: 'none',
          channelId: 'c1',
        }),
      );
      expect(res.body.items[0]).toEqual(item);
      await request(app.getHttpServer())
        .get('/products?status=DRAFT')
        .expect(400);
    });

    it('GET /products/:id returns the detail', async () => {
      const detail = {
        ...item,
        shortDescriptionPt: null,
        descriptionPtHtml: null,
        brand: null,
        weightG: 5,
        attributes: {},
        compliance: {},
        enrichment: null,
        supplier: null,
        media: [],
        createdAt: iso,
      };
      catalog.productDetail.mockResolvedValue(detail);
      const res = await request(app.getHttpServer())
        .get('/products/p1')
        .expect(200);
      expect(catalog.productDetail).toHaveBeenCalledWith(TENANT_ID, 'p1');
      expect(res.body.id).toBe('p1');
    });

    it('DELETE /products/:id removes from Gemma', async () => {
      ops.removeFromGemma.mockResolvedValue(undefined);
      await request(app.getHttpServer()).delete('/products/p1').expect(204);
      expect(ops.removeFromGemma).toHaveBeenCalledWith(TENANT_ID, 'p1');
    });

    it('POST /products/:id/media/import', async () => {
      ops.importMedia.mockResolvedValue({ imported: 2, skipped: 1, failed: 0 });
      const res = await request(app.getHttpServer())
        .post('/products/p1/media/import')
        .expect(200);
      expect(res.body).toEqual({ imported: 2, skipped: 1, failed: 0 });
    });

    it('generates an enrichment draft and reports validation errors without saving', async () => {
      enrichment.generate
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, errors: ['Title too long'] });
      expect(
        (
          await request(app.getHttpServer())
            .post('/products/p1/enrichment/generate')
            .expect(200)
        ).body,
      ).toEqual({ ok: true });
      const bad = await request(app.getHttpServer())
        .post('/products/p1/enrichment/generate')
        .expect(200);
      expect(bad.body).toEqual({ ok: false, errors: ['Title too long'] });
      expect(enrichment.generate).toHaveBeenCalledWith(TENANT_ID, 'p1');
    });

    it('approves the enrichment as the authenticated user', async () => {
      enrichment.approve.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .post('/products/p1/enrichment/approve')
        .expect(200);
      expect(enrichment.approve).toHaveBeenCalledWith(
        TENANT_ID,
        'p1',
        'admin@gemma.pt',
      );
      expect(res.body).toEqual({ enrichmentStatus: 'approved' });
    });

    const quote = {
      channelId: 'c1',
      channelCode: 'temu-eu',
      status: 'ok',
      net: '10',
      gross: '12.3',
      marginPct: '0.2',
      ruleId: 'default',
      forced: false,
      reason: null,
      available: 4,
      error: null,
    };

    it('GET /products/:id/pricing returns one quote per channel', async () => {
      ops.quoteAll.mockResolvedValue([quote]);
      const res = await request(app.getHttpServer())
        .get('/products/p1/pricing')
        .expect(200);
      expect(res.body.quotes).toEqual([quote]);
      expect(ops.quoteAll).toHaveBeenCalledWith(TENANT_ID, 'p1');
    });

    it('POST /products/:id/pricing/quote supports what-if cost and price override', async () => {
      ops.quote.mockResolvedValue(quote);
      await request(app.getHttpServer())
        .post('/products/p1/pricing/quote')
        .send({
          channelId: 'c1',
          cost: '5.00',
          override: { gross: '9.99', force: true },
        })
        .expect(200);
      expect(ops.quote).toHaveBeenCalledWith(TENANT_ID, {
        productId: 'p1',
        channelId: 'c1',
        cost: '5.00',
        override: { gross: '9.99', force: true },
      });
      await request(app.getHttpServer())
        .post('/products/p1/pricing/quote')
        .send({ channelId: 'c1', cost: '5,00' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/products/p1/pricing/quote')
        .send({})
        .expect(400);
    });

    it('GET readiness lists what is missing', async () => {
      mapping.validatePublishReadiness.mockResolvedValue({
        ready: false,
        missing: [{ type: 'category_mapping', name: 'temu-eu' }],
      });
      const res = await request(app.getHttpServer())
        .get('/products/p1/channels/c1/readiness')
        .expect(200);
      expect(res.body.missing).toEqual([
        { type: 'category_mapping', name: 'temu-eu' },
      ]);
      expect(mapping.validatePublishReadiness).toHaveBeenCalledWith(
        TENANT_ID,
        'p1',
        'c1',
      );
    });

    it('publishes and unpublishes a listing', async () => {
      channels.publish.mockResolvedValue({
        status: 'submitted',
        externalId: 'x',
        skipped: false,
      });
      channels.unpublish.mockResolvedValue({ status: 'inactive' });
      expect(
        (
          await request(app.getHttpServer())
            .post('/products/p1/channels/c1/publish')
            .expect(200)
        ).body,
      ).toEqual({ status: 'submitted', externalId: 'x', skipped: false });
      expect(
        (
          await request(app.getHttpServer())
            .post('/products/p1/channels/c1/unpublish')
            .expect(200)
        ).body,
      ).toEqual({ status: 'inactive' });
      expect(channels.publish).toHaveBeenCalledWith(TENANT_ID, 'p1', 'c1');
      expect(channels.unpublish).toHaveBeenCalledWith(TENANT_ID, 'p1', 'c1');
    });
  });

  describe('category mapping', () => {
    it('lists and creates internal categories', async () => {
      catalog.listCategories.mockResolvedValue([
        { id: 'c', name: 'Cristais', slug: 'cristais', parentId: null },
      ]);
      expect(
        (await request(app.getHttpServer()).get('/categories').expect(200)).body
          .items,
      ).toHaveLength(1);
      catalog.createCategory.mockResolvedValue({
        id: 'n',
        name: 'Novo',
        slug: 'novo',
        parentId: null,
      });
      await request(app.getHttpServer())
        .post('/categories')
        .send({ name: 'Novo' })
        .expect(201);
      expect(catalog.createCategory).toHaveBeenCalledWith(TENANT_ID, {
        name: 'Novo',
      });
      await request(app.getHttpServer())
        .post('/categories')
        .send({ name: '' })
        .expect(400);
    });

    it('GET /category-mappings/supplier-paths', async () => {
      catalog.supplierPathMappings.mockResolvedValue([
        {
          department: 'D',
          subDepartment: null,
          family: null,
          productCount: 3,
          categoryId: null,
          channels: [],
        },
      ]);
      const res = await request(app.getHttpServer())
        .get('/category-mappings/supplier-paths')
        .expect(200);
      expect(res.body.items[0].productCount).toBe(3);
    });

    it('PUT /category-mappings validates the targets then stores the mapping', async () => {
      const prepared = {
        department: 'D',
        subDepartment: null,
        family: null,
        categoryId: 'c',
        channels: [{ channelId: 'c1', channelCategoryId: '77' }],
      };
      catalog.prepareMapping.mockResolvedValue(prepared);
      mapping.mapSupplierPath.mockResolvedValue(undefined);
      await request(app.getHttpServer())
        .put('/category-mappings')
        .send({
          department: 'D',
          categoryId: 'c',
          channels: [{ channelId: 'c1', channelCategoryId: '77' }],
        })
        .expect(204);
      expect(catalog.prepareMapping).toHaveBeenCalledWith(TENANT_ID, {
        department: 'D',
        categoryId: 'c',
        channels: [{ channelId: 'c1', channelCategoryId: '77' }],
      });
      expect(mapping.mapSupplierPath).toHaveBeenCalledWith(TENANT_ID, prepared);
      await request(app.getHttpServer())
        .put('/category-mappings')
        .send({ categoryId: 'c' })
        .expect(400);
    });

    it('exposes the channel category tree and loads mandatory attributes', async () => {
      channels.categoryTree.mockResolvedValue([
        { id: '1', parentId: null, name: 'A', leaf: true },
      ]);
      channels.loadAttributes.mockResolvedValue({
        items: [{ id: 'a', name: 'Colour', mandatory: true }],
        mandatory: ['Colour'],
      });
      expect(
        (
          await request(app.getHttpServer())
            .get('/channels/c1/categories')
            .expect(200)
        ).body.items[0].leaf,
      ).toBe(true);
      const res = await request(app.getHttpServer())
        .post('/channels/c1/categories/77/attributes')
        .expect(200);
      expect(res.body.mandatory).toEqual(['Colour']);
      expect(channels.loadAttributes).toHaveBeenCalledWith(
        TENANT_ID,
        'c1',
        '77',
      );
    });
  });
});
