import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PIM_TOKENS, PimCatalogModule } from '@repo/pim-catalog';
import { PIM_ORDERS_TOKENS, PimOrdersModule } from '@repo/pim-orders';
import { QUEUES, QueueModule } from '@repo/shared';
import { CatalogOpsService } from './admin/catalog-ops.service';
import { CatalogQueryService } from './admin/catalog-query.service';
import { ChannelAdminService } from './admin/channel-admin.service';
import { DashboardService } from './admin/dashboard.service';
import { OrdersQueryService } from './admin/orders-query.service';
import { PriceRuleService } from './admin/price-rule.service';
import { SettingsService } from './admin/settings.service';
import { SyncTriggerService } from './admin/sync-trigger.service';
import { TenantContext } from './admin/tenant-context';
import { AnthropicLlmClient } from './adapters/anthropic-llm-client';
import { AuditAlertAdapter } from './adapters/audit-alert.adapter';
import { AuditUsageLogger } from './adapters/audit-usage-logger';
import { ConnectorChannelResolver } from './adapters/channel-connector.resolver';
import { ConfigEncryptionKeyProvider } from './adapters/encryption-key.provider';
import { ConfigOrderSettingsProvider } from './adapters/config-order-settings.provider';
import { ConnectorFactory } from './adapters/connector-factory';
import { CredentialVault } from './adapters/credential-vault';
import { HttpMediaDownloader } from './adapters/http-media-downloader';
import { S3ObjectStorage } from './adapters/s3-object-storage';
import { SourceConnectorProxy } from './adapters/source-connector.proxy';
import { SupplierGatewayResolverImpl } from './adapters/supplier-gateway.resolver';
import { ListingPayloadBuilderImpl } from './listing/listing-payload.builder';
import { ListingSyncInputProviderImpl } from './listing/listing-sync-input.provider';
import { PricingInputBuilder } from './listing/pricing-input.builder';
import { PimJobs } from './pim-jobs';
import { BullChannelSyncEnqueuer } from './queue/channel-sync.enqueuer';
import { ConnectorListingStockZeroer } from './queue/listing-stock.zeroer';
import { BullOrderRoutingEnqueuer } from './queue/order-routing.enqueuer';
import { RequestLogRetentionService } from './adapters/request-log-retention.service';
import { SupplierScope } from './supplier-scope';

export interface PimRuntimeOptions {
  /** Replaces the BullMQ queue registration (tests). Must provide the queues listed in `PIM_RUNTIME_QUEUES`. */
  queues?: DynamicModule;
  /** FR-ENR-002 AC5: forbidden terms for the enrichment validator (defaults to the validator's built-in list). */
  forbiddenTerms?: readonly string[];
}

/**
 * Queues the runtime produces to / the API triggers. `QueueModule.registerQueues` always provides `EmailProducer`,
 * so the email queue has to be registered with it; the rest are the PIM queues.
 */
export const PIM_RUNTIME_QUEUES = [
  QUEUES.EMAIL,
  QUEUES.ORDER_ROUTING,
  QUEUES.ORDER_IMPORT,
  QUEUES.ORDER_STATUS,
  QUEUES.LISTING_SYNC,
  QUEUES.CATALOG_SYNC,
  QUEUES.STOCK_SYNC,
] as const;

const ADMIN_SERVICES = [
  TenantContext,
  CatalogQueryService,
  CatalogOpsService,
  ChannelAdminService,
  PriceRuleService,
  OrdersQueryService,
  DashboardService,
  SettingsService,
  SyncTriggerService,
  RequestLogRetentionService,
] as const;

