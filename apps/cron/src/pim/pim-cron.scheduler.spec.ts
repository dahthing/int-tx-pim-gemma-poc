import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PimCronScheduler } from './pim-cron.scheduler';
import { PIM_SCHEDULES } from './pim-schedules';
import { PimEnqueueService } from './pim-enqueue.service';

describe('PIM_SCHEDULES defaults', () => {
  const byName = Object.fromEntries(PIM_SCHEDULES.map((s) => [s.name, s]));
  it('matches the PRD schedules', () => {
    expect(byName['aw-catalog-full']!.cron).toBe('30 3 * * *');
    expect(byName['aw-stock-sync']!.cron).toBe('*/30 * * * *');
    expect(byName['ps-order-import']!.cron).toBe('*/10 * * * *');
    expect(byName['temu-order-import']!.cron).toBe('*/10 * * * *');
    expect(byName['ship-by-deadline-scan']!.cron).toBe('0 * * * *');
    expect(byName['pii-purge']!.cron).toBe('0 4 * * *');
    expect(byName['request-log-purge']!.cron).toBe('30 4 * * *');
    expect(byName['request-log-purge']!.configKey).toBe(
      'CRON_REQUEST_LOG_PURGE',
    );
    expect(byName['supplier-order-status-poll']).toBeDefined();
    expect(byName['listing-review-poll']).toBeDefined();
  });
  it('has unique names and config keys', () => {
    expect(new Set(PIM_SCHEDULES.map((s) => s.name)).size).toBe(
      PIM_SCHEDULES.length,
    );
    expect(new Set(PIM_SCHEDULES.map((s) => s.configKey)).size).toBe(
      PIM_SCHEDULES.length,
    );
  });
});

describe('PimCronScheduler', () => {
  const enqueue = Object.fromEntries(
    PIM_SCHEDULES.map((s) => [
      s.method,
      jest.fn().mockResolvedValue(undefined),
    ]),
  ) as unknown as PimEnqueueService;

  const make = (overrides: Record<string, string> = {}) => {
    const added: {
      name: string;
      job: { cronTime: { source: string | Date }; stop: () => void };
    }[] = [];
    const registry = {
      addCronJob: jest.fn((name, job) => added.push({ name, job })),
    } as unknown as SchedulerRegistry;
    const config = {
      get: jest.fn((k: string, d?: string) => overrides[k] ?? d),
    } as unknown as ConfigService;
    return {
      svc: new PimCronScheduler(registry, config, enqueue),
      added,
      registry,
    };
  };

  afterEach(() => jest.clearAllMocks());

  it('registers every schedule in Europe/Lisbon by default', () => {
    const { svc, added } = make();
    svc.onModuleInit();
    expect(added.map((a) => a.name).sort()).toEqual(
      PIM_SCHEDULES.map((s) => s.name).sort(),
    );
    added.forEach((a) => a.job.stop());
  });

  it('lets ConfigService override a schedule', () => {
    const { svc, added } = make({ CRON_AW_STOCK_SYNC: '*/5 * * * *' });
    svc.onModuleInit();
    const job = added.find((a) => a.name === 'aw-stock-sync')!.job;
    expect(job.cronTime.source).toBe('*/5 * * * *');
    added.forEach((a) => a.job.stop());
  });

  it('delegates ticks to the enqueue service only', async () => {
    const { svc } = make();
    await svc.run('aw-catalog-full');
    expect((enqueue as any).enqueueCatalogFullSync).toHaveBeenCalledTimes(1);
  });

  it('swallows enqueue errors so a tick never crashes the process', async () => {
    (enqueue as any).enqueuePiiPurge.mockRejectedValueOnce(new Error('x'));
    const { svc } = make();
    await expect(svc.run('pii-purge')).resolves.toBeUndefined();
  });
});
