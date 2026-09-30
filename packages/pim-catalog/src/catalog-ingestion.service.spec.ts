import { CatalogIngestionService } from './catalog-ingestion.service';
import { createMockDb, MockDb } from './testing/mock-db.types';
import type { ISourceConnector, SupplierProductRaw } from '@repo/connector-contracts';

const raw = (over: Partial<SupplierProductRaw> = {}): SupplierProductRaw => ({
  externalId: 'E1',
  code: 'AW1',
  name: 'Rose Quartz',
  description: 'desc',
  ean: '123',
  departmentName: 'Crystals',
  subDepartmentName: 'Quartz',
  familyName: 'Rose',
  costPrice: '10.0000',
  currency: 'EUR',
  stock: 5,
  grossWeightG: 100,
  imageMainUrl: 'http://img/1.jpg',
  rawPayload: { a: 1 },
  ...over,
});

describe('CatalogIngestionService', () => {
  let mock: MockDb;
  let service: CatalogIngestionService;
  let connector: { code: string; listCatalog: jest.Mock };
  let zeroer: { zeroStock: jest.Mock };

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    connector = { code: 'aw-aiku', listCatalog: jest.fn() };
    zeroer = { zeroStock: jest.fn().mockResolvedValue(undefined) };
    mock.syncRun.create.mockResolvedValue({ id: 'run1' });
    mock.syncRun.update.mockResolvedValue({});
    mock.supplierProduct.findUnique.mockResolvedValue(null);
    mock.supplierProduct.create.mockResolvedValue({});
    mock.supplierProduct.update.mockResolvedValue({});
    mock.supplierProduct.findMany.mockResolvedValue([]);
    mock.supplierProduct.updateMany.mockResolvedValue({ count: 0 });
    mock.product.findMany.mockResolvedValue([]);
    mock.product.update.mockResolvedValue({});
    service = new CatalogIngestionService(m.db, connector as unknown as ISourceConnector, zeroer);
  });

  const lastCounters = () => mock.syncRun.update.mock.calls.at(-1)![0].data;

  it('creates new products tenant scoped and counts them', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw()], nextCursor: null });
    const res = await service.runFullSync('t1', 's1');
    expect(mock.syncRun.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', connector: 'aw-aiku', kind: 'aw.catalog.full' });
    expect(mock.supplierProduct.findUnique.mock.calls[0][0].where).toEqual({
      tenantId_supplierId_externalId: { tenantId: 't1', supplierId: 's1', externalId: 'E1' },
    });
    const data = mock.supplierProduct.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't1', supplierId: 's1', externalId: 'E1', name: 'Rose Quartz', costPrice: '10.0000', stock: 5 });
    expect(data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.status).toBe('SUCCEEDED');
    expect(res.counters).toMatchObject({ seen: 1, created: 1, content_changed: 0, price_changed: 0, stock_changed: 0, missing: 0, errors: 0 });
    expect(lastCounters()).toMatchObject({ status: 'SUCCEEDED', counters: res.counters });
  });

  it('second identical run creates nothing and writes no content', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw()], nextCursor: null });
    await service.runFullSync('t1', 's1');
    const created = mock.supplierProduct.create.mock.calls[0][0].data;
    mock.supplierProduct.findUnique.mockResolvedValue({ id: 'sp1', ...created });
    mock.supplierProduct.create.mockClear();
    const res = await service.runFullSync('t1', 's1');
    expect(res.counters).toMatchObject({ seen: 1, created: 0, content_changed: 0, price_changed: 0, stock_changed: 0 });
    expect(mock.supplierProduct.create).not.toHaveBeenCalled();
    const upd = mock.supplierProduct.update.mock.calls[0][0].data;
    expect(Object.keys(upd).sort()).toEqual(['lastSeenAt', 'status']);
  });

  it('detects content, price and stock changes separately', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw()], nextCursor: null });
    await service.runFullSync('t1', 's1');
    const created = mock.supplierProduct.create.mock.calls[0][0].data;
    mock.supplierProduct.findUnique.mockResolvedValue({ id: 'sp1', ...created });
    connector.listCatalog.mockResolvedValue({ items: [raw({ name: 'New', costPrice: '11', stock: 9 })], nextCursor: null });
    const res = await service.runFullSync('t1', 's1');
    expect(res.counters).toMatchObject({ content_changed: 1, price_changed: 1, stock_changed: 1, created: 0 });
    expect(mock.supplierProduct.update.mock.calls[0][0].where).toEqual({ id: 'sp1' });
    expect(mock.supplierProduct.update.mock.calls[0][0].data).toMatchObject({ name: 'New', costPrice: '11', stock: 9 });
  });

  it('follows pagination cursors', async () => {
    connector.listCatalog
      .mockResolvedValueOnce({ items: [raw()], nextCursor: { page: 2 } })
      .mockResolvedValueOnce({ items: [raw({ externalId: 'E2' })], nextCursor: null });
    const res = await service.runFullSync('t1', 's1');
    expect(connector.listCatalog).toHaveBeenNthCalledWith(1, undefined);
    expect(connector.listCatalog).toHaveBeenNthCalledWith(2, { page: 2 });
    expect(res.counters.seen).toBe(2);
  });

  it('marks unseen products MISSING on a complete run and zeroes linked listings', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw()], nextCursor: null });
    mock.supplierProduct.findMany.mockResolvedValue([{ id: 'spX' }]);
    mock.supplierProduct.updateMany.mockResolvedValue({ count: 1 });
    mock.product.findMany.mockResolvedValue([{ id: 'p1', attributes: { keep: 1 } }]);
    const res = await service.runFullSync('t1', 's1');
    expect(mock.supplierProduct.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 't1', supplierId: 's1', status: 'ACTIVE', externalId: { notIn: ['E1'] },
    });
    expect(mock.supplierProduct.updateMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', id: { in: ['spX'] } }, data: { status: 'MISSING' } });
    expect(mock.product.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', supplierProductId: { in: ['spX'] } });
    expect(mock.product.update.mock.calls[0][0]).toMatchObject({ where: { id: 'p1' }, data: { attributes: { keep: 1, supplierMissing: true } } });
    expect(zeroer.zeroStock).toHaveBeenCalledWith('t1', ['p1']);
    expect(res.counters.missing).toBe(1);
  });

  it('does not call the zeroer when missing products have no linked product', async () => {
    connector.listCatalog.mockResolvedValue({ items: [], nextCursor: null });
    mock.supplierProduct.findMany.mockResolvedValue([{ id: 'spX' }]);
    await service.runFullSync('t1', 's1');
    expect(zeroer.zeroStock).not.toHaveBeenCalled();
  });

  it('skips the missing step when nothing is unseen', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw()], nextCursor: null });
    await service.runFullSync('t1', 's1');
    expect(mock.supplierProduct.updateMany).not.toHaveBeenCalled();
  });

  it('a failed later page makes the run PARTIAL, records the page and never marks missing', async () => {
    connector.listCatalog
      .mockResolvedValueOnce({ items: [raw()], nextCursor: { page: 2 } })
      .mockRejectedValueOnce(new Error('boom'));
    const res = await service.runFullSync('t1', 's1');
    expect(res.status).toBe('PARTIAL');
    expect(res.counters).toMatchObject({ seen: 1, failed_page: 2 });
    expect(mock.supplierProduct.findMany).not.toHaveBeenCalled();
    expect(lastCounters()).toMatchObject({ status: 'PARTIAL', errorSummary: expect.stringContaining('page 2') });
  });

  it('a failure on the first page with nothing seen is FAILED (page 1)', async () => {
    connector.listCatalog.mockRejectedValue(new Error('down'));
    const res = await service.runFullSync('t1', 's1');
    expect(res.status).toBe('FAILED');
    expect(res.counters.failed_page).toBe(1);
  });

  it('counts per-item errors and keeps going', async () => {
    connector.listCatalog.mockResolvedValue({ items: [raw(), raw({ externalId: 'E2' })], nextCursor: null });
    mock.supplierProduct.findUnique.mockRejectedValueOnce(new Error('db')).mockResolvedValue(null);
    const res = await service.runFullSync('t1', 's1');
    expect(res.counters).toMatchObject({ seen: 2, errors: 1, created: 1 });
    expect(res.status).toBe('SUCCEEDED');
  });

  it('handles sparse raw fields and a previously missing product coming back', async () => {
    connector.listCatalog.mockResolvedValue({
      items: [raw({ description: null, ean: null, departmentName: null, subDepartmentName: null, familyName: null, grossWeightG: null, imageMainUrl: null })],
      nextCursor: null,
    });
    await service.runFullSync('t1', 's1');
    const created = mock.supplierProduct.create.mock.calls[0][0].data;
    mock.supplierProduct.findUnique.mockResolvedValue({ id: 'sp1', ...created, status: 'MISSING' });
    await service.runFullSync('t1', 's1');
    expect(mock.supplierProduct.update.mock.calls[0][0].data.status).toBe('ACTIVE');
  });
});
