/** Configuration keys read through ConfigService (never process.env outside main.ts). */
export const RUNTIME_CONFIG = {
  /** base64 of 32 bytes: AES-256-GCM key for credentials and PII. */
  ENCRYPTION_KEY: 'PIM_ENCRYPTION_KEY',
  S3_ENDPOINT: 'PIM_S3_ENDPOINT',
  S3_REGION: 'PIM_S3_REGION',
  S3_BUCKET: 'PIM_S3_BUCKET',
  S3_ACCESS_KEY: 'PIM_S3_ACCESS_KEY',
  S3_SECRET_KEY: 'PIM_S3_SECRET_KEY',
  /** Optional CDN / public base URL; defaults to `<endpoint>/<bucket>`. */
  S3_PUBLIC_BASE_URL: 'PIM_S3_PUBLIC_BASE_URL',
  LLM_API_KEY: 'ANTHROPIC_API_KEY',
  LLM_MODEL: 'PIM_LLM_MODEL',
  LLM_BASE_URL: 'PIM_LLM_BASE_URL',
  LLM_MAX_TOKENS: 'PIM_LLM_MAX_TOKENS',
  ORDER_DEFAULT_EMAIL: 'PIM_ORDER_DEFAULT_EMAIL',
  ORDER_DEFAULT_PHONE: 'PIM_ORDER_DEFAULT_PHONE',
  ORDER_MIN_MARGIN: 'PIM_ORDER_MIN_MARGIN',
  ORDER_VAT_RATE: 'PIM_ORDER_VAT_RATE',
  ORDER_SHIPPING_ABSORBED: 'PIM_ORDER_SHIPPING_ABSORBED',
} as const;

export const RUNTIME_DEFAULTS = {
  S3_REGION: 'us-east-1',
  LLM_BASE_URL: 'https://api.anthropic.com',
  LLM_MAX_TOKENS: 2048,
  ANTHROPIC_VERSION: '2023-06-01',
  ORDER_MIN_MARGIN: '0.15',
  REQUEST_LOG_RETENTION_DAYS: 30,
  ORDER_VAT_RATE: '0.23',
  MEDIA_TIMEOUT_MS: 30_000,
  MEDIA_MAX_BYTES: 15 * 1024 * 1024,
  LLM_TIMEOUT_MS: 60_000,
} as const;

export const RUNTIME_AUDIT = {
  ENTITY_ALERT: 'Alert',
  ENTITY_LLM_USAGE: 'LlmUsage',
  ENTITY_SETTINGS: 'Settings',
  ACTION_ALERT_RAISED: 'alert.raised',
  ACTION_ALERT_ACKNOWLEDGED: 'alert.acknowledged',
  ACTION_LLM_USAGE: 'llm.usage',
  ACTION_CREDENTIALS_UPDATED: 'credentials.updated',
  SYSTEM_ACTOR: 'system',
} as const;

/** Connector codes used as `RequestLogSink` connector label are the connector's own `code`. */
export const SUPPLIER_CODES = { AW_AIKU: 'aw-aiku' } as const;

/** AW dropshipping draft deletion (FR-ORD-001 AC2). */
export const AW_DELETE_ORDER_PATH = (id: string): string =>
  `/dropshipping/order/${encodeURIComponent(id)}/delete`;

export const RUNTIME_TOKENS = {
  SOURCE_CONNECTOR_FACTORY: 'PIM_RUNTIME_SOURCE_CONNECTOR_FACTORY',
} as const;
