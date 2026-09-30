import { NotFoundException } from '@nestjs/common';
import { CurationService } from './curation.service';
import { createMockDb, MockDb } from './testing/mock-db.types';
import type { ISourceConnector } from '@repo/connector-contracts';

describe('CurationService', () => {
  let mock: MockDb;
  let service: CurationService;
  let connector: { addToAssortment: jest.Mock; removeFromAssortment: jest.Mock };
  let mapping: { resolveCategoryId: jest.Mock };

  const sp = {
    id: 'sp1', externalId: 'E1', code: 'AW1', ean: '123', name: 'Rose Quartz', grossWeightG: 200,
    department: 'Crystals', subDepartment: 'Quartz', family: 'Rose',
  };

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    connector = {
      addToAssortment: jest.fn().mockResolvedValue({ externalPortfolioId: 'PF1', code: 'AW1', status: 'active', quantityLeft: 4, sellingPrice: '12.00' }),
      removeFromAssortment: jest.fn().mockResolvedValue(undefined),
    };
    mapping = { resolveCategoryId: jest.fn().mockResolvedValue('cat1') };
    mock.supplierProduct.findFirst.mockResolvedValue(sp);
    mock.supplierAssortmentItem.findFirst.mockResolvedValue(null);
    mock.supplierAssortmentItem.create.mockResolvedValue({});
    mock.product.findUnique.mockResolvedValue(null);
    mock.product.create.mockResolvedValue({ id: 'p1' });
    mock.product.update.mockResolvedValue({ id: 'p1' });
    service = new CurationService(m.db, connector as unknown as ISourceConnector, mapping as never);
  });

  it('adds to Gemma: connector call, assortment item and DRAFT product with defaults', async () => {
    const res = await service.addToGemma('t1', 's1', ['sp1']);
    expect(mock.supplierProduct.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'sp1', tenantId: 't1', supplierId: 's1' });
    expect(connector.addToAssortment).toHaveBeenCalledWith('E1');
    expect(mock.supplierAssortmentItem.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1', supplierId: 's1', supplierProductId: 'sp1', externalPortfolioId: 'PF1', sellingPriceAtSupplier: '12.00', quantityLeft: 4,
    });
    expect(mapping.resolveCategoryId).toHaveBeenCalledWith('t1', 'Crystals', 'Quartz', 'Rose');
    expect(mock.product.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1', sku: 'AW1', ean: '123', supplierProductId: 'sp1', titlePt: 'Rose Quartz', weightG: 200, status: 'DRAFT', categoryId: 'cat1',
    });
    expect(res).toEqual([{ supplierProductId: 'sp1', ok: true, productId: 'p1' }]);
  });

  it('falls back to the external id as sku and no category when unmapped', async () => {
    mock.supplierProduct.findFirst.mockResolvedValue({ ...sp, code: null });
    mapping.resolveCategoryId.mockResolvedValue(null);
    await service.addToGemma('t1', 's1', ['sp1']);
    const data = mock.product.create.mock.calls[0][0].data;
    expect(data.sku).toBe('E1');
    expect(data.categoryId).toBeUndefined();
  });

  it('skips products already in the assortment', async () => {
    mock.supplierAssortmentItem.findFirst.mockResolvedValue({ id: 'a1' });
    const res = await service.addToGemma('t1', 's1', ['sp1']);
    expect(connector.addToAssortment).not.toHaveBeenCalled();
    expect(res[0]).toMatchObject({ ok: true, skipped: true });
  });

  it('revives an archived product with the same sku', async () => {
    mock.product.findUnique.mockResolvedValue({ id: 'p9' });
    const res = await service.addToGemma('t1', 's1', ['sp1']);
    expect(mock.product.findUnique.mock.calls[0][0].where).toEqual({ tenantId_sku: { tenantId: 't1', sku: 'AW1' } });
    expect(mock.product.update.mock.calls[0][0]).toMatchObject({ where: { id: 'p9' }, data: { status: 'DRAFT', deletedAt: null, supplierProductId: 'sp1' } });
    expect(mock.product.create).not.toHaveBeenCalled();
    expect(res[0]?.productId).toBe('p9');
  });

  it('reports unknown products and connector failures per item without writing', async () => {
    mock.supplierProduct.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(sp);
    connector.addToAssortment.mockRejectedValueOnce(new Error('aw down'));
    const res = await service.addToGemma('t1', 's1', ['nope', 'sp1']);
    expect(res[0]).toMatchObject({ supplierProductId: 'nope', ok: false });
    expect(res[1]).toMatchObject({ supplierProductId: 'sp1', ok: false, error: 'aw down' });
    expect(mock.supplierAssortmentItem.create).not.toHaveBeenCalled();
    expect(mock.product.create).not.toHaveBeenCalled();
  });

  it('removes from Gemma: portfolio, archive, deactivate listings', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', supplierProductId: 'sp1' });
    mock.supplierAssortmentItem.findFirst.mockResolvedValue({ id: 'a1', externalPortfolioId: 'PF1' });
    mock.supplierAssortmentItem.delete.mockResolvedValue({});
    mock.channelListing.updateMany.mockResolvedValue({ count: 2 });
    await service.removeFromGemma('t1', 's1', 'p1');
    expect(mock.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: 't1' });
    expect(connector.removeFromAssortment).toHaveBeenCalledWith('PF1');
    expect(mock.supplierAssortmentItem.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(mock.product.update.mock.calls[0][0]).toMatchObject({ where: { id: 'p1' }, data: { status: 'ARCHIVED' } });
    expect(mock.channelListing.updateMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', productId: 'p1' }, data: { status: 'INACTIVE', lastStock: 0 },
    });
  });

  it('removes a product that has no assortment item without calling the connector', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', supplierProductId: null });
    mock.channelListing.updateMany.mockResolvedValue({ count: 0 });
    await service.removeFromGemma('t1', 's1', 'p1');
    expect(connector.removeFromAssortment).not.toHaveBeenCalled();
    expect(mock.product.update).toHaveBeenCalled();
  });

  it('throws NotFound for an unknown product and does not touch anything', async () => {
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.removeFromGemma('t1', 's1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(connector.removeFromAssortment).not.toHaveBeenCalled();
  });

  it('does not archive when the connector removal fails', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', supplierProductId: 'sp1' });
    mock.supplierAssortmentItem.findFirst.mockResolvedValue({ id: 'a1', externalPortfolioId: 'PF1' });
    connector.removeFromAssortment.mockRejectedValue(new Error('aw'));
    await expect(service.removeFromGemma('t1', 's1', 'p1')).rejects.toThrow('aw');
    expect(mock.product.update).not.toHaveBeenCalled();
  });
});
