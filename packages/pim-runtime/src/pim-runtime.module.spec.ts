import { getQueueToken } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import {
  PIM_TOKENS,
  EnrichmentService,
  PricingService,
  CategoryMappingService,
  CurationService,
} from '@repo/pim-catalog';
import {
  PIM_ORDERS_TOKENS,
  ListingSyncService,
  ShipmentService,
} from '@repo/pim-orders';
import {
  CatalogQueryService,
  CredentialVault,
  PIM_RUNTIME_QUEUES,
  PimJobs,
  PimRuntimeModule,
  SettingsService,
  SyncTriggerService,
} from './index';

const queue = () => ({ add: jest.fn(), getJob: jest.fn() });

@Global()
@Module({
  providers: [{ provide: DatabaseService, useValue: {} }],
  exports: [DatabaseService],
})
class FakeDatabaseModule {}

@Global()
@Module({
  providers: PIM_RUNTIME_QUEUES.map((n) => ({
    provide: getQueueToken(n),
    useValue: queue(),
  })),
  exports: PIM_RUNTIME_QUEUES.map((n) => getQueueToken(n)),
})
class FakeQueuesModule {}

describe('PimRuntimeModule wiring', () => {
  it('resolves PimJobs, every port adapter and the back office services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        FakeDatabaseModule,
        PimRuntimeModule.register({
          queues: { module: FakeQueuesModule },
          forbiddenTerms: ['cura'],
        }),
      ],
    }).compile();

    expect(moduleRef.get(PimJobs)).toBeInstanceOf(PimJobs);
    for (const token of [
      ...Object.values(PIM_TOKENS).filter(
        (t) => t !== PIM_TOKENS.FORBIDDEN_TERMS,
      ),
      ...Object.values(PIM_ORDERS_TOKENS),
    ]) {
      expect(moduleRef.get(token, { strict: false })).toBeDefined();
    }
    for (const svc of [
      EnrichmentService,
      PricingService,
      CategoryMappingService,
      CurationService,
      ListingSyncService,
      ShipmentService,
      CatalogQueryService,
      SettingsService,
      SyncTriggerService,
      CredentialVault,
    ]) {
      expect(moduleRef.get(svc, { strict: false })).toBeDefined();
    }
    expect(
      moduleRef.get(PIM_TOKENS.FORBIDDEN_TERMS, { strict: false }),
    ).toEqual(['cura']);
    await moduleRef.close();
  });

  it('does not provide forbidden terms unless configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        FakeDatabaseModule,
        PimRuntimeModule.register({ queues: { module: FakeQueuesModule } }),
      ],
    }).compile();
    expect(() =>
      moduleRef.get(PIM_TOKENS.FORBIDDEN_TERMS, { strict: false }),
    ).toThrow();
    await moduleRef.close();
  });
});
