import { createMockDb } from '../testing/mock-db';
import { TenantContext } from './tenant-context';

describe('TenantContext', () => {
  it('resolves the configured slug once and caches it', async () => {
    const { db, mock } = createMockDb();
    mock.tenant.findFirst.mockResolvedValue({ id: 't1' });
    const ctx = new TenantContext(db, {
      get: jest.fn().mockReturnValue('gemma'),
    } as never);
    expect(await ctx.resolve()).toBe('t1');
    expect(await ctx.resolve()).toBe('t1');
    expect(mock.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(mock.tenant.findFirst).toHaveBeenCalledWith({
      where: { deletedAt: null, slug: 'gemma' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  });

  it('falls back to the oldest tenant', async () => {
    const { db, mock } = createMockDb();
    mock.tenant.findFirst.mockResolvedValue({ id: 't9' });
    expect(
      await new TenantContext(db, { get: jest.fn() } as never).resolve(),
    ).toBe('t9');
    expect(mock.tenant.findFirst.mock.calls[0][0].where).toEqual({
      deletedAt: null,
    });
  });

  it('fails when there is no tenant', async () => {
    const { db } = createMockDb();
    await expect(
      new TenantContext(db, { get: jest.fn() } as never).resolve(),
    ).rejects.toThrow(/No tenant/);
    await expect(
      new TenantContext(db, {
        get: jest.fn().mockReturnValue('x'),
      } as never).resolve(),
    ).rejects.toThrow(/"x"/);
  });
});
