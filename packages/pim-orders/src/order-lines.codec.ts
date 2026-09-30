import type { ChannelOrderLine } from '@repo/connector-contracts';

/**
 * ChannelOrder has no ship-by / delivered / purge columns, so those live in the `lines` JSON envelope.
 * Schema gap: promote them to real columns when the schema is next migrated.
 */
export interface OrderLinesEnvelope {
  items: ChannelOrderLine[];
  shipByAt: string | null;
  shipByAlertedAt: string | null;
  deliveredAt: string | null;
  piiPurgedAt: string | null;
  manualReviewReason: string | null;
}

export interface DecodedOrderLines {
  items: ChannelOrderLine[];
  shipByAt: Date | null;
  shipByAlertedAt: Date | null;
  deliveredAt: Date | null;
  piiPurgedAt: Date | null;
  manualReviewReason: string | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const date = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);

export function encodeOrderLines(i: {
  items: ChannelOrderLine[];
  shipByAt: Date | null;
  manualReviewReason?: string | null;
}): OrderLinesEnvelope {
  return {
    items: i.items,
    shipByAt: iso(i.shipByAt),
    shipByAlertedAt: null,
    deliveredAt: null,
    piiPurgedAt: null,
    manualReviewReason: i.manualReviewReason ?? null,
  };
}

export function decodeOrderLines(raw: unknown): DecodedOrderLines {
  if (Array.isArray(raw)) {
    return { items: raw as ChannelOrderLine[], shipByAt: null, shipByAlertedAt: null, deliveredAt: null, piiPurgedAt: null, manualReviewReason: null };
  }
  const e = (raw ?? {}) as Partial<OrderLinesEnvelope>;
  return {
    items: e.items ?? [],
    shipByAt: date(e.shipByAt),
    shipByAlertedAt: date(e.shipByAlertedAt),
    deliveredAt: date(e.deliveredAt),
    piiPurgedAt: date(e.piiPurgedAt),
    manualReviewReason: e.manualReviewReason ?? null,
  };
}

export function updateOrderMeta(
  raw: unknown,
  patch: Partial<Pick<DecodedOrderLines, 'shipByAlertedAt' | 'deliveredAt' | 'piiPurgedAt'>>,
): OrderLinesEnvelope {
  const d = decodeOrderLines(raw);
  const next = { ...d, ...patch };
  return {
    items: next.items,
    shipByAt: iso(next.shipByAt),
    shipByAlertedAt: iso(next.shipByAlertedAt),
    deliveredAt: iso(next.deliveredAt),
    piiPurgedAt: iso(next.piiPurgedAt),
    manualReviewReason: next.manualReviewReason,
  };
}
