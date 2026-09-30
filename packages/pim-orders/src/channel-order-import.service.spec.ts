import { NotFoundException } from '@nestjs/common';
import type { ChannelOrderRaw } from '@repo/connector-contracts';
import { decryptSecret } from '@repo/core-domain';
import { ChannelOrderImportService } from './channel-order-import.service';
import { decodeOrderLines } from './order-lines.codec';
import { asDb, createDbMock, keyProvider, PII, TENANT, TEST_KEY, type DbMock } from './testing/testing';

const order = (id: string, over: Partial<ChannelOrderRaw> = {}): ChannelOrderRaw => ({
  externalId: id,
  externalStatus: 'paid',
  placedAt: new Date('2026-09-01T10:00:00.000Z'),
  currency: 'EUR',
  total: '123.45',
  shipByAt: null,
  customer: PII.customer,
  shippingAddress: PII.shippingAddress,
  lines: [{ sku: 'SKU1', quantity: 2 }],
  ...over,
});

describe('ChannelOrderImportService', () => {
  let db: DbMock;
  let connector: { listOrdersSince: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let enqueuer: { enqueueRouting: jest.Mock };
  let svc: ChannelOrderImportService;
  const channel = { id: 'ch1', tenantId: TENANT, code: 'prestashop9', settings: { keep: 1 } };

  beforeEach(() => {
    db = createDbMock();
    connector = { listOrdersSince: jest.fn() };
    resolver = { resolve: jest.fn().mockResolvedValue(connector) };
    enqueuer = { enqueueRouting: jest.fn().mockResolvedValue(undefined) };
    db.channel.findFirst.mockResolvedValue(channel);
    db.channelOrder.findUnique.mockResolvedValue(null);
    db.channelOrder.create.mockImplementation(async ({ data }) => ({ id: `id-${data.externalId}`, ...data }));
    db.product.findMany.mockResolvedValue([{ sku: 'SKU1' }]);
    connector.listOrdersSince.mockResolvedValue({ items: [order('E1')], nextCursor: null });
    svc = new ChannelOrderImportService(asDb(db), resolver, keyProvider, enqueuer);
  });

  it('throws NotFound for an unknown / foreign channel (tenant scoped lookup)', async () => {
    db.channel.findFirst.mockResolvedValue(null);
    await expect(svc.importChannel(TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.channel.findFirst).toHaveBeenCalledWith({ where: { id: 'nope', tenantId: TENANT, deletedAt: null } });
  });

  it('polls from epoch when there is no cursor and persists the newest placedAt', async () => {
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(connector.listOrdersSince).toHaveBeenCalledWith(new Date('1970-01-01T00:00:00.000Z'), undefined);
    expect(db.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { settings: { keep: 1, orderPollCursor: '2026-09-01T10:00:00.000Z' } },
    });
    expect(res).toMatchObject({ fetched: 1, imported: 1, manualReview: 0, duplicates: 0, failed: 0 });
  });

  it('polls from the persisted cursor and follows pagination', async () => {
    db.channel.findFirst.mockResolvedValue({ ...channel, settings: { orderPollCursor: '2026-08-31T00:00:00.000Z' } });
    connector.listOrdersSince
      .mockResolvedValueOnce({ items: [order('E1')], nextCursor: { page: 2 } })
      .mockResolvedValueOnce({ items: [order('E2', { placedAt: new Date('2026-09-02T00:00:00.000Z') })], nextCursor: null });
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(connector.listOrdersSince).toHaveBeenNthCalledWith(1, new Date('2026-08-31T00:00:00.000Z'), undefined);
    expect(connector.listOrdersSince).toHaveBeenNthCalledWith(2, new Date('2026-08-31T00:00:00.000Z'), { page: 2 });
    expect(res.imported).toBe(2);
    expect(db.channel.update.mock.calls.at(-1)![0].data.settings.orderPollCursor).toBe('2026-09-02T00:00:00.000Z');
  });

  it('does not touch the cursor when nothing was fetched', async () => {
    connector.listOrdersSince.mockResolvedValue({ items: [], nextCursor: null });
    await svc.importChannel(TENANT, 'ch1');
    expect(db.channel.update).not.toHaveBeenCalled();
  });

  it('imports an eligible order as IMPORTED with encrypted PII and enqueues routing', async () => {
    connector.listOrdersSince.mockResolvedValue({
      items: [order('E1', { shipByAt: new Date('2026-09-05T12:00:00.000Z') })],
      nextCursor: null,
    });
    await svc.importChannel(TENANT, 'ch1');
    const data = db.channelOrder.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: TENANT,
      channelId: 'ch1',
      externalId: 'E1',
      internalStatus: 'IMPORTED',
      totalGross: '123.45',
      currency: 'EUR',
    });
    expect(typeof data.customer).toBe('string');
    expect(JSON.parse(decryptSecret(data.customer, TEST_KEY))).toEqual(PII.customer);
    expect(JSON.parse(decryptSecret(data.shippingAddress, TEST_KEY))).toEqual(PII.shippingAddress);
    expect(JSON.stringify(data)).not.toContain('Maria');
    expect(JSON.stringify(data)).not.toContain('Rua A');
    const lines = decodeOrderLines(data.lines);
    expect(lines.items).toEqual([{ sku: 'SKU1', quantity: 2 }]);
    expect(lines.shipByAt).toEqual(new Date('2026-09-05T12:00:00.000Z'));
    expect(enqueuer.enqueueRouting).toHaveBeenCalledWith({ tenantId: TENANT, channelOrderId: 'id-E1' });
    expect(keyProvider.getKey).toHaveBeenCalledWith(TENANT);
  });

  it('is idempotent on (channel, externalId): existing orders are skipped', async () => {
    db.channelOrder.findUnique.mockResolvedValue({ id: 'existing' });
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(db.channelOrder.findUnique).toHaveBeenCalledWith({ where: { channelId_externalId: { channelId: 'ch1', externalId: 'E1' } } });
    expect(db.channelOrder.create).not.toHaveBeenCalled();
    expect(enqueuer.enqueueRouting).not.toHaveBeenCalled();
    expect(res.duplicates).toBe(1);
  });

  it('treats a unique violation race as a duplicate', async () => {
    db.channelOrder.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(res.duplicates).toBe(1);
    expect(res.failed).toBe(0);
    expect(enqueuer.enqueueRouting).not.toHaveBeenCalled();
  });

  it('flags connector manualReview (unknown sku) as MANUAL_REVIEW and does not route', async () => {
    connector.listOrdersSince.mockResolvedValue({
      items: [order('E1', { manualReview: { reason: 'unknown_sku', unknownSkus: ['X'] } })],
      nextCursor: null,
    });
    const res = await svc.importChannel(TENANT, 'ch1');
    const data = db.channelOrder.create.mock.calls[0][0].data;
    expect(data.internalStatus).toBe('MANUAL_REVIEW');
    expect(decodeOrderLines(data.lines).manualReviewReason).toBe('unknown_sku');
    expect(enqueuer.enqueueRouting).not.toHaveBeenCalled();
    expect(res.manualReview).toBe(1);
  });

  it('flags lines whose SKU is not in the PIM (tenant scoped lookup) as MANUAL_REVIEW', async () => {
    db.product.findMany.mockResolvedValue([]);
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, deletedAt: null, sku: { in: ['SKU1'] } },
      select: { sku: true },
    });
    expect(db.channelOrder.create.mock.calls[0][0].data.internalStatus).toBe('MANUAL_REVIEW');
    expect(enqueuer.enqueueRouting).not.toHaveBeenCalled();
    expect(res.manualReview).toBe(1);
  });

  it('keeps the order IMPORTED and reports when enqueueing fails', async () => {
    enqueuer.enqueueRouting.mockRejectedValue(new Error('redis down'));
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(res).toMatchObject({ imported: 1, enqueueFailed: 1, failed: 0 });
  });

  it('continues after a persistence failure and does not advance the cursor', async () => {
    connector.listOrdersSince.mockResolvedValue({ items: [order('E1'), order('E2')], nextCursor: null });
    db.channelOrder.create.mockRejectedValueOnce(new Error('db down')).mockImplementation(async ({ data }) => ({ id: 'x', ...data }));
    const res = await svc.importChannel(TENANT, 'ch1');
    expect(res).toMatchObject({ fetched: 2, imported: 1, failed: 1 });
    expect(db.channel.update).not.toHaveBeenCalled();
  });
});
