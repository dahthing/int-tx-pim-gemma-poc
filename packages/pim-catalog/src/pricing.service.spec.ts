import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { createMockDb, MockDb } from './testing/mock-db.types';

describe('PricingService', () => {
  let mock: MockDb;
  let service: PricingService;

  const product = (over: Record<string, unknown> = {}) => ({
    id: 'p1', categoryId: 'cat1', status: 'PUBLISHED',
    supplierProduct: { id: 'sp1', costPrice: '10.0000', stock: 20, status: 'ACTIVE' },
    ...over,
  });
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'r1', channelId: null, priority: 1, condition: {}, markupPct: '0.5', fixedAdd: null,
    rounding: 'X99', minMarginPct: '0.1', vatRate: '0.23', ...over,
  });

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    service = new PricingService(m.db);
    mock.product.findFirst.mockResolvedValue(product());
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'prestashop9', settings: {} });
    mock.priceRule.findMany.mockResolvedValue([rule()]);
    mock.supplierAssortmentItem.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    mock.channelListing.upsert.mockResolvedValue({});
    mock.auditEvent.create.mockResolvedValue({});
  });

  it('loads tenant scoped data and calculates price and available stock', async () => {
    const q = await service.quote('t1', { productId: 'p1', channelId: 'c1' });
    expect(mock.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: 't1' });
    expect(mock.channel.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'c1', tenantId: 't1' });
    expect(mock.priceRule.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', deletedAt: null, OR: [{ channelId: null }, { channelId: 'c1' }] });
    expect(q.result).toMatchObject({ status: 'ok', gross: '18.99', ruleId: 'r1' });
    expect(q.available).toBe(18);
  });

  it('blocks below minimum margin', async () => {
    mock.priceRule.findMany.mockResolvedValue([rule({ minMarginPct: '0.9' })]);
    const q = await service.quote('t1', { productId: 'p1', channelId: 'c1' });
    expect(q.result).toMatchObject({ status: 'blocked', reason: 'MARGIN_BELOW_MIN' });
  });

  it('falls back to the default rule and supports a cost override and other roundings', async () => {
    mock.priceRule.findMany.mockResolvedValue([]);
    const q = await service.quote('t1', { productId: 'p1', channelId: 'c1', cost: '20' });
    expect(q.result.ruleId).toBe('default');
    expect(q.result.gross).toBe('36.99');
    mock.priceRule.findMany.mockResolvedValue([rule({ rounding: 'X90' }), rule({ id: 'r2', priority: 5, rounding: 'NONE', fixedAdd: '1', condition: { category: 'cat1' } })]);
    const q2 = await service.quote('t1', { productId: 'p1', channelId: 'c1' });
    expect(q2.result.ruleId).toBe('r2');
  });

  it('applies channel settings (fee, shipping, buffer, cap) and temu default buffer', async () => {
    mock.channel.findFirst.mockResolvedValue({ id: 'c2', code: 'temu-eu', settings: {} });
    expect((await service.quote('t1', { productId: 'p1', channelId: 'c2' })).available).toBe(15);
    mock.channel.findFirst.mockResolvedValue({ id: 'c2', code: 'temu-eu', settings: { stockBuffer: 1, stockCap: 3, channelFeePct: '0.1', channelFeeFixed: '0.5', shippingAbsorbed: '2' } });
    const q = await service.quote('t1', { productId: 'p1', channelId: 'c2' });
    expect(q.available).toBe(3);
    expect(Number(q.result.marginPct)).toBeLessThan(0.3);
  });

  it('uses zero buffer for unknown channels and zero stock when unpublished/missing/disabled', async () => {
    mock.channel.findFirst.mockResolvedValue({ id: 'c3', code: 'other', settings: null });
    expect((await service.quote('t1', { productId: 'p1', channelId: 'c3' })).available).toBe(20);
    mock.product.findFirst.mockResolvedValue(product({ status: 'DRAFT' }));
    expect((await service.quote('t1', { productId: 'p1', channelId: 'c3' })).available).toBe(0);
    mock.product.findFirst.mockResolvedValue(product({ supplierProduct: { id: 'sp1', costPrice: '10', stock: 20, status: 'MISSING' } }));
    expect((await service.quote('t1', { productId: 'p1', channelId: 'c3' })).available).toBe(0);
    mock.product.findFirst.mockResolvedValue(product());
    mock.supplierAssortmentItem.findFirst.mockResolvedValue(null);
    expect((await service.quote('t1', { productId: 'p1', channelId: 'c3' })).available).toBe(0);
  });

  it('throws when product, channel or cost is missing', async () => {
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.quote('t1', { productId: 'p1', channelId: 'c1' })).rejects.toBeInstanceOf(NotFoundException);
    mock.product.findFirst.mockResolvedValue(product());
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(service.quote('t1', { productId: 'p1', channelId: 'c1' })).rejects.toBeInstanceOf(NotFoundException);
    mock.channel.findFirst.mockResolvedValue({ id: 'c1', code: 'prestashop9', settings: {} });
    mock.product.findFirst.mockResolvedValue(product({ supplierProduct: null }));
    await expect(service.quote('t1', { productId: 'p1', channelId: 'c1' })).rejects.toBeInstanceOf(BadRequestException);
    mock.product.findFirst.mockResolvedValue(product({ supplierProduct: { id: 'x', costPrice: null, stock: 1, status: 'ACTIVE' } }));
    await expect(service.quote('t1', { productId: 'p1', channelId: 'c1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists an ok price to the listing', async () => {
    const out = await service.applyToListing('t1', { productId: 'p1', channelId: 'c1' });
    expect(out.sent).toBe(true);
    expect(mock.channelListing.upsert.mock.calls[0][0]).toMatchObject({
      where: { productId_channelId: { productId: 'p1', channelId: 'c1' } },
      update: { lastPrice: '18.99', lastStock: 18 },
      create: { tenantId: 't1', productId: 'p1', channelId: 'c1', lastPrice: '18.99', lastStock: 18 },
    });
    expect(mock.auditEvent.create).not.toHaveBeenCalled();
  });

  it('never persists a blocked price', async () => {
    mock.priceRule.findMany.mockResolvedValue([rule({ minMarginPct: '0.9' })]);
    const out = await service.applyToListing('t1', { productId: 'p1', channelId: 'c1' });
    expect(out).toMatchObject({ sent: false, reason: 'MARGIN_BELOW_MIN' });
    expect(mock.channelListing.upsert).not.toHaveBeenCalled();
  });

  it('a non forced override below margin stays blocked', async () => {
    const out = await service.applyToListing('t1', { productId: 'p1', channelId: 'c1', override: { gross: '10.50' } });
    expect(out.sent).toBe(false);
  });

  it('a forced override is persisted and audited, and needs an actor', async () => {
    const input = { productId: 'p1', channelId: 'c1', override: { gross: '10.50', force: true } };
    await expect(service.applyToListing('t1', input)).rejects.toBeInstanceOf(BadRequestException);
    const out = await service.applyToListing('t1', { ...input, actor: 'user-9' });
    expect(out.sent).toBe(true);
    expect(mock.channelListing.upsert.mock.calls[0][0].update.lastPrice).toBe('10.50');
    expect(mock.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1', actor: 'user-9', entity: 'Product', entityId: 'p1', action: 'price.force_override',
      diff: expect.objectContaining({ channelId: 'c1', gross: '10.50', marginPct: expect.any(String) }),
    });
  });
});
