import { SupplierScope } from '../supplier-scope';
import { createMockDb } from '../testing/mock-db';
import { CatalogOpsService } from './catalog-ops.service';

function setup() {
  const { db, mock } = createMockDb();
  const scope = new SupplierScope();
  const seen: unknown[] = [];
  const curation = {
    addToGemma: jest.fn(async () => {
      seen.push(scope.current());
      return [
        { supplierProductId: 'a', ok: true, productId: 'p1' },
        { supplierProductId: 'b', ok: true, skipped: true },
        { supplierProductId: 'c', ok: false, error: 'x' },
        { supplierProductId: 'd', ok: true },
      ];
    }),
    removeFromGemma: jest.fn(async () => {
      seen.push(scope.current());
    }),
  };
  const media = {
    importForProduct: jest.fn(async () => {
      seen.push(scope.current());
      return { imported: 2, skipped: 0, failed: 0 };
    }),
  };
  const pricing = { quote: jest.fn() };
  mock.supplier.findFirst.mockResolvedValue({ id: 's1' });
  return {
    mock,
    seen,
    curation,
    media,
    pricing,
    svc: new CatalogOpsService(
      db,
      scope,
      curation as never,
      media as never,
      pricing as never,
    ),
  };
}

describe('CatalogOpsService', () => {
  it('adds products to Gemma inside the supplier scope and imports media for new products only', async () => {
    const { svc, curation, media, seen } = setup();
    const r = await svc.addToGemma('t', ['a', 'b', 'c', 'd']);
    expect(r).toHaveLength(4);
    expect(curation.addToGemma).toHaveBeenCalledWith('t', 's1', [
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(media.importForProduct).toHaveBeenCalledTimes(1);
    expect(media.importForProduct).toHaveBeenCalledWith('t', 'p1');
    expect(seen).toEqual([
      { tenantId: 't', supplierId: 's1' },
      { tenantId: 't', supplierId: 's1' },
    ]);
  });

  it('does not fail the add when a media import fails', async () => {
    const { svc, media } = setup();
    media.importForProduct.mockRejectedValue(new Error('storage down'));
    await expect(svc.addToGemma('t', ['a'], 's1')).resolves.toHaveLength(4);
  });

  it('resolves an explicit or default supplier and fails when none exists', async () => {
    const { svc, mock } = setup();
    await svc.resolveSupplierId('t', 's9');
    expect(mock.supplier.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't', deletedAt: null, id: 's9' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    mock.supplier.findFirst.mockResolvedValue(null);
    await expect(svc.resolveSupplierId('t')).rejects.toThrow(/No supplier/);
    await expect(svc.resolveSupplierId('t', 'zz')).rejects.toThrow(/zz/);
  });

  it('removes and imports media using the supplier of the product', async () => {
    const { svc, mock, curation, media, seen } = setup();
    mock.product.findFirst.mockResolvedValue({
      id: 'p',
      supplierProduct: { supplierId: 'sX' },
    });
    await svc.removeFromGemma('t', 'p');
    expect(curation.removeFromGemma).toHaveBeenCalledWith('t', 'sX', 'p');
    expect(await svc.importMedia('t', 'p')).toEqual({
      imported: 2,
      skipped: 0,
      failed: 0,
    });
    expect(media.importForProduct).toHaveBeenCalledWith('t', 'p');
    expect(seen).toEqual([
      { tenantId: 't', supplierId: 'sX' },
      { tenantId: 't', supplierId: 'sX' },
    ]);
  });

  it('falls back to the default supplier for a product without supplier product', async () => {
    const { svc, mock, curation } = setup();
    mock.product.findFirst.mockResolvedValue({
      id: 'p',
      supplierProduct: null,
    });
    await svc.removeFromGemma('t', 'p');
    expect(curation.removeFromGemma).toHaveBeenCalledWith('t', 's1', 'p');
  });

  it('404s an unknown product', async () => {
    const { svc, mock } = setup();
    mock.product.findFirst.mockResolvedValue(null);
    await expect(svc.importMedia('t', 'p')).rejects.toThrow(
      /Product p not found/,
    );
  });

  const quote = {
    result: {
      status: 'ok',
      net: '10',
      gross: '12.3',
      marginPct: '0.2',
      forced: false,
      ruleId: 'default',
    },
    available: 4,
  };

  it('maps a pricing quote', async () => {
    const { svc, mock, pricing } = setup();
    mock.channel.findFirst.mockResolvedValue({ id: 'c', code: 'temu-eu' });
    pricing.quote.mockResolvedValue({
      ...quote,
      result: {
        ...quote.result,
        status: 'blocked',
        reason: 'MARGIN_BELOW_MIN',
      },
    });
    const r = await svc.quote('t', {
      productId: 'p',
      channelId: 'c',
      override: { gross: '9', force: true },
    });
    expect(pricing.quote).toHaveBeenCalledWith('t', {
      productId: 'p',
      channelId: 'c',
      override: { gross: '9', force: true },
    });
    expect(r).toEqual({
      channelId: 'c',
      channelCode: 'temu-eu',
      status: 'blocked',
      net: '10',
      gross: '12.3',
      marginPct: '0.2',
      ruleId: 'default',
      forced: false,
      reason: 'MARGIN_BELOW_MIN',
      available: 4,
      error: null,
    });
  });

  it('404s a quote for an unknown channel', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(
      svc.quote('t', { productId: 'p', channelId: 'c' }),
    ).rejects.toThrow(/Channel c/);
  });

  it('quotes every channel and reports per-channel errors', async () => {
    const { svc, mock, pricing } = setup();
    mock.channel.findMany.mockResolvedValue([
      { id: 'c1', code: 'prestashop9' },
      { id: 'c2', code: 'temu-eu' },
    ]);
    pricing.quote
      .mockResolvedValueOnce(quote)
      .mockRejectedValueOnce(new Error('Product p has no cost'));
    const r = await svc.quoteAll('t', 'p');
    expect(r[0]).toMatchObject({
      channelId: 'c1',
      status: 'ok',
      reason: null,
      error: null,
    });
    expect(r[1]).toMatchObject({
      channelId: 'c2',
      net: null,
      available: null,
      error: 'Product p has no cost',
    });
  });
});
