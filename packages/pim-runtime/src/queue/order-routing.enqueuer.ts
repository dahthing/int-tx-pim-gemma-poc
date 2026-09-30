import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import type { OrderRoutingEnqueuer, OrderRoutingJob } from '@repo/pim-orders';
import type { Queue } from 'bullmq';
import type { RouteSupplierOrderJobData } from '../job-payloads';
import { addUnique } from './add-unique';

@Injectable()
export class BullOrderRoutingEnqueuer implements OrderRoutingEnqueuer {
  constructor(
    @InjectQueue(QUEUES.ORDER_ROUTING) private readonly queue: Queue,
  ) {}

  async enqueueRouting(job: OrderRoutingJob): Promise<void> {
    const data: RouteSupplierOrderJobData = {
      tenantId: job.tenantId,
      channelOrderId: job.channelOrderId,
    };
    // One pending routing job per order (NFR-01); a finished one is replaced so a retry really runs.
    await addUnique(
      this.queue,
      JOB_PATTERNS.ROUTE_SUPPLIER_ORDER,
      data,
      `route-${job.channelOrderId}`,
    );
  }
}
