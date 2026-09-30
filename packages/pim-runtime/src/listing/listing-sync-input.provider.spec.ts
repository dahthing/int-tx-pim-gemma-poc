import { ListingSyncInputProviderImpl } from './listing-sync-input.provider';

describe('ListingSyncInputProviderImpl', () => {
  it('maps pricing contexts to sync inputs', async () => {
    const pricing = {
      buildMany: jest
        .fn()
        .mockResolvedValue([
          { productId: 'p1', price: { a: 1 }, stock: { b: 2 } },
        ]),
    };
    const provider = new ListingSyncInputProviderImpl(pricing as never);
    await expect(provider.getInputs('t', 'c', ['p1', 'p2'])).resolves.toEqual([
      { productId: 'p1', price: { a: 1 }, stock: { b: 2 } },
    ]);
    expect(pricing.buildMany).toHaveBeenCalledWith('t', 'c', ['p1', 'p2']);
  });
});
