import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import type { LlmUsageEntry, UsageLogger } from '@repo/pim-catalog';
import { RUNTIME_AUDIT } from '../runtime.constants';

/** FR-ENR-002 AC6: per-call token usage, persisted as audit events (no dedicated table in the POC). */
@Injectable()
export class AuditUsageLogger implements UsageLogger {
  constructor(private readonly db: DatabaseService) {}

  async logLlmUsage(entry: LlmUsageEntry): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        tenantId: entry.tenantId,
        actor: RUNTIME_AUDIT.SYSTEM_ACTOR,
        entity: RUNTIME_AUDIT.ENTITY_LLM_USAGE,
        entityId: entry.productId,
        action: RUNTIME_AUDIT.ACTION_LLM_USAGE,
        diff: {
          operation: entry.operation,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          model: entry.model,
        },
      },
    });
  }
}
