import { PrismaPendingPriceStore } from './prisma-pending-price.store';

describe('PrismaPendingPriceStore', () => {
  const since = new Date('2026-09-30T10:00:00.000Z');
  const setup = () => {
    const model = {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    };
    const store = new PrismaPendingPriceStore({ channelPendingPrice: model } as never, 't1', 'ch1');
    return { model, store };
  };

  it('markPending upserts on (channel, externalId), scoped to the tenant', async () => {
    const { model, store } = setup();
    await store.markPending('g1', '9.5000', since);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { channelId_externalId: { channelId: 'ch1', externalId: 'g1' } },
      create: { tenantId: 't1', channelId: 'ch1', externalId: 'g1', priceNet: '9.5000', since },
      update: { priceNet: '9.5000', since },
    });
  });

  it('isPending reflects the row', async () => {
    const { model, store } = setup();
    model.findUnique.mockResolvedValueOnce({ id: 'x' }).mockResolvedValueOnce(null);
    expect(await store.isPending('g1')).toBe(true);
    expect(await store.isPending('g2')).toBe(false);
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { channelId_externalId: { channelId: 'ch1', externalId: 'g1' } },
    });
  });

  it('get maps the row (decimal to string) and returns undefined when absent', async () => {
    const { model, store } = setup();
    model.findUnique.mockResolvedValueOnce({ externalId: 'g1', priceNet: { toString: () => '9.5000' }, since });
    expect(await store.get('g1')).toEqual({ externalId: 'g1', priceNet: '9.5000', since });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await store.get('g2')).toBeUndefined();
  });

  it('resolve deletes the row idempotently (deleteMany, tenant scoped)', async () => {
    const { model, store } = setup();
    await store.resolve('g1');
    expect(model.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1', channelId: 'ch1', externalId: 'g1' } });
  });

  it('pendingIds lists this channel only, oldest first', async () => {
    const { model, store } = setup();
    model.findMany.mockResolvedValue([{ externalId: 'a' }, { externalId: 'b' }]);
    expect(await store.pendingIds()).toEqual(['a', 'b']);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', channelId: 'ch1' },
      select: { externalId: true },
      orderBy: { since: 'asc' },
    });
  });
});
