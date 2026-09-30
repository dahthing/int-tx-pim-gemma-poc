import z from 'zod';
import {
  alertListQuerySchema,
  alertPageSchema,
  bulkAddRequestSchema,
  channelSettingsSchema,
  createChannelRequestSchema,
  createPriceRuleRequestSchema,
  createSupplierRequestSchema,
  dashboardSchema,
  decimalStringSchema,
  manualTrackingRequestSchema,
  mapSupplierPathRequestSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderPageSchema,
  priceRuleSchema,
  pricingQuoteRequestSchema,
  productDetailSchema,
  productListQuerySchema,
  productPageSchema,
  settingsResponseSchema,
  supplierProductListQuerySchema,
  supplierProductPageSchema,
  supplierSettingsSchema,
  syncRunListQuerySchema,
  syncRunPageSchema,
  triggerSyncRequestSchema,
  updateChannelRequestSchema,
  updatePriceRuleRequestSchema,
  updateSupplierRequestSchema,
} from '../../index.js';
import * as all from '../../index.js';

const iso = '2026-09-30T10:00:00.000Z';

describe('pim API schemas: requests', () => {
  it('coerces list queries and applies the shared pagination defaults', () => {
    const q = supplierProductListQuerySchema.parse({
      skip: '40',
      take: '10',
      inAssortment: 'false',
      search: '  crystal ',
    });
    expect(q).toMatchObject({
      skip: 40,
      take: 10,
      inAssortment: false,
      search: 'crystal',
      sortBy: 'id',
      sortOrder: 'asc',
    });
    expect(
      supplierProductListQuerySchema.parse({ inAssortment: 'true' })
        .inAssortment,
    ).toBe(true);
    expect(() =>
      supplierProductListQuerySchema.parse({ inAssortment: 'yes' }),
    ).toThrow();
    expect(() =>
      supplierProductListQuerySchema.parse({ take: '101' }),
    ).toThrow();
    expect(
      productListQuerySchema.parse({
        status: 'draft',
        enrichmentStatus: 'ai_draft',
      }).take,
    ).toBe(20);
    expect(() => productListQuerySchema.parse({ status: 'DRAFT' })).toThrow();
    expect(orderListQuerySchema.parse({ status: 'manual_review' }).status).toBe(
      'manual_review',
    );
    expect(syncRunListQuerySchema.parse({ kind: 'aw.catalog.full' }).kind).toBe(
      'aw.catalog.full',
    );
    expect(alertListQuerySchema.parse({}).status).toBe('open');
  });

  it('bounds the bulk add request', () => {
    expect(
      bulkAddRequestSchema.parse({ supplierProductIds: ['a'] })
        .supplierProductIds,
    ).toEqual(['a']);
    expect(() =>
      bulkAddRequestSchema.parse({ supplierProductIds: [] }),
    ).toThrow();
    expect(() =>
      bulkAddRequestSchema.parse({
        supplierProductIds: Array.from({ length: 201 }, (_, i) => `${i}`),
      }),
    ).toThrow();
  });

  it('validates money as decimal strings', () => {
    expect(decimalStringSchema.safeParse('12.50').success).toBe(true);
    expect(decimalStringSchema.safeParse('12,50').success).toBe(false);
    expect(decimalStringSchema.safeParse(12.5).success).toBe(false);
    expect(
      pricingQuoteRequestSchema.parse({
        channelId: 'c',
        override: { gross: '9.99', force: true },
      }).override?.force,
    ).toBe(true);
    expect(() =>
      pricingQuoteRequestSchema.parse({ channelId: 'c', cost: 'abc' }),
    ).toThrow();
  });

  it('requires a supplier path when mapping categories', () => {
    expect(
      mapSupplierPathRequestSchema.parse({
        department: 'Crystals',
        categoryId: 'c',
      }).channels,
    ).toEqual([]);
    expect(() =>
      mapSupplierPathRequestSchema.parse({ categoryId: 'c' }),
    ).toThrow(/At least one/);
  });

  it('validates price rules and requires a change on update', () => {
    const r = createPriceRuleRequestSchema.parse({
      vatRate: '0.23',
      markupPct: '0.5',
    });
    expect(r).toMatchObject({ priority: 0, rounding: 'none', condition: {} });
    expect(() =>
      createPriceRuleRequestSchema.parse({ markupPct: '0.5' }),
    ).toThrow();
    expect(() =>
      createPriceRuleRequestSchema.parse({
        vatRate: '0.23',
        condition: { unknown: 1 },
      }),
    ).toThrow();
    expect(() =>
      createPriceRuleRequestSchema.parse({ vatRate: '0.23', rounding: 'x.95' }),
    ).toThrow();
    expect(updatePriceRuleRequestSchema.parse({ priority: 3 })).toEqual({
      priority: 3,
    });
    expect(() => updatePriceRuleRequestSchema.parse({})).toThrow();
  });

  it('validates manual tracking', () => {
    expect(
      manualTrackingRequestSchema.parse({
        carrierCode: ' DHL ',
        trackingNumber: 'X1',
      }),
    ).toEqual({ carrierCode: 'DHL', trackingNumber: 'X1' });
    expect(() =>
      manualTrackingRequestSchema.parse({
        carrierCode: 'DHL',
        trackingNumber: '',
      }),
    ).toThrow();
  });

  it('validates sync triggers', () => {
    expect(triggerSyncRequestSchema.parse({})).toEqual({});
    expect(triggerSyncRequestSchema.parse({ supplierId: 's' })).toEqual({
      supplierId: 's',
    });
  });
});

