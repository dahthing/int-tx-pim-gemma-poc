import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule, QUEUES, SharedModule } from '@repo/shared';
import { cronEnvSchema } from './env';
import { ExampleCronService } from './example/example-cron.service';
import { PimCronScheduler } from './pim/pim-cron.scheduler';
import { PimEnqueueService } from './pim/pim-enqueue.service';

@Module({
  imports: [
    SharedModule.register({
      validate: (c) => cronEnvSchema.parse(c),
      metrics: { appName: 'cron' },
    }),
    ScheduleModule.forRoot(),
    QueueModule.registerQueues([
      QUEUES.CATALOG_SYNC,
      QUEUES.STOCK_SYNC,
      QUEUES.ORDER_IMPORT,
      QUEUES.ORDER_STATUS,
      QUEUES.ORDER_MAINTENANCE,
      QUEUES.LISTING_SYNC,
    ]),
  ],
  controllers: [],
  providers: [ExampleCronService, PimEnqueueService, PimCronScheduler],
})
export class AppModule {}
