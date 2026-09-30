import { InjectQueue, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { QueueMetricsService } from '../../metrics/queue-metrics.service';
import { shipmentJobSchema, tenantJobSchema } from '../job-data';
import { PimConsumerBase } from '../pim-consumer.base';
import { PimJobs } from '../pim-runtime';

@Processor(QUEUES.ORDER_STATUS)
export class OrderStatusConsumer extends PimConsumerBase {
  constructor(
    private readonly pimJobs: PimJobs,
    queueMetrics: QueueMetricsService,
    cls: ClsService,
    @InjectQueue(`${QUEUES.ORDER_STATUS}-dlq`) dlqQueue: Queue,
  ) {
    super(QUEUES.ORDER_STATUS, queueMetrics, cls, dlqQueue);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.POLL_SUPPLIER_ORDER_STATUS:
        return this.run(job, tenantJobSchema, (d) =>
          this.pimJobs.pollSupplierOrders(d.tenantId),
        );
      case JOB_PATTERNS.PUSH_SHIPMENT:
        return this.run(job, shipmentJobSchema, (d) =>
          this.pimJobs.pushShipment(d.tenantId, d.shipmentId),
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
