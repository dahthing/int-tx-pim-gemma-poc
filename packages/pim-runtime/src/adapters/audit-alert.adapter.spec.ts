import { AuditAlertAdapter } from './audit-alert.adapter';

function build(latest: { action: string } | null = null) {
  const db = {
    auditEvent: {
      findFirst: jest.fn().mockResolvedValue(latest),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return { db, adapter: new AuditAlertAdapter(db as never) };
}

describe('AuditAlertAdapter', () => {
  it('writes an order alert using its dedupeKey as entityId', async () => {
    const { db, adapter } = build();
    await adapter.raise({
      tenantId: 't',
      channelOrderId: 'o1',
      type: 'ship_by_deadline',
      message: 'late',
      dedupeKey: 'ship:o1',
      metadata: { h: 1 },
    } as never);
    expect(db.auditEvent.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 't',
        entity: 'Alert',
        entityId: 'ship:o1',
        action: { in: ['alert.raised', 'alert.acknowledged'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    });
    expect(db.auditEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't',
        actor: 'system',
        entity: 'Alert',
        entityId: 'ship:o1',
        action: 'alert.raised',
        diff: {
          type: 'ship_by_deadline',
          message: 'late',
          dedupeKey: 'ship:o1',
          channelOrderId: 'o1',
          metadata: { h: 1 },
        },
      },
    });
  });

  it('skips while the same alert is still open', async () => {
    const { db, adapter } = build({ action: 'alert.raised' });
    await adapter.raise({
      tenantId: 't',
      type: 'x',
      message: 'm',
      dedupeKey: 'k',
    } as never);
    expect(db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('re-raises once the previous one was acknowledged', async () => {
    const { db, adapter } = build({ action: 'alert.acknowledged' });
    await adapter.raise({
      tenantId: 't',
      type: 'x',
      message: 'm',
      dedupeKey: 'k',
    } as never);
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('derives a dedupe key for catalog alerts from type, product and channel', async () => {
    const { db, adapter } = build();
    await adapter.raise({
      tenantId: 't',
      type: 'margin_break',
      message: 'm',
      productId: 'p',
      channelId: 'c',
      details: { gross: '1' },
    });
    const data = db.auditEvent.create.mock.calls[0][0].data;
    expect(data.entityId).toBe('margin_break:p:c');
    expect(data.diff).toEqual({
      type: 'margin_break',
      message: 'm',
      dedupeKey: 'margin_break:p:c',
      productId: 'p',
      channelId: 'c',
      metadata: { gross: '1' },
    });
  });

  it('uses empty segments when the catalog alert has no product/channel', async () => {
    const { db, adapter } = build();
    await adapter.raise({ tenantId: 't', type: 'x', message: 'm' });
    expect(db.auditEvent.create.mock.calls[0][0].data.entityId).toBe('x::');
  });
});
