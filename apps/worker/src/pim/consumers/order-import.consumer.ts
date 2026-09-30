import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../../metrics/queue-metrics.service';
import { channelJobSchema } from '../job-data';
import { PimConsumerBase } from '../pim-consumer.base';
import { PimJobs } from '../pim-runtime';

@Processor(QUEUES.ORDER_IMPORT)
export class OrderImportConsumer extends PimConsumerBase {
  constructor(
    private readonly pimJobs: PimJobs,
    queueMetrics: QueueMetricsService,
    cls: ClsService,
    @InjectQueue(`${QUEUES.ORDER_IMPORT}-dlq`) dlqQueue: Queue,
  ) {
    super(QUEUES.ORDER_IMPORT, queueMetrics, cls, dlqQueue);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.IMPORT_CHANNEL_ORDERS:
        return this.run(job, channelJobSchema, (d) =>
          this.pimJobs.importChannelOrders(d.tenantId, d.channelId),
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
