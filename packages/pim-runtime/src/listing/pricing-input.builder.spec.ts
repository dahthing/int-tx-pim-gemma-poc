import { createMockDb } from '../testing/mock-db';
import { PricingInputBuilder } from './pricing-input.builder';

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  tenantId: 't',
  status: 'PUBLISHED',
  categoryId: 'cat',
  supplierProductId: 'sp1',
  supplierProduct: {
    id: 'sp1',
    costPrice: '10.0000',
    stock: 20,
    status: 'ACTIVE',
  },
  ...over,
});

function setup(channelSettings: unknown = {}) {
  const { db, mock } = createMockDb();
  mock.channel.findFirst.mockResolvedValue({
    id: 'c',
    code: 'temu-eu',
    settings: channelSettings,
  });
  mock.product.findMany.mockResolvedValue([product()]);
  mock.priceRule.findMany.mockResolvedValue([
    {
      id: 'r1',
      priority: 5,
      condition: { channel: 'temu-eu' },
      markupPct: '0.8',
      fixedAdd: '1',
      rounding: 'X99',
      minMarginPct: '0.2',
      vatRate: '0.21',
    },
  ]);
  mock.supplierAssortmentItem.findMany.mockResolvedValue([
    { supplierProductId: 'sp1' },
  ]);
  return { mock, builder: new PricingInputBuilder(db) };
}

describe('PricingInputBuilder', () => {
  it('maps rules, vat and stock policy for each product', async () => {
    const { builder, mock } = setup({
      channelFeePct: '0.1',
      shippingAbsorbed: 2,
      stockBuffer: 3,
      stockCap: 50,
    });
    const ctx = (await builder.buildMany('t', 'c', ['p1']))[0]!;
    expect(ctx.productId).toBe('p1');
    expect(ctx.price).toMatchObject({
      cost: '10.0000',
      shippingAbsorbed: '2',
      vatRate: '0.21',
      channelFeePct: '0.1',
      context: { channel: 'temu-eu', category: 'cat' },
    });
    expect(ctx.price.rules).toEqual([
      {
        id: 'r1',
        priority: 5,
        conditions: { channel: 'temu-eu' },
        markupPct: '0.8',
        fixedAdd: '1',
        rounding: 'x.99',
        minMarginPct: '0.2',
      },
    ]);
    expect(ctx.price.defaultRule.id).toBe('default');
    expect(ctx.stock).toEqual({
      supplierStock: 20,
      buffer: 3,
      cap: 50,
      published: true,
      supplierProductMissing: false,
      assortmentDisabled: false,
    });
    expect(mock.priceRule.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't',
        deletedAt: null,
        OR: [{ channelId: null }, { channelId: 'c' }],
      },
    });
  });

  it('uses the default rule vat and the per-channel default buffer when nothing is configured', async () => {
    const { builder, mock } = setup();
    mock.priceRule.findMany.mockResolvedValue([]);
    const ctx = (await builder.buildMany('t', 'c', ['p1']))[0]!;
    expect(ctx.price.vatRate).toBe('0.23');
    expect(ctx.stock.buffer).toBe(5);
    expect(ctx.price.rules).toEqual([]);
  });

  it('flags drafts, missing supplier products and disabled assortment items', async () => {
    const { builder, mock } = setup();
    mock.product.findMany.mockResolvedValue([
      product({
        status: 'DRAFT',
        supplierProduct: {
          id: 'sp1',
          costPrice: '5',
          stock: 1,
          status: 'MISSING',
        },
      }),
    ]);
    mock.supplierAssortmentItem.findMany.mockResolvedValue([]);
    const ctx = (await builder.buildMany('t', 'c', ['p1']))[0]!;
    expect(ctx.stock).toMatchObject({
      published: false,
      supplierProductMissing: true,
      assortmentDisabled: true,
    });
  });

  it('skips products without a supplier product or cost, and tolerates an empty list', async () => {
    const { builder, mock } = setup();
    mock.product.findMany.mockResolvedValue([
      product({ supplierProduct: null }),
      product({
        id: 'p2',
        supplierProduct: {
          id: 's',
          costPrice: null,
          stock: 1,
          status: 'ACTIVE',
        },
      }),
    ]);
    expect(await builder.buildMany('t', 'c', ['p1', 'p2'])).toEqual([]);
    expect(await builder.buildMany('t', 'c', [])).toEqual([]);
  });

  it('build() throws when the product cannot be priced', async () => {
    const { builder, mock } = setup();
    mock.product.findMany.mockResolvedValue([]);
    await expect(builder.build('t', 'p1', 'c')).rejects.toThrow(
      /cannot be priced/,
    );
  });

  it('build() returns the single context', async () => {
    const { builder } = setup();
    expect((await builder.build('t', 'p1', 'c')).productId).toBe('p1');
  });

  it('fails when the channel does not exist', async () => {
    const { builder, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(builder.buildMany('t', 'c', ['p1'])).rejects.toThrow(
      /Channel c not found/,
    );
  });

  it('ignores malformed channel settings', async () => {
    const { builder } = setup({ stockBuffer: 'many' });
    const ctx = (await builder.buildMany('t', 'c', ['p1']))[0]!;
    expect(ctx.stock.buffer).toBe(5);
  });
});
