import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

const PRESTASHOP_CODE = 'prestashop9';
const TEMU_CODE = 'temu-eu';

/**
 * Enqueue-only: reads active tenants/suppliers/channels and pushes jobs.
 * All business logic runs in apps/worker. A deterministic jobId (no time
 * component) makes overlapping ticks collapse while a job is still pending.
 */
@Injectable()
export class PimEnqueueService {
  private readonly logger = new Logger(PimEnqueueService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUES.CATALOG_SYNC) private readonly catalogQueue: Queue,
    @InjectQueue(QUEUES.STOCK_SYNC) private readonly stockQueue: Queue,
    @InjectQueue(QUEUES.ORDER_IMPORT) private readonly importQueue: Queue,
    @InjectQueue(QUEUES.ORDER_STATUS) private readonly statusQueue: Queue,
    @InjectQueue(QUEUES.ORDER_MAINTENANCE)
    private readonly maintenanceQueue: Queue,
    @InjectQueue(QUEUES.LISTING_SYNC) private readonly listingQueue: Queue,
  ) {}

  enqueueCatalogFullSync(): Promise<void> {
    return this.forSuppliers(
      this.catalogQueue,
      JOB_PATTERNS.RUN_CATALOG_FULL_SYNC,
    );
  }

  enqueueStockSync(): Promise<void> {
    return this.forSuppliers(this.stockQueue, JOB_PATTERNS.RUN_STOCK_COST_SYNC);
  }

  enqueuePrestashopOrderImport(): Promise<void> {
    return this.forChannels(
      this.importQueue,
      JOB_PATTERNS.IMPORT_CHANNEL_ORDERS,
      PRESTASHOP_CODE,
    );
  }

  enqueueTemuOrderImport(): Promise<void> {
    return this.forChannels(
      this.importQueue,
      JOB_PATTERNS.IMPORT_CHANNEL_ORDERS,
      TEMU_CODE,
    );
  }

  enqueueListingReviewPoll(): Promise<void> {
    return this.forChannels(
      this.listingQueue,
      JOB_PATTERNS.POLL_LISTING_REVIEW,
      TEMU_CODE,
    );
  }

  enqueueSupplierOrderStatusPoll(): Promise<void> {
    return this.forTenants(
      this.statusQueue,
      JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS,
    );
  }

  enqueueShipByDeadlineScan(): Promise<void> {
    return this.forTenants(
      this.maintenanceQueue,
      JOB_PATTERNS.SCAN_SHIP_BY_DEADLINES,
    );
  }

  enqueuePiiPurge(): Promise<void> {
    return this.forTenants(this.maintenanceQueue, JOB_PATTERNS.PURGE_ORDER_PII);
  }

  private async forTenants(queue: Queue, job: string): Promise<void> {
    const tenants = await this.db.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const correlationId = randomUUID();
    await this.addAll(
      queue,
      job,
      tenants.map((t) => ({
        key: t.id,
        data: { tenantId: t.id, correlationId },
      })),
    );
  }

  private async forSuppliers(queue: Queue, job: string): Promise<void> {
    const suppliers = await this.db.supplier.findMany({
      where: {
        code: this.config.get<string>('AW_SUPPLIER_CODE', 'aw'),
        deletedAt: null,
        tenant: { deletedAt: null },
      },
      select: { id: true, tenantId: true },
    });
    const correlationId = randomUUID();
    await this.addAll(
      queue,
      job,
      suppliers.map((s) => ({
        key: `${s.tenantId}-${s.id}`,
        data: { tenantId: s.tenantId, supplierId: s.id, correlationId },
      })),
    );
  }

  private async forChannels(
    queue: Queue,
    job: string,
    code: string,
  ): Promise<void> {
    const channels = await this.db.channel.findMany({
      where: { code, deletedAt: null, tenant: { deletedAt: null } },
      select: { id: true, tenantId: true },
    });
    const correlationId = randomUUID();
    await this.addAll(
      queue,
      job,
      channels.map((c) => ({
        key: `${c.tenantId}-${c.id}`,
        data: { tenantId: c.tenantId, channelId: c.id, correlationId },
      })),
    );
  }

  private async addAll(
    queue: Queue,
    job: string,
    items: { key: string; data: Record<string, string> }[],
  ): Promise<void> {
    const prefix = job.replace(/:/g, '_');
    for (const { key, data } of items) {
      try {
        await queue.add(job, data, { jobId: `${prefix}-${key}` });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue ${job} for ${key}`,
          error as Error,
        );
      }
    }
  }
}