/** Adapters for every pim-catalog / pim-orders port. Global so both feature modules (and the admin services) see them. */
function coreModule(queues: DynamicModule): DynamicModule {
  const providers: Provider[] = [
    SupplierScope,
    ConfigEncryptionKeyProvider,
    {
      provide: PIM_ORDERS_TOKENS.ENCRYPTION_KEY_PROVIDER,
      useExisting: ConfigEncryptionKeyProvider,
    },
    CredentialVault,
    ConnectorFactory,
    ConnectorChannelResolver,
    {
      provide: PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER,
      useExisting: ConnectorChannelResolver,
    },
    {
      provide: PIM_ORDERS_TOKENS.SUPPLIER_GATEWAY_RESOLVER,
      useFactory: (factory: ConnectorFactory) =>
        new SupplierGatewayResolverImpl(factory),
      inject: [ConnectorFactory],
    },
    SourceConnectorProxy,
    { provide: PIM_TOKENS.SOURCE_CONNECTOR, useExisting: SourceConnectorProxy },
    {
      provide: PIM_TOKENS.OBJECT_STORAGE,
      useFactory: (config: ConfigService) => new S3ObjectStorage(config),
      inject: [ConfigService],
    },
    {
      provide: PIM_TOKENS.MEDIA_DOWNLOADER,
      useFactory: () => new HttpMediaDownloader(),
    },
    {
      provide: PIM_TOKENS.LLM_CLIENT,
      useFactory: (config: ConfigService) => new AnthropicLlmClient(config),
      inject: [ConfigService],
    },
    AuditUsageLogger,
    { provide: PIM_TOKENS.USAGE_LOGGER, useExisting: AuditUsageLogger },
    AuditAlertAdapter,
    { provide: PIM_TOKENS.ALERT_SERVICE, useExisting: AuditAlertAdapter },
    {
      provide: PIM_ORDERS_TOKENS.ORDER_ALERT_PORT,
      useExisting: AuditAlertAdapter,
    },
    ConfigOrderSettingsProvider,
    {
      provide: PIM_ORDERS_TOKENS.ORDER_SETTINGS_PROVIDER,
      useExisting: ConfigOrderSettingsProvider,
    },
    BullOrderRoutingEnqueuer,
    {
      provide: PIM_ORDERS_TOKENS.ORDER_ROUTING_ENQUEUER,
      useExisting: BullOrderRoutingEnqueuer,
    },
    BullChannelSyncEnqueuer,
    {
      provide: PIM_TOKENS.CHANNEL_SYNC_ENQUEUER,
      useExisting: BullChannelSyncEnqueuer,
    },
    ConnectorListingStockZeroer,
    {
      provide: PIM_TOKENS.LISTING_STOCK_ZEROER,
      useExisting: ConnectorListingStockZeroer,
    },
  ];
  return {
    module: PimRuntimeCoreModule,
    global: true,
    imports: [queues],
    providers,
    exports: providers.map((p) =>
      typeof p === 'function' ? p : (p as { provide: string }).provide,
    ),
  };
}

@Module({})
export class PimRuntimeCoreModule {}

/**
 * Wires pim-catalog and pim-orders with concrete adapters for every port and exposes the `PimJobs` facade (worker, cron)
 * plus the back office services (api). Requires `SharedModule.register()` (DatabaseService, ConfigService, Redis config).
 *
 * Environment (read through ConfigService, see `RUNTIME_CONFIG`): PIM_ENCRYPTION_KEY, PIM_S3_*, ANTHROPIC_API_KEY,
 * PIM_LLM_MODEL, PIM_ORDER_DEFAULT_EMAIL / _PHONE, optional PIM_TENANT_SLUG. Values are only read when first needed.
 */
@Module({})
export class PimRuntimeModule {
  static register(options: PimRuntimeOptions = {}): DynamicModule {
    const queues =
      options.queues ?? QueueModule.registerQueues([...PIM_RUNTIME_QUEUES]);
    const core = coreModule(queues);
    const catalog = PimCatalogModule.register({
      ports: options.forbiddenTerms
        ? [
            {
              provide: PIM_TOKENS.FORBIDDEN_TERMS,
              useValue: options.forbiddenTerms,
            },
          ]
        : [],
    });
    const orders = PimOrdersModule.register({
      imports: [catalog],
      providers: [
        PricingInputBuilder,
        ListingPayloadBuilderImpl,
        {
          provide: PIM_ORDERS_TOKENS.LISTING_PAYLOAD_BUILDER,
          useExisting: ListingPayloadBuilderImpl,
        },
        ListingSyncInputProviderImpl,
        {
          provide: PIM_ORDERS_TOKENS.LISTING_SYNC_INPUT_PROVIDER,
          useExisting: ListingSyncInputProviderImpl,
        },
      ],
    });
    return {
      module: PimRuntimeModule,
      imports: [core, catalog, orders, queues],
      providers: [PimJobs, ...ADMIN_SERVICES],
      exports: [PimJobs, ...ADMIN_SERVICES, catalog, orders],
    };
  }
}
