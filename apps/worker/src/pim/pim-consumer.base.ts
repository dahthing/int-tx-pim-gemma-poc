import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CLS_CORRELATION_ID, SentryUtil } from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import z from 'zod';
import { QueueMetricsService } from '../metrics/queue-metrics.service';

/**
 * Shared plumbing for PIM queue consumers: payload validation, correlation id
 * propagation from job data, metrics, Sentry reporting and DLQ hand-off.
 * Subclasses declare @Processor, process() (switch on job.name) and the
 * @OnWorkerEvent handlers delegating to onJobCompleted/onJobFailed.
 */
export abstract class PimConsumerBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly queueName: string,
    private readonly queueMetrics: QueueMetricsService,
    private readonly cls: ClsService,
    private readonly dlqQueue: Queue,
  ) {
    super();
  }

  protected run<S extends z.ZodType<{ correlationId?: string }>>(
    job: Job,
    schema: S,
    fn: (data: z.output<S>) => Promise<unknown>,
  ): Promise<void> {
    const data = schema.parse(job.data) as z.output<S>;
    return this.cls.run(async () => {
      if (data.correlationId) {
        this.cls.set(CLS_CORRELATION_ID, data.correlationId);
      }
      this.logger.log(`Processing ${job.name} (job ${job.id})`);
      await fn(data);
    });
  }

  protected unknown(job: Job): void {
    this.logger.warn(`No handler for job ${job.id} with name ${job.name}`);
  }

  protected onJobCompleted(job: Job): void {
    const durationMs =
      (job.finishedOn ?? Date.now()) - (job.processedOn ?? Date.now());
    this.queueMetrics.recordDuration(job.name, durationMs);
  }

  protected onJobFailed(job: Job, error: Error): void {
    this.queueMetrics.recordFailure(job.name);
    SentryUtil.captureException(error, {
      extra: { jobId: job.id, jobName: job.name, data: job.data },
      tags: { queue: this.queueName, app: 'worker' },
    });
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void this.dlqQueue.add(job.name, job.data, {
        removeOnFail: { count: 1000, age: 2592000 },
        removeOnComplete: true,
      });
    }
  }
}
