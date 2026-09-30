import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../../metrics/queue-metrics.service';
import { tenantJobSchema } from '../job-data';
import { PimConsumerBase } from '../pim-consumer.base';
import { PimJobs } from '../pim-runtime';

@Processor(QUEUES.ORDER_MAINTENANCE)
export class OrderMaintenanceConsumer extends PimConsumerBase {
  constructor(
    private readonly pimJobs: PimJobs,
    queueMetrics: QueueMetricsService,
    cls: ClsService,
    @InjectQueue(`${QUEUES.ORDER_MAINTENANCE}-dlq`) dlqQueue: Queue,
  ) {
    super(QUEUES.ORDER_MAINTENANCE, queueMetrics, cls, dlqQueue);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.SCAN_SHIP_BY_DEADLINES:
        return this.run(job, tenantJobSchema, (d) =>
          this.pimJobs.scanShipByDeadlines(d.tenantId),
        );
      case JOB_PATTERNS.PURGE_ORDER_PII:
        return this.run(job, tenantJobSchema, (d) =>
          this.pimJobs.purgeOrderPii(d.tenantId),
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
