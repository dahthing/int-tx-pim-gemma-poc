/** Wire-format fixtures (ISO timestamps, decimal strings, lowercase statuses) shared by the PIM specs. */
const NOW = '2026-09-30T10:00:00.000Z';

export function page<T>(items: T[], total = items.length, pageNumber = 1, pageSize = 20) {
  return {
    items,
    meta: { page: pageNumber, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), total },
  };
}

export function supplierProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sp1',
    supplierId: 'sup1',
    externalId: 'AW-1',
    code: 'C1',
    ean: '5601234567890',
    name: 'Amethyst cluster',
    department: 'Crystals',
    subDepartment: 'Clusters',
    family: 'Amethyst',
    costPrice: '12.50',
    currency: 'EUR',
    stock: 7,
    imageMainUrl: null,
    status: 'active',
    inAssortment: false,
    productId: null,
    lastSeenAt: NOW,
    ...overrides,
  };
}

export function listing(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch1',
    channelCode: 'prestashop9',
    status: 'live',
    externalId: '99',
    lastPrice: '24.99',
    lastStock: 5,
    lastError: null,
    lastSyncedAt: NOW,
    ...overrides,
  };
}

export function productListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    sku: 'SKU-1',
    ean: null,
    titlePt: 'Aglomerado de ametista',
    status: 'ready',
    enrichmentStatus: 'approved',
    categoryId: null,
    listings: [listing(), listing({ channelId: 'ch2', channelCode: 'temu-eu', status: 'pending' })],
    updatedAt: NOW,
    ...overrides,
  };
}

export function productDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    sku: 'SKU-1',
    ean: null,
    titlePt: 'Aglomerado de ametista',
    shortDescriptionPt: 'Curto',
    descriptionPtHtml: '<p>Longo</p>',
    brand: null,
    weightG: 300,
    status: 'draft',
    enrichmentStatus: 'none',
    categoryId: null,
    attributes: {},
    compliance: {},
    enrichment: null,
    supplier: null,
    media: [],
    listings: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function enrichment(overrides: Record<string, unknown> = {}) {
  return {
    bulletPoints: ['Ponto um'],
    seoTitle: 'SEO',
    seoDescription: 'SEO desc',
    suggestedAttributes: {},
    ...overrides,
  };
}

export function quote(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch1',
    channelCode: 'prestashop9',
    status: 'ok',
    net: '20.32',
    gross: '24.99',
    marginPct: '0.35',
    ruleId: 'r1',
    forced: false,
    reason: null,
    available: 5,
    error: null,
    ...overrides,
  };
}

export function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    channelId: 'ch1',
    channelCode: 'prestashop9',
    externalId: 'PS-1001',
    externalStatus: null,
    placedAt: NOW,
    status: 'supplier_submitted',
    totalGross: '49.98',
    currency: 'EUR',
    lineCount: 2,
    shipByAt: null,
    manualReviewReason: null,
    supplierOrder: null,
    hasTracking: false,
    ...overrides,
  };
}

export function orderDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...order(),
    totalNet: '40.63',
    totalShipping: '0.00',
    lines: [{ sku: 'SKU-1', quantity: 2, unitPrice: '24.99' }],
    shipments: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function priceRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    channelId: null,
    priority: 10,
    condition: {},
    markupPct: '0.5',
    fixedAdd: null,
    rounding: 'x.99',
    minMarginPct: '0.1',
    vatRate: '0.23',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    kind: 'catalog',
    connector: 'aw',
    status: 'succeeded',
    startedAt: NOW,
    finishedAt: NOW,
    counters: { upserted: 10 },
    errorSummary: null,
    ...overrides,
  };
}

export function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    type: 'margin_blocked',
    message: 'Margin below minimum',
    dedupeKey: 'k1',
    status: 'open',
    raisedAt: NOW,
    productId: null,
    channelId: null,
    channelOrderId: null,
    ...overrides,
  };
}

export function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    lastSyncRuns: [syncRun()],
    counts: {
      failedSyncRuns24h: 1,
      openAlerts: 1,
      failedOrders: 2,
      manualReviewOrders: 0,
      missingSupplierProducts: 3,
      productsByStatus: { draft: 4 },
      ordersByStatus: { imported: 1 },
    },
    alerts: [alert()],
    ...overrides,
  };
}

export function supplierSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sup1',
    code: 'aw',
    name: 'AW Supplier',
    environment: 'staging',
    baseUrl: null,
    credentialsConfigured: true,
    updatedAt: NOW,
    ...overrides,
  };
}

export function channelSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch1',
    code: 'prestashop9',
    name: 'Gemma shop',
    settings: { language: 'pt' },
    credentialsConfigured: false,
    updatedAt: NOW,
    ...overrides,
  };
}

export function settings(overrides: Record<string, unknown> = {}) {
  return {
    suppliers: [supplierSettings()],
    channels: [channelSettings(), channelSettings({ id: 'ch2', code: 'temu-eu', name: 'Temu', settings: {} })],
    tenantDefaults: { defaultEmail: 'a@b.pt', defaultPhone: null, minMargin: '0.1', vatRate: '0.23' },
    ...overrides,
  };
}