describe('pim API schemas: settings credentials are write-only', () => {
  it('accepts credentials on the way in', () => {
    expect(
      createSupplierRequestSchema.parse({
        code: 'aw-aiku',
        name: 'AW',
        credentials: { token: 't' },
      }).environment,
    ).toBe('staging');
    expect(() =>
      createSupplierRequestSchema.parse({
        code: 'aw',
        name: 'AW',
        credentials: {},
      }),
    ).toThrow();
    expect(
      updateSupplierRequestSchema.parse({ credentials: { token: 'n' } })
        .credentials?.token,
    ).toBe('n');
    expect(() => updateSupplierRequestSchema.parse({})).toThrow();
    expect(
      createChannelRequestSchema.parse({
        code: 'temu-eu',
        credentials: { appKey: 'a', appSecret: 'b', accessToken: 'c' },
      }).settings,
    ).toEqual({});
    expect(
      createChannelRequestSchema.parse({
        code: 'prestashop9',
        credentials: { webservice: { key: 'k' } },
      }).code,
    ).toBe('prestashop9');
    expect(() =>
      createChannelRequestSchema.parse({
        code: 'prestashop9',
        credentials: {},
      }),
    ).toThrow();
    expect(() =>
      createChannelRequestSchema.parse({
        code: 'shopify',
        credentials: { webservice: { key: 'k' } },
      }),
    ).toThrow();
    expect(updateChannelRequestSchema.parse({ name: 'x' })).toEqual({
      name: 'x',
    });
  });

  it('strips any credential field from supplier and channel responses', () => {
    const supplier = supplierSettingsSchema.parse({
      id: 's',
      code: 'aw-aiku',
      name: 'AW',
      environment: 'staging',
      baseUrl: null,
      credentialsConfigured: true,
      updatedAt: iso,
      credentialsEnc: 'cipher',
      credentials: { token: 'secret' },
      token: 'secret',
    });
    expect(JSON.stringify(supplier)).not.toMatch(
      /secret|cipher|credentialsEnc|"token"/,
    );
    const channel = channelSettingsSchema.parse({
      id: 'c',
      code: 'temu-eu',
      name: null,
      settings: { gatewayHost: 'x' },
      credentialsConfigured: false,
      updatedAt: iso,
      credentialsEnc: 'cipher',
      appSecret: 'secret',
    });
    expect(JSON.stringify(channel)).not.toMatch(/secret|cipher/);
    const settings = settingsResponseSchema.parse({
      suppliers: [{ ...supplier, credentialsEnc: 'cipher' }],
      channels: [{ ...channel, credentials: { appSecret: 'secret' } }],
      tenantDefaults: {
        defaultEmail: null,
        defaultPhone: null,
        minMargin: '0.15',
        vatRate: '0.23',
      },
    });
    expect(JSON.stringify(settings)).not.toMatch(/secret|cipher/);
  });
});

