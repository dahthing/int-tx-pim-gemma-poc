import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PimEnqueueService } from './pim-enqueue.service';
import {
  CRON_TIMEZONE_KEY,
  DEFAULT_CRON_TIMEZONE,
  PIM_SCHEDULES,
} from './pim-schedules';

/**
 * Registers PIM schedules at boot so each expression is overridable via
 * ConfigService (`@Cron()` only accepts compile-time constants).
 * Ticks only enqueue; they never run sync logic inline.
 *
 * ponytail: run single-instance, same caveat as the other cron services.
 */
@Injectable()
export class PimCronScheduler implements OnModuleInit {
  private readonly logger = new Logger(PimCronScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService,
    private readonly enqueue: PimEnqueueService,
  ) {}

  onModuleInit(): void {
    const timeZone = this.config.get<string>(
      CRON_TIMEZONE_KEY,
      DEFAULT_CRON_TIMEZONE,
    );
    for (const schedule of PIM_SCHEDULES) {
      const expression = this.config.get<string>(
        schedule.configKey,
        schedule.cron,
      );
      const job = new CronJob(
        expression,
        () => void this.run(schedule.name),
        null,
        false,
        timeZone,
      );
      this.registry.addCronJob(schedule.name, job);
      job.start();
      this.logger.log(
        `Scheduled ${schedule.name} at "${expression}" (${timeZone})`,
      );
    }
  }

  async run(name: string): Promise<void> {
    const schedule = PIM_SCHEDULES.find((s) => s.name === name);
    if (!schedule) return;
    try {
      await this.enqueue[schedule.method]();
    } catch (error) {
      this.logger.error(`Cron ${name} failed`, error as Error);
    }
  }
}
