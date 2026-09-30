import { StockCostSyncService } from './stock-cost-sync.service';
import { createMockDb, MockDb } from './testing/mock-db.types';
import type { ISourceConnector } from '@repo/connector-contracts';

describe('StockCostSyncService', () => {
  let mock: MockDb;
  let service: StockCostSyncService;
  let connector: { listAssortment: jest.Mock };
  let pricing: { quote: jest.Mock };
  let enqueuer: { enqueueProductUpdates: jest.Mock };
  let alerts: { raise: jest.Mock };

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'a1', supplierProductId: 'sp1', quantityLeft: 3, status: 'ACTIVE', sellingPriceAtSupplier: null,
    supplierProduct: { id: 'sp1', stock: 3, costPrice: '9.0000' },
    ...over,
  });
  const rawItem = (over: Record<string, unknown> = {}) => ({
    externalPortfolioId: 'PF1', code: 'AW1', quantityLeft: 3, price: '9.0000', status: 'active', ...over,
  });

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    connector = { listAssortment: jest.fn() };
    pricing = { quote: jest.fn().mockResolvedValue({ result: { status: 'ok' }, available: 1 }) };
    enqueuer = { enqueueProductUpdates: jest.fn().mockResolvedValue(undefined) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    mock.supplierAssortmentItem.findUnique.mockResolvedValue(item());
    mock.supplierAssortmentItem.update.mockResolvedValue({});
    mock.supplierProduct.update.mockResolvedValue({});
    mock.product.findMany.mockResolvedValue([{ id: 'p1' }]);
    mock.channelListing.findMany.mockResolvedValue([{ id: 'l1', channelId: 'c1', productId: 'p1' }]);
    mock.channelListing.update.mockResolvedValue({});
    service = new StockCostSyncService(m.db, connector as unknown as ISourceConnector, pricing as never, enqueuer, alerts);
  });

  it('writes stock and cost changes and enqueues only the changed products', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ quantityLeft: 5, price: '9.0000' })], nextCursor: null });
    const res = await service.run('t1', 's1');
    expect(mock.supplierAssortmentItem.findUnique.mock.calls[0][0].where).toEqual({
      tenantId_supplierId_externalPortfolioId: { tenantId: 't1', supplierId: 's1', externalPortfolioId: 'PF1' },
    });
    expect(mock.supplierProduct.update.mock.calls[0][0]).toMatchObject({ where: { id: 'sp1' }, data: { stock: 5 } });
    expect(mock.supplierAssortmentItem.update.mock.calls[0][0].data).toMatchObject({ quantityLeft: 5 });
    expect(mock.product.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', supplierProductId: { in: ['sp1'] } });
    expect(enqueuer.enqueueProductUpdates).toHaveBeenCalledWith('t1', ['p1']);
    expect(res.changedProductIds).toEqual(['p1']);
    expect(pricing.quote).not.toHaveBeenCalled();
  });

  it('does nothing for unchanged items and ignores non assortment items', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem()], nextCursor: null });
    const res = await service.run('t1', 's1');
    expect(mock.supplierProduct.update).not.toHaveBeenCalled();
    expect(enqueuer.enqueueProductUpdates).not.toHaveBeenCalled();
    expect(res.changedProductIds).toEqual([]);
    mock.supplierAssortmentItem.findUnique.mockResolvedValue(null);
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ externalPortfolioId: 'other' })], nextCursor: null });
    await service.run('t1', 's1');
    expect(mock.supplierProduct.update).not.toHaveBeenCalled();
  });

  it('pages through the assortment', async () => {
    connector.listAssortment
      .mockResolvedValueOnce({ items: [rawItem({ quantityLeft: 4 })], nextCursor: { page: 2 } })
      .mockResolvedValueOnce({ items: [rawItem({ quantityLeft: 6 })], nextCursor: null });
    await service.run('t1', 's1');
    expect(connector.listAssortment).toHaveBeenNthCalledWith(2, { page: 2 });
    expect(enqueuer.enqueueProductUpdates).toHaveBeenCalledTimes(1);
  });

  it('a disabled assortment status is a change', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ status: 'disabled' })], nextCursor: null });
    await service.run('t1', 's1');
    expect(mock.supplierAssortmentItem.update.mock.calls[0][0].data).toMatchObject({ status: 'DISABLED' });
    expect(enqueuer.enqueueProductUpdates).toHaveBeenCalledWith('t1', ['p1']);
  });

  it('a changed assortment selling price is stored', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ sellingPrice: '15.0000' })], nextCursor: null });
    await service.run('t1', 's1');
    expect(mock.supplierAssortmentItem.update.mock.calls[0][0].data).toMatchObject({ sellingPriceAtSupplier: '15.0000' });
  });

  it('a cost change that breaks the margin deactivates the listing and alerts', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ price: '12.0000' })], nextCursor: null });
    pricing.quote.mockResolvedValue({ result: { status: 'blocked', reason: 'MARGIN_BELOW_MIN' }, available: 0 });
    const res = await service.run('t1', 's1');
    expect(mock.supplierProduct.update.mock.calls[0][0].data).toMatchObject({ costPrice: '12.0000' });
    expect(pricing.quote).toHaveBeenCalledWith('t1', { productId: 'p1', channelId: 'c1' });
    expect(mock.channelListing.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', productId: { in: ['p1'] }, deletedAt: null, status: { not: 'INACTIVE' } });
    expect(mock.channelListing.update.mock.calls[0][0]).toMatchObject({ where: { id: 'l1' }, data: { status: 'INACTIVE', lastStock: 0 } });
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', type: 'margin_break', productId: 'p1', channelId: 'c1' }));
    expect(res.deactivatedListingIds).toEqual(['l1']);
  });

  it('keeps the listing active when the margin still holds', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ price: '9.5000' })], nextCursor: null });
    await service.run('t1', 's1');
    expect(mock.channelListing.update).not.toHaveBeenCalled();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('counts an item failure without aborting the run', async () => {
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ quantityLeft: 1 }), rawItem({ externalPortfolioId: 'PF2', quantityLeft: 2 })], nextCursor: null });
    mock.supplierAssortmentItem.findUnique.mockRejectedValueOnce(new Error('x')).mockResolvedValue(item());
    const res = await service.run('t1', 's1');
    expect(res.errors).toBe(1);
    expect(res.changedProductIds).toEqual(['p1']);
  });

  it('handles an assortment item with a null cost and stock', async () => {
    mock.supplierAssortmentItem.findUnique.mockResolvedValue(item({ quantityLeft: null, supplierProduct: { id: 'sp1', stock: 3, costPrice: null } }));
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ quantityLeft: undefined, price: undefined })], nextCursor: null });
    const res = await service.run('t1', 's1');
    expect(res.changedProductIds).toEqual([]);
    connector.listAssortment.mockResolvedValue({ items: [rawItem({ price: '9.0000' })], nextCursor: null });
    await service.run('t1', 's1');
    expect(pricing.quote).toHaveBeenCalled();
  });
});
