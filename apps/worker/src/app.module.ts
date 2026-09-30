import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailModule } from '@repo/mail';
import { QueueModule, QUEUES, SharedModule } from '@repo/shared';
import { CatalogSyncConsumer } from './pim/consumers/catalog-sync.consumer';
import { ListingSyncConsumer } from './pim/consumers/listing-sync.consumer';
import { OrderImportConsumer } from './pim/consumers/order-import.consumer';
import { OrderMaintenanceConsumer } from './pim/consumers/order-maintenance.consumer';
import { OrderRoutingConsumer } from './pim/consumers/order-routing.consumer';
import { OrderStatusConsumer } from './pim/consumers/order-status.consumer';
import { StockSyncConsumer } from './pim/consumers/stock-sync.consumer';
import { PimRuntimeModule } from './pim/pim-runtime';
import { EmailConsumer } from './consumer/email.consumer';
import { workerEnvSchema } from './env';
import { DlqModule } from './dlq/dlq.module';
import { QueueMetricsService } from './metrics/queue-metrics.service';

@Module({
  imports: [
    SharedModule.register({
      validate: (c) => workerEnvSchema.parse(c),
      metrics: { appName: 'worker' },
    }),
    QueueModule.registerQueues([
      QUEUES.EMAIL,
      QUEUES.CATALOG_SYNC,
      QUEUES.STOCK_SYNC,
      QUEUES.ORDER_IMPORT,
      QUEUES.ORDER_ROUTING,
      QUEUES.ORDER_STATUS,
      QUEUES.ORDER_MAINTENANCE,
      QUEUES.LISTING_SYNC,
    ]),
    MailModule.forRootAsync({
      provider: 'brevo',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        apiKey: configService.getOrThrow<string>('BREVO_API_KEY'),
        fromEmail: configService.getOrThrow<string>('FROM_EMAIL'),
        fromName: configService.get<string>('FROM_NAME', ''),
        devEmail: configService.get<string>('DEV_EMAIL', ''),
      }),
      inject: [ConfigService],
    }),
    DlqModule,
    PimRuntimeModule.register(),
  ],
  controllers: [],
  providers: [
    EmailConsumer,
    QueueMetricsService,
    CatalogSyncConsumer,
    StockSyncConsumer,
    OrderImportConsumer,
    OrderRoutingConsumer,
    OrderStatusConsumer,
    OrderMaintenanceConsumer,
    ListingSyncConsumer,
  ],
})
export class AppModule {}
