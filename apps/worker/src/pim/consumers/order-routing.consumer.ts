import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../../metrics/queue-metrics.service';
import { channelOrderJobSchema } from '../job-data';
import { PimConsumerBase } from '../pim-consumer.base';
import { PimJobs } from '../pim-runtime';

@Processor(QUEUES.ORDER_ROUTING)
export class OrderRoutingConsumer extends PimConsumerBase {
  constructor(
    private readonly pimJobs: PimJobs,
    queueMetrics: QueueMetricsService,
    cls: ClsService,
    @InjectQueue(`${QUEUES.ORDER_ROUTING}-dlq`) dlqQueue: Queue,
  ) {
    super(QUEUES.ORDER_ROUTING, queueMetrics, cls, dlqQueue);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.ROUTE_SUPPLIER_ORDER:
        return this.run(job, channelOrderJobSchema, (d) =>
          this.pimJobs.routeSupplierOrder(d.tenantId, d.channelOrderId),
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
