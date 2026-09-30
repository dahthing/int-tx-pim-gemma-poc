import { DbRequestLogSink } from './request-log.sink';

describe('DbRequestLogSink', () => {
  it('persists each request with the tenant, without secrets it was not given', async () => {
    const create = jest.fn().mockResolvedValue({});
    const sink = new DbRequestLogSink(
      { integrationRequestLog: { create } } as never,
      't1',
    );
    await sink.log({
      connector: 'aw-aiku',
      method: 'GET',
      url: 'https://x/y',
      status: 200,
      durationMs: 12,
      correlationId: 'c',
      attempt: 1,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        connector: 'aw-aiku',
        method: 'GET',
        url: 'https://x/y',
        status: 200,
        durationMs: 12,
        correlationId: 'c',
        error: undefined,
      },
    });
  });

  it('never throws when the database write fails', async () => {
    const sink = new DbRequestLogSink(
      {
        integrationRequestLog: {
          create: jest.fn().mockRejectedValue(new Error('db down')),
        },
      } as never,
      't1',
    );
    await expect(
      sink.log({
        connector: 'c',
        method: 'GET',
        url: 'u',
        durationMs: 1,
        correlationId: 'x',
        attempt: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