describe('pim API schemas: responses', () => {
  const page = { meta: { page: 1, pageSize: 20, totalPages: 0, total: 0 } };

  it('parses empty pages for every list', () => {
    for (const s of [
      supplierProductPageSchema,
      productPageSchema,
      orderPageSchema,
      syncRunPageSchema,
      alertPageSchema,
    ]) {
      expect(s.parse({ items: [], ...page }).items).toEqual([]);
    }
  });

  it('parses a product detail and drops unknown fields', () => {
    const d = productDetailSchema.parse({
      id: 'p',
      sku: 'S',
      ean: null,
      titlePt: 'T',
      shortDescriptionPt: null,
      descriptionPtHtml: null,
      brand: null,
      weightG: 10,
      status: 'draft',
      enrichmentStatus: 'none',
      categoryId: null,
      attributes: {},
      compliance: {},
      enrichment: null,
      supplier: null,
      media: [],
      listings: [],
      createdAt: iso,
      updatedAt: iso,
      deletedAt: iso,
    });
    expect(d).not.toHaveProperty('deletedAt');
  });

  it('parses an order detail without any PII fields', () => {
    const d = orderDetailSchema.parse({
      id: 'o',
      channelId: 'c',
      channelCode: 'temu-eu',
      externalId: 'E1',
      externalStatus: null,
      placedAt: iso,
      status: 'imported',
      totalGross: '10.00',
      currency: 'EUR',
      lineCount: 1,
      shipByAt: null,
      manualReviewReason: null,
      supplierOrder: null,
      hasTracking: false,
      totalNet: null,
      totalShipping: null,
      lines: [{ sku: 'S', quantity: 1, unitPrice: null }],
      shipments: [],
      createdAt: iso,
      updatedAt: iso,
      customer: { name: 'Maria' },
      shippingAddress: { line1: 'x' },
    });
    expect(JSON.stringify(d)).not.toMatch(
      /Maria|line1|customer|shippingAddress/,
    );
  });

  it('parses the dashboard', () => {
    const d = dashboardSchema.parse({
      lastSyncRuns: [
        {
          id: 'r',
          kind: 'aw.catalog.full',
          connector: 'aw-aiku',
          status: 'succeeded',
          startedAt: iso,
          finishedAt: iso,
          counters: { seen: 3 },
          errorSummary: null,
        },
      ],
      counts: {
        failedSyncRuns24h: 0,
        openAlerts: 1,
        failedOrders: 0,
        manualReviewOrders: 0,
        missingSupplierProducts: 2,
        productsByStatus: { draft: 1 },
        ordersByStatus: {},
      },
      alerts: [
        {
          id: 'a',
          type: 'margin_break',
          message: 'm',
          dedupeKey: 'k',
          status: 'open',
          raisedAt: iso,
          productId: null,
          channelId: null,
          channelOrderId: null,
        },
      ],
    });
    expect(d.counts.openAlerts).toBe(1);
  });

  it('parses a price rule response', () => {
    expect(
      priceRuleSchema.parse({
        id: 'r',
        channelId: null,
        priority: 1,
        condition: { channel: 'temu-eu' },
        markupPct: '0.5',
        fixedAdd: null,
        rounding: 'x.99',
        minMarginPct: null,
        vatRate: '0.23',
        createdAt: iso,
        updatedAt: iso,
      }).rounding,
    ).toBe('x.99');
  });
});

describe('pim API schemas: OpenAPI metadata', () => {
  it('gives every named schema a unique id and is convertible to JSON Schema', () => {
    const ids = new Set<string>();
    for (const [name, value] of Object.entries(all)) {
      if (!name.endsWith('Schema') || !(value instanceof z.ZodType)) continue;
      const meta = z.globalRegistry.get(value) as { id?: string } | undefined;
      if (meta?.id) {
        expect(ids.has(meta.id)).toBe(false);
        ids.add(meta.id);
      }
      expect(() =>
        z.toJSONSchema(value, { unrepresentable: 'any', io: 'input' }),
      ).not.toThrow();
    }
    expect(ids.size).toBeGreaterThan(40);
    expect(ids).toEqual(expect.objectContaining({}));
    for (const id of [
      'SupplierProduct',
      'ProductDetail',
      'OrderDetail',
      'PriceRule',
      'SettingsResponse',
      'Dashboard',
      'TriggerSyncResponse',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
