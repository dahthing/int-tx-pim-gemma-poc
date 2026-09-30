import { Logger } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import type { RequestLogEntry, RequestLogSink } from '@repo/http-client';

/** http-client request sink writing IntegrationRequestLog rows (URL and error are already redacted by the client). */
export class DbRequestLogSink implements RequestLogSink {
  private readonly logger = new Logger(DbRequestLogSink.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenantId: string,
  ) {}

  async log(entry: RequestLogEntry): Promise<void> {
    try {
      await this.db.integrationRequestLog.create({
        data: {
          tenantId: this.tenantId,
          connector: entry.connector,
          method: entry.method,
          url: entry.url,
          status: entry.status,
          durationMs: entry.durationMs,
          correlationId: entry.correlationId,
          error: entry.error,
        },
      });
    } catch (e) {
      this.logger.warn(`request log write failed: ${(e as Error).message}`);
    }
  }
}
