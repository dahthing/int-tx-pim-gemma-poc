import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService, SyncRunStatus } from '@repo/database';
import { SYNC_KINDS } from '@repo/pim-catalog';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import type { Queue } from 'bullmq';
import { addUnique } from '../queue/add-unique';
import type { SupplierSyncJobData } from '../job-payloads';
import { CatalogOpsService } from './catalog-ops.service';

/** A RUNNING catalogue sync older than this is considered dead and does not block a new one. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** Manual sync triggers (FR-ING-001 "on demand"): enqueue the same jobs the schedulers enqueue. */
@Injectable()
export class SyncTriggerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ops: CatalogOpsService,
    @InjectQueue(QUEUES.CATALOG_SYNC) private readonly catalogQueue: Queue,
    @InjectQueue(QUEUES.STOCK_SYNC) private readonly stockQueue: Queue,
  ) {}

  async triggerCatalogSync(
    tenantId: string,
    supplierId?: string,
    now: Date = new Date(),
  ) {
    const sid = await this.ops.resolveSupplierId(tenantId, supplierId);
    const running = await this.db.syncRun.findFirst({
      where: {
        tenantId,
        kind: SYNC_KINDS.CATALOG_FULL,
        status: SyncRunStatus.RUNNING,
        startedAt: { gte: new Date(now.getTime() - STALE_RUN_MS) },
      },
      select: { id: true },
    });
    if (running)
      throw new ConflictException('A catalogue sync is already running');
    const data: SupplierSyncJobData = { tenantId, supplierId: sid };
    await addUnique(
      this.catalogQueue,
      JOB_PATTERNS.RUN_CATALOG_FULL_SYNC,
      data,
      `catalog-sync-${tenantId}-${sid}`,
    );
    return {
      enqueued: true as const,
      kind: 'catalog' as const,
      supplierId: sid,
    };
  }

  async triggerStockCostSync(tenantId: string, supplierId?: string) {
    const sid = await this.ops.resolveSupplierId(tenantId, supplierId);
    const data: SupplierSyncJobData = { tenantId, supplierId: sid };
    await addUnique(
      this.stockQueue,
      JOB_PATTERNS.RUN_STOCK_COST_SYNC,
      data,
      `stock-sync-${tenantId}-${sid}`,
    );
    return {
      enqueued: true as const,
      kind: 'stock-cost' as const,
      supplierId: sid,
    };
  }
}
