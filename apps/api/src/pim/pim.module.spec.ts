import { getQueueToken } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { PIM_RUNTIME_QUEUES, PimRuntimeModule } from '@repo/pim-runtime';
import { PIM_CONTROLLERS } from './pim.module';

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
    useValue: { add: jest.fn(), getJob: jest.fn() },
  })),
  exports: PIM_RUNTIME_QUEUES.map((n) => getQueueToken(n)),
})
class FakeQueuesModule {}

describe('PimModule wiring', () => {
  it('resolves every controller against the real PimRuntimeModule providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        FakeDatabaseModule,
        PimRuntimeModule.register({ queues: { module: FakeQueuesModule } }),
      ],
      controllers: PIM_CONTROLLERS,
    }).compile();
    for (const controller of PIM_CONTROLLERS) {
      expect(moduleRef.get(controller)).toBeInstanceOf(controller);
    }
    await moduleRef.close();
  });
});
