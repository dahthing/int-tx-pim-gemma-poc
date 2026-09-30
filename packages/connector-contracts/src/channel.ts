import type { ConnectorCapabilities } from './capabilities';
import type { BatchResult, ConnectionTestResult, Page, PageCursor } from './common';
import type { RecipientAddress } from './source';

export interface ChannelListingPayload {
  sku: string;
  ean?: string | null;
  title: string;
  shortDescription?: string;
  descriptionHtml: string;
  weightG: number;
  /** Net price, decimal string. */
  priceNet: string;
  vatRate: string;
  stock: number;
  categoryId: string;
  attributes: Record<string, string>;
  imageUrls: string[];
  seoTitle?: string;
  seoDescription?: string;
  compliance?: Record<string, unknown>;
  active: boolean;
  /** Set by the PIM when enrichment is approved; channels may refuse to submit otherwise. */
  enrichmentApproved?: boolean;
  /** Existing channel id when already linked. */
  externalId?: string;
  /** Checksums of the images (same order as imageUrls); falls back to the URLs. Optional. */
  imageChecksums?: string[];
  /** Hash returned by the previous upsert; unchanged payloads are skipped. Optional. */
  lastPayloadHash?: string;
  /** Image checksums returned by the previous upsert. Optional. */
  lastImageChecksums?: string[];
}

export interface ChannelListingResult {
  externalId: string;
  externalVariantId?: string;
  status: 'live' | 'submitted' | 'rejected' | 'inactive';
  skipped?: boolean;
  reason?: string;
  /** Hash of the payload just sent, to persist as last_payload_hash. Optional. */
  payloadHash?: string;
  /** Image checksums now on the channel, to persist. Optional. */
  imageChecksums?: string[];
}

export interface StockUpdate {
  externalId: string;
  externalVariantId?: string;
  available: number;
}

export interface PriceUpdate {
  externalId: string;
  externalVariantId?: string;
  priceNet: string;
}

export interface ChannelOrderLine {
  sku: string;
  externalLineId?: string;
  quantity: number;
  unitPrice?: string;
}

export interface ChannelOrderRaw {
  externalId: string;
  externalStatus: string;
  placedAt: Date;
  currency: string;
  total: string;
  shipByAt?: Date | null;
  customer: { name: string; email?: string | null; phone?: string | null };
  shippingAddress: RecipientAddress;
  lines: ChannelOrderLine[];
  /** Set by the connector when the order must not be forwarded automatically. Optional. */
  manualReview?: { reason: 'unknown_sku'; unknownSkus: string[] };
}

export interface PushShipmentCommand {
  externalOrderId: string;
  carrierCode: string;
  carrierName?: string;
  trackingNumber: string;
}

export interface ChannelCategory {
  id: string;
  parentId: string | null;
  name: string;
  leaf: boolean;
}

export interface ChannelAttributeSpec {
  id: string;
  name: string;
  mandatory: boolean;
  allowedValues?: string[];
}

export interface IChannelConnector {
  readonly code: string;
  capabilities(): ConnectorCapabilities;
  testConnection(): Promise<ConnectionTestResult>;
  upsertListing(listing: ChannelListingPayload): Promise<ChannelListingResult>;
  updateStock(items: StockUpdate[]): Promise<BatchResult>;
  updatePrice(items: PriceUpdate[]): Promise<BatchResult>;
  deactivateListing(externalId: string): Promise<void>;
  listOrdersSince(since: Date, cursor?: PageCursor): Promise<Page<ChannelOrderRaw>>;
  pushShipment(cmd: PushShipmentCommand): Promise<void>;
  getCategoryTree?(): Promise<ChannelCategory[]>;
  getCategoryAttributes?(categoryId: string): Promise<ChannelAttributeSpec[]>;
}
