import { Injectable } from '@nestjs/common';
import { AW_BASE_URLS } from '@repo/connector-aw-aiku';
import type {
  PlaceDropshipOrderCommand,
  SupplierOrderProgress,
  SupplierOrderResult,
  SupplierOrderStatus,
} from '@repo/connector-contracts';
import {
  HttpStatusError,
  redactText,
  ResilientHttpClient,
  type FetchLike,
} from '@repo/http-client';
import type {
  SupplierGatewayResolver,
  SupplierOrderGateway,
} from '@repo/pim-orders';
import { AW_DELETE_ORDER_PATH } from '../runtime.constants';
import { ConnectorFactory } from './connector-factory';

/** Binds the AW connector to one supplier account for the order saga (progress callback per call). */
@Injectable()
export class SupplierGatewayResolverImpl implements SupplierGatewayResolver {
  constructor(
    private readonly factory: ConnectorFactory,
    private readonly fetchImpl?: FetchLike,
  ) {}

  async resolve(
    tenantId: string,
    supplierId: string,
  ): Promise<SupplierOrderGateway> {
    return {
      placeDropshipOrder: async (
        cmd: PlaceDropshipOrderCommand,
        onProgress: (p: SupplierOrderProgress) => void | Promise<void>,
      ): Promise<SupplierOrderResult> => {
        const connector = await this.factory.sourceWithProgress(
          tenantId,
          supplierId,
          onProgress,
        );
        return connector.placeDropshipOrder(cmd);
      },
      getSupplierOrder: async (
        externalOrderId: string,
      ): Promise<SupplierOrderStatus> => {
        const connector = await this.factory.source(tenantId, supplierId);
        return connector.getSupplierOrder(externalOrderId);
      },
      deleteSupplierDraft: (externalOrderId: string) =>
        this.deleteDraft(tenantId, supplierId, externalOrderId),
    };
  }

  /** AW `DELETE /dropshipping/order/{id}/delete` (FR-ORD-001 AC2). */
  private async deleteDraft(
    tenantId: string,
    supplierId: string,
    externalOrderId: string,
  ): Promise<void> {
    const access = await this.factory.supplierAccess(tenantId, supplierId);
    const http = new ResilientHttpClient({
      connector: 'aw-aiku',
      baseUrl: AW_BASE_URLS[access.environment],
      fetchImpl: this.fetchImpl,
      sink: this.factory.sink(tenantId),
      requestsPerSecond: 2,
      maxAttempts: 3,
    });
    try {
      await http.request('DELETE', AW_DELETE_ORDER_PATH(externalOrderId), {
        headers: {
          authorization: `Bearer ${access.token}`,
          accept: 'application/json',
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        const scrub = (t: string): string =>
          redactText(t.split(access.token).join('[REDACTED]'));
        err.message = scrub(err.message);
        if (err instanceof HttpStatusError)
          (err as { bodySnippet: string }).bodySnippet = scrub(err.bodySnippet);
      }
      throw err;
    }
  }
}
