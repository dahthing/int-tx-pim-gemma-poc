import 'reflect-metadata';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AwAikuConnector,
  type AwAikuConnectorOptions,
} from '@repo/connector-aw-aiku';
import type {
  BatchResult,
  ChannelListingPayload,
  ChannelListingResult,
  ChannelOrderRaw,
  ConnectionTestResult,
  ConnectorCapabilities,
  IChannelConnector,
  Page,
  PageCursor,
  PlaceDropshipOrderCommand,
  PriceUpdate,
  PushShipmentCommand,
  StockUpdate,
  SupplierOrderProgress,
  SupplierOrderResult,
} from '@repo/connector-contracts';
import { encryptSecret } from '@repo/core-domain';
import { DatabaseService, SupplierEnvironment } from '@repo/database';
import type { FakeFetch } from '@repo/http-client';
import {
  PIM_TOKENS,
  PimCatalogModule,
  InMemoryObjectStorage,
} from '@repo/pim-catalog';
import {
  PIM_ORDERS_TOKENS,
  PimOrdersModule,
  type ChannelConnectorResolver,
  type OrderAlert,
  type SupplierGatewayResolver,
} from '@repo/pim-orders';
import { PricingInputBuilder } from '../src/listing/pricing-input.builder';
import { ListingPayloadBuilderImpl } from '../src/listing/listing-payload.builder';
import { ListingSyncInputProviderImpl } from '../src/listing/listing-sync-input.provider';

/** Every suite is wrapped in this: it skips (with the warning printed by global-setup) when Docker is unavailable. */
export const DOCKER_ENABLED = process.env.PIM_IT_DOCKER === '1';
export const describeDocker: jest.Describe = DOCKER_ENABLED
  ? describe
  : describe.skip;

export const TEST_KEY = Buffer.alloc(32, 7);
export const encryptPii = (v: unknown): string =>
  encryptSecret(JSON.stringify(v), TEST_KEY);

export async function createDb(): Promise<DatabaseService> {
  const db = new DatabaseService(
    new ConfigService({
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: 'test',
    }),
  );
  await db.$connect();
  return db;
}

/** Wipes every PIM table (cascades from tenant). */
export async function resetDb(db: DatabaseService): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE "tenant" CASCADE');
}

export async function seedTenant(
  db: DatabaseService,
): Promise<{ tenantId: string; supplierId: string }> {
  const tenant = await db.tenant.create({
    data: { name: 'Gemma', slug: 'gemma' },
  });
  const supplier = await db.supplier.create({
    data: {
      tenantId: tenant.id,
      code: 'aw-aiku',
      name: 'AW Dropship',
      environment: SupplierEnvironment.STAGING,
    },
  });
  return { tenantId: tenant.id, supplierId: supplier.id };
}

const noSleep = async (): Promise<void> => {};

/** Real AW connector, HTTP replaced by the fake fetch; retries/rate limits neutralised so tests are fast. */
export function awConnector(
  fetchImpl: FakeFetch,
  extra: Partial<AwAikuConnectorOptions> = {},
): AwAikuConnector {
  return new AwAikuConnector({
    token: 'test-token',
    environment: 'staging',
    fetchImpl,
    sleep: noSleep,
    requestsPerSecond: 100_000,
    maxAttempts: 1,
    maxSagaRetries: 0,
    ...extra,
  });
}

export const callTrace = (f: FakeFetch): string[] =>
  f.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

/** In-memory IChannelConnector that records everything it is asked to do (PrestaShop stand-in, HTTP is covered by its own contract tests). */
export class FakeChannel implements IChannelConnector {
  readonly upserts: ChannelListingPayload[] = [];
  readonly stockBatches: StockUpdate[][] = [];
  readonly priceBatches: PriceUpdate[][] = [];
  readonly shipments: PushShipmentCommand[] = [];
  orders: ChannelOrderRaw[] = [];

  constructor(readonly code = 'prestashop9') {}

  capabilities(): ConnectorCapabilities {
    return {
      listingWrite: true,
      stockWrite: true,
      priceWrite: true,
      orderRead: true,
      shipmentWrite: true,
    };
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true };
  }
  async upsertListing(p: ChannelListingPayload): Promise<ChannelListingResult> {
    this.upserts.push(p);
    return {
      externalId: p.externalId ?? `ps-${p.sku}`,
      status: 'live',
      payloadHash: `hash-${p.sku}`,
      imageChecksums: p.imageChecksums,
    };
  }
  private batch<T extends { externalId: string }>(items: T[]): BatchResult {
    return {
      results: items.map((i) => ({ externalId: i.externalId, ok: true })),
      okCount: items.length,
      failCount: 0,
    };
  }
  async updateStock(items: StockUpdate[]): Promise<BatchResult> {
    this.stockBatches.push(items);
    return this.batch(items);
  }
  async updatePrice(items: PriceUpdate[]): Promise<BatchResult> {
    this.priceBatches.push(items);
    return this.batch(items);
  }
  async deactivateListing(): Promise<void> {}
  async listOrdersSince(
    _since: Date,
    _cursor?: PageCursor,
  ): Promise<Page<ChannelOrderRaw>> {
    return { items: this.orders, nextCursor: null };
  }
  async pushShipment(cmd: PushShipmentCommand): Promise<void> {
    this.shipments.push(cmd);
  }
}

