import { RequestLogRetentionService } from './request-log-retention.service';

describe('RequestLogRetentionService (section 5: IntegrationRequestLog kept 30 days)', () => {
  const now = new Date('2026-10-31T00:00:00.000Z');
  const setup = (count = 3) => {
    const deleteMany = jest.fn().mockResolvedValue({ count });
    return { deleteMany, svc: new RequestLogRetentionService({ integrationRequestLog: { deleteMany } } as never) };
  };

  it('deletes the tenant rows older than 30 days by default', async () => {
    const { svc, deleteMany } = setup();
    const res = await svc.purge('t1', now);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', createdAt: { lt: new Date('2026-10-01T00:00:00.000Z') } },
    });
    expect(res).toEqual({ deleted: 3 });
  });

  it('honours a custom retention and rejects a non-positive one', async () => {
    const { svc, deleteMany } = setup(0);
    await svc.purge('t1', now, 7);
    expect(deleteMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date('2026-10-24T00:00:00.000Z'));
    await expect(svc.purge('t1', now, 0)).rejects.toThrow(/retention/i);
  });
});
