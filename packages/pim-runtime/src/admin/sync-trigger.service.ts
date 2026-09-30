import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, SyncRunStatus } from '@repo/database';
import { SYNC_KINDS } from '@repo/pim-catalog';
import { CHANNEL_CODES } from '@repo/pim-orders';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import type { Queue } from 'bullmq';
import { addUnique } from '../queue/add-unique';
import type { ChannelJobData, SupplierSyncJobData, TenantJobData } from '../job-payloads';
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
    @InjectQueue(QUEUES.ORDER_IMPORT) private readonly importQueue: Queue,
    @InjectQueue(QUEUES.ORDER_STATUS) private readonly statusQueue: Queue,
    @InjectQueue(QUEUES.LISTING_SYNC) private readonly listingQueue: Queue,
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

  /** Polls the orders of one channel (or all channels of the tenant) now: the same job the 10 minute schedule enqueues. */
  async triggerOrderImport(tenantId: string, channelId?: string) {
    const channelIds = await this.channelIds(tenantId, { ...(channelId && { id: channelId }) }, channelId);
    await this.enqueueChannels(this.importQueue, JOB_PATTERNS.IMPORT_CHANNEL_ORDERS, 'order-import', tenantId, channelIds);
    return { enqueued: true as const, kind: 'order-import' as const, channelIds };
  }

  /** Polls every submitted supplier order (status, tracking) now. */
  async triggerSupplierOrderStatusPoll(tenantId: string) {
    const data: TenantJobData = { tenantId };
    await addUnique(this.statusQueue, JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS, data, `order-status-poll-${tenantId}`);
    return { enqueued: true as const, kind: 'supplier-order-status' as const };
  }

  /** Polls Temu listing reviews (and pending price reviews) now. */
  async triggerListingReviewPoll(tenantId: string, channelId?: string) {
    const channelIds = await this.channelIds(
      tenantId,
      { code: CHANNEL_CODES.TEMU_EU, ...(channelId && { id: channelId }) },
      channelId,
    );
    await this.enqueueChannels(this.listingQueue, JOB_PATTERNS.POLL_LISTING_REVIEW, 'listing-review', tenantId, channelIds);
    return { enqueued: true as const, kind: 'listing-review' as const, channelIds };
  }

  private async channelIds(tenantId: string, filter: Record<string, string>, requested?: string): Promise<string[]> {
    const rows = await this.db.channel.findMany({
      where: { tenantId, deletedAt: null, ...filter },
      select: { id: true },
    });
    if (rows.length === 0) {
      throw new NotFoundException(requested ? `Channel ${requested} not found` : 'No matching channel is configured');
    }
    return rows.map((r) => r.id);
  }

  private async enqueueChannels(queue: Queue, job: string, prefix: string, tenantId: string, channelIds: string[]) {
    for (const channelId of channelIds) {
      const data: ChannelJobData = { tenantId, channelId };
      await addUnique(queue, job, data, `${prefix}-${tenantId}-${channelId}`);
    }
  }
}
