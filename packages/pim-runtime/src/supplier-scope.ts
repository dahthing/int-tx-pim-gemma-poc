import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface SupplierScopeValue {
  tenantId: string;
  supplierId?: string;
}

/**
 * The pim-catalog services receive a single `ISourceConnector`, which has no tenant/supplier
 * parameter. The runtime binds the connector to the supplier of the current call through this
 * async-local scope. Anything that calls a pim-catalog service that touches the supplier
 * (ingestion, stock sync, curation, media import) must run inside `run()`.
 */
@Injectable()
export class SupplierScope {
  private readonly storage = new AsyncLocalStorage<SupplierScopeValue>();

  run<T>(
    tenantId: string,
    supplierId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.storage.run({ tenantId, supplierId }, fn);
  }

  /** Tenant known, supplier not chosen (e.g. it is resolved from the product). */
  runForTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.storage.run({ tenantId }, fn);
  }

  current(): { tenantId: string; supplierId: string } {
    const v = this.storage.getStore();
    if (!v?.supplierId)
      throw new Error(
        'No supplier scope: wrap the call in SupplierScope.run(tenantId, supplierId, fn)',
      );
    return { tenantId: v.tenantId, supplierId: v.supplierId };
  }

  currentTenant(): string {
    const v = this.storage.getStore();
    if (!v) throw new Error('No supplier scope active');
    return v.tenantId;
  }
}
