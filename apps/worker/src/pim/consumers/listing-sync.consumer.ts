import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../../metrics/queue-metrics.service';
import {
  channelJobSchema,
  publishListingJobSchema,
  syncListingsJobSchema,
} from '../job-data';
import { PimConsumerBase } from '../pim-consumer.base';
import { PimJobs } from '../pim-runtime';

@Processor(QUEUES.LISTING_SYNC)
export class ListingSyncConsumer extends PimConsumerBase {
  constructor(
    private readonly pimJobs: PimJobs,
    queueMetrics: QueueMetricsService,
    cls: ClsService,
    @InjectQueue(`${QUEUES.LISTING_SYNC}-dlq`) dlqQueue: Queue,
  ) {
    super(QUEUES.LISTING_SYNC, queueMetrics, cls, dlqQueue);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.PUBLISH_LISTING:
        return this.run(job, publishListingJobSchema, (d) =>
          this.pimJobs.publishListing(d.tenantId, d.productId, d.channelId),
        );
      case JOB_PATTERNS.SYNC_LISTING_STOCK_PRICE:
        return this.run(job, syncListingsJobSchema, (d) =>
          this.pimJobs.syncListings(d.tenantId, d.channelId, d.productIds),
        );
      case JOB_PATTERNS.POLL_LISTING_REVIEW:
        return this.run(job, channelJobSchema, (d) =>
          this.pimJobs.pollListingReviews(d.tenantId, d.channelId),
        );
      default:
        this.unknown(job);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.onJobCompleted(job);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.onJobFailed(job, error);
  }
}
