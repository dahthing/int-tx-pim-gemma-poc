import type { ConnectorCapabilities } from './capabilities';
import type { ConnectionTestResult, Page, PageCursor } from './common';

export interface SupplierProductRaw {
  externalId: string;
  code: string;
  slug?: string;
  ean?: string | null;
  name: string;
  description?: string | null;
  descriptionExtra?: string | null;
  departmentName?: string | null;
  subDepartmentName?: string | null;
  familyName?: string | null;
  /** Decimal string, never a float. */
  costPrice: string;
  currency: string;
  stock: number;
  grossWeightG?: number | null;
  imageMainUrl?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface SupplierAssortmentItemRaw {
  externalPortfolioId: string;
  itemId?: string;
  code: string;
  quantityLeft?: number;
  weight?: number | null;
  price?: string;
  sellingPrice?: string | null;
  status: 'active' | 'disabled';
}

export interface AssortmentOverrides {
  sellingPrice?: string;
}

export interface SupplierMediaRaw {
  uuid: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface RecipientAddress {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface DropshipOrderLine {
  externalPortfolioId: string;
  quantity: number;
}

export interface PlaceDropshipOrderCommand {
  /** e.g. 'PS9' | 'TEMU' */
  channelCode: string;
  channelOrderId: string;
  recipient: RecipientAddress;
  lines: DropshipOrderLine[];
  /** Abort before submit when the supplier total exceeds this. Decimal string. */
  maxSupplierCost: string;
  tenantDefaults: { email: string; phone: string };
  /** Resume state, persisted by the caller after each saga step. */
  resume?: SupplierOrderProgress;
}

export interface SupplierOrderProgress {
  clientId?: string;
  orderId?: string;
  linesStored?: string[];
  noted?: boolean;
  validated?: boolean;
  submitted?: boolean;
}

export interface SupplierOrderResult {
  state: 'creating' | 'submitted' | 'failed';
  progress: SupplierOrderProgress;
  externalOrderId?: string;
  totalAmount?: string;
  alert?: 'cost_exceeds_max' | 'quantity_mismatch';
  /** Redacted last error when state is 'failed'. */
  error?: string;
}

export interface SupplierOrderLineStatus {
  transactionId: string;
  quantityOrdered: number;
  quantityDispatched: number;
  quantityFail: number;
  quantityCancelled: number;
}

export interface SupplierTracking {
  carrierName?: string;
  trackingNumber: string;
}

export interface SupplierOrderStatus {
  externalId: string;
  state: string;
  totalAmount?: string;
  lines: SupplierOrderLineStatus[];
  tracking: SupplierTracking | null;
  alert: boolean;
}

export interface ISourceConnector {
  readonly code: string;
  capabilities(): ConnectorCapabilities;
  testConnection(): Promise<ConnectionTestResult>;
  listCatalog(cursor?: PageCursor): Promise<Page<SupplierProductRaw>>;
  listAssortment(cursor?: PageCursor): Promise<Page<SupplierAssortmentItemRaw>>;
  addToAssortment(supplierProductId: string, overrides?: AssortmentOverrides): Promise<SupplierAssortmentItemRaw>;
  removeFromAssortment(assortmentId: string): Promise<void>;
  listMedia(ref: { kind: 'product' | 'assortment'; id: string }): Promise<SupplierMediaRaw[]>;
  placeDropshipOrder(cmd: PlaceDropshipOrderCommand): Promise<SupplierOrderResult>;
  getSupplierOrder(externalId: string): Promise<SupplierOrderStatus>;
}