export interface RuntimeOptions {
  source: AwAikuConnector;
  channel?: FakeChannel;
  /** Builds the supplier gateway of the order saga; defaults to a gateway over `gatewayFetch`. */
  gatewayFetch?: FakeFetch;
}

export interface Harness {
  moduleRef: TestingModule;
  get<T>(type: new (...args: never[]) => T): T;
  storage: InMemoryObjectStorage;
  alerts: OrderAlert[];
  enqueuedProducts: string[][];
  enqueuedRouting: { tenantId: string; channelOrderId: string }[];
  zeroed: string[][];
}

/**
 * Wires the real pim-catalog / pim-orders services and the real runtime listing builders against the real
 * database, replacing only the ports that touch the outside world (supplier HTTP, channel, queues, storage, LLM).
 */
export async function buildHarness(
  db: DatabaseService,
  opts: RuntimeOptions,
): Promise<Harness> {
  const storage = new InMemoryObjectStorage();
  const alerts: OrderAlert[] = [];
  const enqueuedProducts: string[][] = [];
  const enqueuedRouting: { tenantId: string; channelOrderId: string }[] = [];
  const zeroed: string[][] = [];
  const channel = opts.channel ?? new FakeChannel();

  @Global()
  @Module({
    providers: [{ provide: DatabaseService, useValue: db }],
    exports: [DatabaseService],
  })
  class TestDatabaseModule {}

  const catalog = PimCatalogModule.register({
    ports: [
      { provide: PIM_TOKENS.SOURCE_CONNECTOR, useValue: opts.source },
      {
        provide: PIM_TOKENS.LISTING_STOCK_ZEROER,
        useValue: {
          zeroStock: async (_t: string, ids: string[]) => void zeroed.push(ids),
        },
      },
      {
        provide: PIM_TOKENS.CHANNEL_SYNC_ENQUEUER,
        useValue: {
          enqueueProductUpdates: async (_t: string, ids: string[]) =>
            void enqueuedProducts.push(ids),
        },
      },
      {
        provide: PIM_TOKENS.ALERT_SERVICE,
        useValue: { raise: async () => undefined },
      },
      { provide: PIM_TOKENS.OBJECT_STORAGE, useValue: storage },
      {
        provide: PIM_TOKENS.MEDIA_DOWNLOADER,
        useValue: {
          download: async () => ({
            data: Buffer.from('img'),
            mime: 'image/jpeg',
          }),
        },
      },
      {
        provide: PIM_TOKENS.LLM_CLIENT,
        useValue: {
          complete: async () => {
            throw new Error('LLM not used in integration tests');
          },
        },
      },
      {
        provide: PIM_TOKENS.USAGE_LOGGER,
        useValue: { logLlmUsage: async () => undefined },
      },
    ],
  });

  const resolver: ChannelConnectorResolver = { resolve: async () => channel };
  const gatewayFetch = opts.gatewayFetch;
  const gateways: SupplierGatewayResolver = {
    resolve: async () => ({
      placeDropshipOrder: async (
        cmd: PlaceDropshipOrderCommand,
        onProgress: (p: SupplierOrderProgress) => void | Promise<void>,
      ): Promise<SupplierOrderResult> => {
        if (!gatewayFetch)
          throw new Error('No gatewayFetch configured for this harness');
        return awConnector(gatewayFetch, { onProgress }).placeDropshipOrder(
          cmd,
        );
      },
      getSupplierOrder: async (id: string) => {
        if (!gatewayFetch)
          throw new Error('No gatewayFetch configured for this harness');
        return awConnector(gatewayFetch).getSupplierOrder(id);
      },
      deleteSupplierDraft: async () => undefined,
    }),
  };

  const orders = PimOrdersModule.register({
    imports: [catalog],
    providers: [
      {
        provide: PIM_ORDERS_TOKENS.ENCRYPTION_KEY_PROVIDER,
        useValue: { getKey: async () => TEST_KEY },
      },
      {
        provide: PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER,
        useValue: resolver,
      },
      {
        provide: PIM_ORDERS_TOKENS.SUPPLIER_GATEWAY_RESOLVER,
        useValue: gateways,
      },
      {
        provide: PIM_ORDERS_TOKENS.ORDER_ROUTING_ENQUEUER,
        useValue: {
          enqueueRouting: async (j: {
            tenantId: string;
            channelOrderId: string;
          }) => void enqueuedRouting.push(j),
        },
      },
      {
        provide: PIM_ORDERS_TOKENS.ORDER_ALERT_PORT,
        useValue: { raise: async (a: OrderAlert) => void alerts.push(a) },
      },
      {
        provide: PIM_ORDERS_TOKENS.ORDER_SETTINGS_PROVIDER,
        useValue: {
          get: async () => ({
            defaultEmail: 'orders@gemma.test',
            defaultPhone: '+351911111111',
            minMargin: '0.15',
            vatRate: '0.23',
          }),
        },
      },
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

  const moduleRef = await Test.createTestingModule({
    imports: [TestDatabaseModule as unknown as DynamicModule, catalog, orders],
  }).compile();
  return {
    moduleRef,
    get: (type) => moduleRef.get(type, { strict: false }),
    storage,
    alerts,
    enqueuedProducts,
    enqueuedRouting,
    zeroed,
  };
}
