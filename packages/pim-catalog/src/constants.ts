export const PIM_TOKENS = {
  SOURCE_CONNECTOR: 'PIM_SOURCE_CONNECTOR',
  LISTING_STOCK_ZEROER: 'PIM_LISTING_STOCK_ZEROER',
  CHANNEL_SYNC_ENQUEUER: 'PIM_CHANNEL_SYNC_ENQUEUER',
  ALERT_SERVICE: 'PIM_ALERT_SERVICE',
  OBJECT_STORAGE: 'PIM_OBJECT_STORAGE',
  MEDIA_DOWNLOADER: 'PIM_MEDIA_DOWNLOADER',
  LLM_CLIENT: 'PIM_LLM_CLIENT',
  USAGE_LOGGER: 'PIM_USAGE_LOGGER',
  FORBIDDEN_TERMS: 'PIM_FORBIDDEN_TERMS',
} as const;

export const SYNC_KINDS = {
  CATALOG_FULL: 'aw.catalog.full',
} as const;

export const SYNC_COUNTERS = {
  SEEN: 'seen',
  CREATED: 'created',
  CONTENT_CHANGED: 'content_changed',
  PRICE_CHANGED: 'price_changed',
  STOCK_CHANGED: 'stock_changed',
  MISSING: 'missing',
  ERRORS: 'errors',
  FAILED_PAGE: 'failed_page',
} as const;

export const CHANNEL_CODES = {
  PRESTASHOP9: 'prestashop9',
  TEMU_EU: 'temu-eu',
} as const;

/** FR-STK-001 AC1 defaults. */
export const DEFAULT_STOCK_BUFFER: Readonly<Record<string, number>> = {
  [CHANNEL_CODES.PRESTASHOP9]: 2,
  [CHANNEL_CODES.TEMU_EU]: 5,
};
export const FALLBACK_STOCK_BUFFER = 0;

/** Used when a tenant has no PriceRule. Percentages are fractions. */
export const DEFAULT_PRICING = {
  RULE_ID: 'default',
  MARKUP_PCT: '0.5',
  MIN_MARGIN_PCT: '0.1',
  VAT_RATE: '0.23',
  ROUNDING: 'x.99',
} as const;

export const PRODUCT_ATTRIBUTE_KEYS = {
  SUPPLIER_MISSING: 'supplierMissing',
  ENRICHMENT: 'enrichment',
} as const;

export const CHANNEL_SETTING_KEYS = {
  CATEGORY_ATTRIBUTES: 'categoryAttributes',
} as const;

export const AUDIT_ENTITIES = {
  PRODUCT: 'Product',
} as const;

export const AUDIT_ACTIONS = {
  PRICE_FORCE_OVERRIDE: 'price.force_override',
  ENRICHMENT_APPROVED: 'enrichment.approved',
} as const;

export const ALERT_TYPES = {
  MARGIN_BREAK: 'margin_break',
} as const;

export const LLM_OPERATIONS = {
  ENRICHMENT: 'enrichment',
} as const;

export const MISSING_TYPES = {
  CATEGORY: 'category',
  CATEGORY_MAPPING: 'category_mapping',
  MANDATORY_ATTRIBUTE: 'mandatory_attribute',
} as const;

export const CATEGORY_PATH_SEPARATOR = '>';
export const MEDIA_DEFAULT_EXTENSION = 'bin';
export const DEFAULT_LISTING_STOCK = 0;
