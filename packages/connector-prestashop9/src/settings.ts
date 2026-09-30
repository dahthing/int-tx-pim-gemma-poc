import type { Resource, TransportKind } from './endpoints';

export interface PrestaShop9Settings {
  /** Shop root URL, e.g. https://shop.example.com */
  baseUrl: string;
  /** Admin API (OAuth2 client credentials). */
  adminApi?: { clientId: string; clientSecret: string; scopes?: string[]; tokenUrl?: string; basePath?: string };
  /** Legacy Webservice key. */
  webservice?: { key: string; basePath?: string };
  /** Overrides of the resource -> transport routing table (spike S0.10). */
  routing?: Partial<Record<Resource, TransportKind>>;
  taxRulesGroupId: number;
  languageId: number;
  /** Order states imported as "paid". */
  paidStateIds: number[];
  shippedStateId: number;
  /** Currency stamped on imported orders. Default EUR. */
  currency?: string;
}
