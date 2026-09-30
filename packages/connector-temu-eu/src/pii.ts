import type { ChannelOrderLine, ChannelOrderRaw, RecipientAddress } from '@repo/connector-contracts';
import { decryptSecret, encryptSecret } from '@repo/core-domain';

export interface StoredOrder {
  externalId: string;
  externalStatus: string;
  placedAt: Date;
  currency: string;
  total: string;
  shipByAt: Date | null;
  lines: ChannelOrderLine[];
  /** AES-256-GCM of { customer, shippingAddress }. */
  piiCiphertext: string;
}

export interface OrderPii {
  customer: ChannelOrderRaw['customer'];
  shippingAddress: RecipientAddress;
}

/** Use this before persisting an order: no plaintext PII leaves the connector boundary. */
export function encryptOrderForStorage(o: ChannelOrderRaw, key: Buffer): StoredOrder {
  const pii: OrderPii = { customer: o.customer, shippingAddress: o.shippingAddress };
  return {
    externalId: o.externalId,
    externalStatus: o.externalStatus,
    placedAt: o.placedAt,
    currency: o.currency,
    total: o.total,
    shipByAt: o.shipByAt ?? null,
    lines: o.lines,
    piiCiphertext: encryptSecret(JSON.stringify(pii), key),
  };
}

export function decryptStoredPii(ciphertext: string, key: Buffer): OrderPii {
  return JSON.parse(decryptSecret(ciphertext, key)) as OrderPii;
}
