import type {
  ChannelListingPayload,
  IChannelConnector,
  PlaceDropshipOrderCommand,
  SupplierOrderProgress,
  SupplierOrderResult,
  SupplierOrderStatus,
} from '@repo/connector-contracts';
import type { PriceInput, StockInput } from '@repo/core-domain';
import type { OrderAlertType } from './constants';

/** 32-byte AES key used for PII columns. Implemented by the app (env / KMS). */
export interface EncryptionKeyProvider {
  getKey(tenantId: string): Promise<Buffer>;
}

export interface ChannelRef {
  id: string;
  tenantId: string;
  code: string;
  settings: unknown;
}

/** Builds the connector (credentials decrypted) for a channel row. */
export interface ChannelConnectorResolver {
  resolve(channel: ChannelRef): Promise<IChannelConnector>;
}

/** Supplier side, bound to one supplier account. */
export interface SupplierOrderGateway {
  /** Must forward every saga step to `onProgress` (the AW connector's `onProgress` option). */
  placeDropshipOrder(
    cmd: PlaceDropshipOrderCommand,
    onProgress: (progress: SupplierOrderProgress) => void | Promise<void>,
  ): Promise<SupplierOrderResult>;
  getSupplierOrder(externalOrderId: string): Promise<SupplierOrderStatus>;
  /** AW `DELETE /dropshipping/order/{id}/delete`; only valid while the order is a draft. */
  deleteSupplierDraft(externalOrderId: string): Promise<void>;
}

export interface SupplierGatewayResolver {
  resolve(tenantId: string, supplierId: string): Promise<SupplierOrderGateway>;
}

export interface OrderRoutingJob {
  tenantId: string;
  channelOrderId: string;
}

export interface OrderRoutingEnqueuer {
  enqueueRouting(job: OrderRoutingJob): Promise<void>;
}

export interface OrderAlert {
  tenantId: string;
  channelOrderId?: string;
  type: OrderAlertType;
  message: string;
  /** Sinks should deduplicate on this key. */
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}

export interface OrderAlertPort {
  raise(alert: OrderAlert): Promise<void>;
}

export interface OrderSettings {
  defaultEmail: string;
  defaultPhone: string;
  /** Minimum margin fraction (0.15 = 15%). */
  minMargin: string;
  /** VAT fraction used to derive the net total from the channel gross total. */
  vatRate: string;
  shippingAbsorbed?: string;
}

export interface OrderSettingsProvider {
  get(tenantId: string): Promise<OrderSettings>;
}

/** Builds the channel payload (price, stock, content) of a product; throws when not publishable. */
export interface ListingPayloadBuilder {
  build(tenantId: string, productId: string, channelId: string): Promise<ChannelListingPayload>;
}

export interface ListingSyncInput {
  productId: string;
  stock: StockInput;
  price: PriceInput;
}

export interface ListingSyncInputProvider {
  getInputs(tenantId: string, channelId: string, productIds: string[]): Promise<ListingSyncInput[]>;
}
