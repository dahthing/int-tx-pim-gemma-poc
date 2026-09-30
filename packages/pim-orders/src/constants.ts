export const PIM_ORDERS_TOKENS = {
  ENCRYPTION_KEY_PROVIDER: 'PIM_ORDERS_ENCRYPTION_KEY_PROVIDER',
  CHANNEL_CONNECTOR_RESOLVER: 'PIM_ORDERS_CHANNEL_CONNECTOR_RESOLVER',
  SUPPLIER_GATEWAY_RESOLVER: 'PIM_ORDERS_SUPPLIER_GATEWAY_RESOLVER',
  ORDER_ROUTING_ENQUEUER: 'PIM_ORDERS_ORDER_ROUTING_ENQUEUER',
  ORDER_ALERT_PORT: 'PIM_ORDERS_ORDER_ALERT_PORT',
  ORDER_SETTINGS_PROVIDER: 'PIM_ORDERS_ORDER_SETTINGS_PROVIDER',
  LISTING_PAYLOAD_BUILDER: 'PIM_ORDERS_LISTING_PAYLOAD_BUILDER',
  LISTING_SYNC_INPUT_PROVIDER: 'PIM_ORDERS_LISTING_SYNC_INPUT_PROVIDER',
} as const;

export const CHANNEL_CODES = {
  PRESTASHOP9: 'prestashop9',
  TEMU_EU: 'temu-eu',
} as const;

export const ORDER_ALERT_TYPES = {
  COST_EXCEEDS_MAX: 'cost_exceeds_max',
  QUANTITY_MISMATCH: 'quantity_mismatch',
  SUPPLIER_QUANTITY_FAIL: 'supplier_quantity_fail',
  SUPPLIER_CANCELLED: 'supplier_cancelled',
  TRACKING_MISSING: 'tracking_missing',
  TRACKING_PUSH_FAILED: 'tracking_push_failed',
  SHIP_BY_DEADLINE: 'ship_by_deadline',
  SUPPLIER_DRAFT_DELETE_FAILED: 'supplier_draft_delete_failed',
  CANCELLATION_NEEDS_MANUAL_REVIEW: 'cancellation_needs_manual_review',
  ROUTING_MANUAL_REVIEW: 'routing_manual_review',
  PRICE_BLOCKED: 'price_blocked',
  LISTING_REJECTED: 'listing_rejected',
} as const;
export type OrderAlertType = (typeof ORDER_ALERT_TYPES)[keyof typeof ORDER_ALERT_TYPES];

export const MANUAL_REVIEW_REASONS = {
  UNKNOWN_SKU: 'unknown_sku',
  NO_ASSORTMENT_ITEM: 'no_assortment_item',
  MIXED_SUPPLIERS: 'mixed_suppliers',
  INVALID_COST_INPUT: 'invalid_cost_input',
} as const;

export const PIM_ORDERS_DEFAULTS = {
  /** Used when a channel has never been polled. */
  ORDER_POLL_EPOCH: '1970-01-01T00:00:00.000Z',
  SHIP_BY_ALERT_HOURS: 12,
  PII_RETENTION_DAYS: 90,
  PII_PURGED_MARKER: 'PURGED',
  /** Key inside Channel.settings holding the order poll cursor (ISO timestamp). */
  ORDER_CURSOR_SETTING: 'orderPollCursor',
  /** Key inside Channel.settings holding the Temu carrier table. */
  CARRIER_TABLE_SETTING: 'carrierTable',
  PRISMA_UNIQUE_VIOLATION: 'P2002',
} as const;

export const SUPPLIER_STATES = {
  CANCELLED: 'cancelled',
  DISPATCHED: ['dispatched', 'shipped', 'completed'],
} as const;

/** Keys inside Channel.settings that override the default cancelled / delivered external statuses. */
export const CHANNEL_STATUS_SETTINGS = {
  CANCELLED: 'cancelledStatuses',
  DELIVERED: 'deliveredStatuses',
} as const;

/** Default external statuses (PS order state ids; Temu order statuses, placeholders until S0.8 / S0.10 are answered). */
export const CHANNEL_STATUS_DEFAULTS = {
  PRESTASHOP9: { cancelled: ['6'], delivered: ['5'] },
  TEMU_EU: { cancelled: ['CANCELLED'], delivered: ['DELIVERED'] },
} as const;
