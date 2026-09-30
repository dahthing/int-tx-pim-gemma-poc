import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoryMappingService } from './category-mapping.service';
import { createMockDb, MockDb } from './testing/mock-db.types';

describe('CategoryMappingService', () => {
  let mock: MockDb;
  let service: CategoryMappingService;

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    service = new CategoryMappingService(m.db);
    mock.categoryMapping.updateMany.mockResolvedValue({ count: 0 });
    mock.categoryMapping.create.mockResolvedValue({});
    mock.categoryMapping.findFirst.mockResolvedValue(null);
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'temu-eu', settings: {} });
    mock.channel.update.mockResolvedValue({});
  });

  it('maps a supplier path to an internal category and channel categories, superseding old rows', async () => {
    await service.mapSupplierPath('t1', {
      department: 'Cristais', subDepartment: 'Quartzo', family: 'Rosa', categoryId: 'cat1',
      channels: [{ channelId: 'c1', channelCategoryId: '555' }, { channelId: 'c2', channelCategoryId: '12' }],
    });
    expect(mock.categoryMapping.updateMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't1', normalizedKey: 'cristais>quartzo>rosa', supersededAt: null },
    });
    expect(mock.categoryMapping.updateMany.mock.calls[0][0].data.supersededAt).toBeInstanceOf(Date);
    const creates = mock.categoryMapping.create.mock.calls.map((c) => c[0].data);
    expect(creates).toHaveLength(3);
    expect(creates[0]).toMatchObject({ tenantId: 't1', categoryId: 'cat1', channelId: null, normalizedKey: 'cristais>quartzo>rosa', supplierDepartment: 'Cristais' });
    expect(creates[1]).toMatchObject({ channelId: 'c1', channelCategoryId: '555' });
    expect(creates[2]).toMatchObject({ channelId: 'c2', channelCategoryId: '12' });
  });

  it('maps without channels', async () => {
    await service.mapSupplierPath('t1', { department: 'A', categoryId: 'cat1' });
    expect(mock.categoryMapping.create).toHaveBeenCalledTimes(1);
  });

  it('resolves the internal category of a supplier path, or null', async () => {
    mock.categoryMapping.findFirst.mockResolvedValueOnce({ categoryId: 'cat1' });
    expect(await service.resolveCategoryId('t1', 'Cristais', 'Quartzo', 'Rosa')).toBe('cat1');
    expect(mock.categoryMapping.findFirst.mock.calls[0][0].where).toEqual({ tenantId: 't1', normalizedKey: 'cristais>quartzo>rosa', channelId: null, supersededAt: null });
    expect(await service.resolveCategoryId('t1', 'X', null, null)).toBeNull();
  });

  it('stores mandatory attributes per channel category in the channel settings', async () => {
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'temu-eu', settings: { other: 1, categoryAttributes: { '1': ['a'] } } });
    await service.setMandatoryAttributes('t1', 'c1', '555', ['material', 'color']);
    expect(mock.channel.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'c1', tenantId: 't1' });
    expect(mock.channel.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'c1' },
      data: { settings: { other: 1, categoryAttributes: { '1': ['a'], '555': ['material', 'color'] } } },
    });
  });

  it('setMandatoryAttributes handles empty settings and unknown channels', async () => {
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'temu-eu', settings: null });
    await service.setMandatoryAttributes('t1', 'c1', '5', ['x']);
    expect(mock.channel.update.mock.calls[0][0].data.settings).toEqual({ categoryAttributes: { '5': ['x'] } });
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(service.setMandatoryAttributes('t1', 'zz', '5', [])).rejects.toBeInstanceOf(NotFoundException);
  });

  const readiness = async (product: unknown, mapping: unknown, settings: unknown) => {
    mock.product.findFirst.mockResolvedValue(product);
    mock.categoryMapping.findFirst.mockResolvedValue(mapping);
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'temu-eu', settings });
    return service.validatePublishReadiness('t1', 'p1', 'c1');
  };

  it('is ready when mapping and mandatory attributes exist', async () => {
    const r = await readiness({ id: 'p1', categoryId: 'cat1', attributes: { material: 'quartz' } }, { channelCategoryId: '555' }, { categoryAttributes: { '555': ['material'] } });
    expect(r).toEqual({ ready: true, missing: [] });
    expect(mock.categoryMapping.findFirst.mock.calls.at(-1)![0].where).toMatchObject({ tenantId: 't1', categoryId: 'cat1', channelId: 'c1', supersededAt: null, channelCategoryId: { not: null } });
  });

  it('lists a missing category', async () => {
    const r = await readiness({ id: 'p1', categoryId: null, attributes: {} }, null, {});
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([{ type: 'category', name: 'category' }]);
  });

  it('lists a missing channel category mapping', async () => {
    const r = await readiness({ id: 'p1', categoryId: 'cat1', attributes: {} }, null, {});
    expect(r.missing).toEqual([{ type: 'category_mapping', name: 'temu-eu' }]);
  });

  it('lists missing or empty mandatory attributes', async () => {
    const r = await readiness({ id: 'p1', categoryId: 'cat1', attributes: { material: '', color: 'red' } }, { channelCategoryId: '555' }, { categoryAttributes: { '555': ['material', 'color', 'size'] } });
    expect(r.missing).toEqual([{ type: 'mandatory_attribute', name: 'material' }, { type: 'mandatory_attribute', name: 'size' }]);
  });

  it('tolerates null attributes and settings without a mandatory list', async () => {
    const r = await readiness({ id: 'p1', categoryId: 'cat1', attributes: null }, { channelCategoryId: '9' }, null);
    expect(r.ready).toBe(true);
  });

  it('throws for unknown product or channel; assertPublishable throws listing what is missing', async () => {
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.validatePublishReadiness('t1', 'p1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
    mock.product.findFirst.mockResolvedValue({ id: 'p1', categoryId: 'cat1', attributes: {} });
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(service.validatePublishReadiness('t1', 'p1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'temu-eu', settings: {} });
    await expect(service.assertPublishable('t1', 'p1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    mock.categoryMapping.findFirst.mockResolvedValue({ channelCategoryId: '1' });
    await expect(service.assertPublishable('t1', 'p1', 'c1')).resolves.toBeUndefined();
  });
});
