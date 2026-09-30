import { Injectable } from '@nestjs/common';
import type {
  AssortmentOverrides,
  ConnectionTestResult,
  ConnectorCapabilities,
  ISourceConnector,
  Page,
  PageCursor,
  PlaceDropshipOrderCommand,
  SupplierAssortmentItemRaw,
  SupplierMediaRaw,
  SupplierOrderResult,
  SupplierOrderStatus,
  SupplierProductRaw,
} from '@repo/connector-contracts';
import { SupplierScope } from '../supplier-scope';
import { SUPPLIER_CODES } from '../runtime.constants';
import { ConnectorFactory } from './connector-factory';

/**
 * `PIM_TOKENS.SOURCE_CONNECTOR`: an ISourceConnector that resolves the real (per supplier, credentials decrypted)
 * connector from the current `SupplierScope`. Calls outside a scope fail fast instead of guessing a supplier.
 */
@Injectable()
export class SourceConnectorProxy implements ISourceConnector {
  readonly code = SUPPLIER_CODES.AW_AIKU;

  constructor(
    private readonly factory: ConnectorFactory,
    private readonly scope: SupplierScope,
  ) {}

  capabilities(): ConnectorCapabilities {
    return {
      catalogRead: true,
      assortmentWrite: true,
      stockRead: true,
      costRead: true,
      mediaRead: true,
      dropshipOrderWrite: true,
      trackingRead: false,
    };
  }

  private async target(): Promise<ISourceConnector> {
    const { tenantId, supplierId } = this.scope.current();
    return this.factory.source(tenantId, supplierId);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return (await this.target()).testConnection();
  }

  async listCatalog(cursor?: PageCursor): Promise<Page<SupplierProductRaw>> {
    return (await this.target()).listCatalog(cursor);
  }

  async listAssortment(
    cursor?: PageCursor,
  ): Promise<Page<SupplierAssortmentItemRaw>> {
    return (await this.target()).listAssortment(cursor);
  }

  async addToAssortment(
    supplierProductId: string,
    overrides?: AssortmentOverrides,
  ): Promise<SupplierAssortmentItemRaw> {
    return (await this.target()).addToAssortment(supplierProductId, overrides);
  }

  async removeFromAssortment(assortmentId: string): Promise<void> {
    return (await this.target()).removeFromAssortment(assortmentId);
  }

  async listMedia(ref: {
    kind: 'product' | 'assortment';
    id: string;
  }): Promise<SupplierMediaRaw[]> {
    return (await this.target()).listMedia(ref);
  }

  async placeDropshipOrder(
    cmd: PlaceDropshipOrderCommand,
  ): Promise<SupplierOrderResult> {
    return (await this.target()).placeDropshipOrder(cmd);
  }

  async getSupplierOrder(externalId: string): Promise<SupplierOrderStatus> {
    return (await this.target()).getSupplierOrder(externalId);
  }
}
