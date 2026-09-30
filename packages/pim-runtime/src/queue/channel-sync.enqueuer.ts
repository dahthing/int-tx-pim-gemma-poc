import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import type { ChannelSyncEnqueuer } from '@repo/pim-catalog';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import type { Queue } from 'bullmq';
import type { SyncListingsJobData } from '../job-payloads';
import { addUnique } from './add-unique';

/** FR-ING-002 AC2: only channels that list a changed product get a sync job. */
@Injectable()
export class BullChannelSyncEnqueuer implements ChannelSyncEnqueuer {
  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(QUEUES.LISTING_SYNC) private readonly queue: Queue,
  ) {}

  async enqueueProductUpdates(
    tenantId: string,
    productIds: string[],
  ): Promise<void> {
    if (productIds.length === 0) return;
    const rows = await this.db.channelListing.findMany({
      where: { tenantId, productId: { in: productIds }, deletedAt: null },
      distinct: ['channelId'],
      select: { channelId: true },
    });
    for (const { channelId } of rows) {
      const data: SyncListingsJobData = { tenantId, channelId, productIds };
      // One pending sync per channel is enough: the sync recomputes every changed listing.
      await addUnique(
        this.queue,
        JOB_PATTERNS.SYNC_LISTING_STOCK_PRICE,
        data,
        `sync-${tenantId}-${channelId}`,
      );
    }
  }
}
