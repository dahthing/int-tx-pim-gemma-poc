import { AuditUsageLogger } from './audit-usage-logger';

describe('AuditUsageLogger', () => {
  it('records token usage as an audit event', async () => {
    const create = jest.fn().mockResolvedValue({});
    const logger = new AuditUsageLogger({ auditEvent: { create } } as never);
    await logger.logLlmUsage({
      tenantId: 't',
      productId: 'p',
      operation: 'enrichment',
      inputTokens: 10,
      outputTokens: 5,
      model: 'm',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 't',
        actor: 'system',
        entity: 'LlmUsage',
        entityId: 'p',
        action: 'llm.usage',
        diff: {
          operation: 'enrichment',
          inputTokens: 10,
          outputTokens: 5,
          model: 'm',
        },
      },
    });
  });
});
