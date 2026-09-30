import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import { RUNTIME_DEFAULTS } from '../runtime.constants';

const DAY_MS = 86_400_000;

/** PRD section 5: IntegrationRequestLog rows (URL, status, timing; never payloads) are kept 30 days. */
@Injectable()
export class RequestLogRetentionService {
  constructor(private readonly db: DatabaseService) {}

  async purge(
    tenantId: string,
    now: Date = new Date(),
    retentionDays: number = RUNTIME_DEFAULTS.REQUEST_LOG_RETENTION_DAYS,
  ): Promise<{ deleted: number }> {
    if (!(retentionDays > 0)) throw new Error('Request log retention must be a positive number of days');
    const { count } = await this.db.integrationRequestLog.deleteMany({
      where: { tenantId, createdAt: { lt: new Date(now.getTime() - retentionDays * DAY_MS) } },
    });
    return { deleted: count };
  }
}
