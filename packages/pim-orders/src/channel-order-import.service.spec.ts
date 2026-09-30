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
  let cancellation: { handleChannelCancellation: jest.Mock };
  let shipments: { markDelivered: jest.Mock };
  let states: { canReach: jest.Mock };
  let svc: ChannelOrderImportService;
  const channel = { id: 'ch1', tenantId: TENANT, code: 'prestashop9', settings: { keep: 1 } };

  beforeEach(() => {
    db = createDbMock();
    connector = { listOrdersSince: jest.fn() };
    resolver = { resolve: jest.fn().mockResolvedValue(connector) };
    enqueuer = { enqueueRouting: jest.fn().mockResolvedValue(undefined) };
    cancellation = { handleChannelCancellation: jest.fn().mockResolvedValue({ action: 'cancel' }) };
    shipments = { markDelivered: jest.fn().mockResolvedValue(undefined) };
    states = { canReach: jest.fn().mockReturnValue(true) };
    db.channelOrder.update.mockResolvedValue({});
    db.channel.findFirst.mockResolvedValue(channel);
    db.channelOrder.findUnique.mockResolvedValue(null);
    db.channelOrder.create.mockImplementation(async ({ data }) => ({ id: `id-${data.externalId}`, ...data }));
    db.product.findMany.mockResolvedValue([{ sku: 'SKU1' }]);
    connector.listOrdersSince.mockResolvedValue({ items: [order('E1')], nextCursor: null });
    svc = new ChannelOrderImportService(asDb(db), resolver, keyProvider, enqueuer, cancellation as never, shipments as never, states as never);
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
  describe('channel status changes of known orders', () => {
    const known = (over: Record<string, unknown> = {}) => ({ id: 'co1', externalId: 'E1', externalStatus: '2', internalStatus: 'SUPPLIER_SUBMITTED', ...over });

    it('FR-ORD-001 AC2: a known order whose external status became cancelled goes through the cancellation service', async () => {
      db.channelOrder.findUnique.mockResolvedValue(known());
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '6' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(cancellation.handleChannelCancellation).toHaveBeenCalledWith(TENANT, 'co1');
      expect(db.channelOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { externalStatus: '6' } });
      expect(db.channelOrder.create).not.toHaveBeenCalled();
      expect(res).toMatchObject({ fetched: 1, cancelled: 1, duplicates: 0, imported: 0, failed: 0 });
    });

    it('uses the Temu defaults and channel settings overrides', async () => {
      db.channel.findFirst.mockResolvedValue({ ...channel, code: 'temu-eu', settings: {} });
      db.channelOrder.findUnique.mockResolvedValue(known({ externalStatus: 'AWAITING_SHIPMENT' }));
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: 'CANCELLED' })], nextCursor: null });
      await svc.importChannel(TENANT, 'ch1');
      expect(cancellation.handleChannelCancellation).toHaveBeenCalledTimes(1);

      cancellation.handleChannelCancellation.mockClear();
      db.channel.findFirst.mockResolvedValue({ ...channel, settings: { cancelledStatuses: ['99'] } });
      db.channelOrder.findUnique.mockResolvedValue(known());
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '99' })], nextCursor: null });
      await svc.importChannel(TENANT, 'ch1');
      expect(cancellation.handleChannelCancellation).toHaveBeenCalledTimes(1);
    });

    it('does not re-handle a cancellation whose status is already stored', async () => {
      db.channelOrder.findUnique.mockResolvedValue(known({ externalStatus: '6', internalStatus: 'MANUAL_REVIEW' }));
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '6' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(cancellation.handleChannelCancellation).not.toHaveBeenCalled();
      expect(db.channelOrder.update).not.toHaveBeenCalled();
      expect(res.duplicates).toBe(1);
    });

    it('keeps the stored status and fails the item (cursor not advanced) when the cancellation throws, so the next poll retries', async () => {
      db.channelOrder.findUnique.mockResolvedValue(known());
      cancellation.handleChannelCancellation.mockRejectedValue(new Error('aw down'));
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '6' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(res.failed).toBe(1);
      expect(db.channelOrder.update).not.toHaveBeenCalled();
      expect(db.channel.update).not.toHaveBeenCalled();
    });

    it('FR-TEMU-004 AC2: a known order that became delivered is marked delivered (starts the PII purge clock)', async () => {
      db.channel.findFirst.mockResolvedValue({ ...channel, code: 'temu-eu', settings: {} });
      db.channelOrder.findUnique.mockResolvedValue(known({ externalStatus: 'SHIPPED', internalStatus: 'TRACKING_PUSHED' }));
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: 'DELIVERED' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(shipments.markDelivered).toHaveBeenCalledWith(TENANT, 'co1', expect.any(Date));
      expect(db.channelOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { externalStatus: 'DELIVERED' } });
      expect(res).toMatchObject({ delivered: 1, failed: 0 });
    });

    it('skips a delivery the state machine cannot reach (logged, status still stored)', async () => {
      states.canReach.mockReturnValue(false);
      db.channelOrder.findUnique.mockResolvedValue(known({ internalStatus: 'IMPORTED' }));
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '5' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(shipments.markDelivered).not.toHaveBeenCalled();
      expect(db.channelOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { externalStatus: '5' } });
      expect(res).toMatchObject({ delivered: 0, duplicates: 1, failed: 0 });
    });

    it('just records an ordinary status change of a known order', async () => {
      db.channelOrder.findUnique.mockResolvedValue(known());
      connector.listOrdersSince.mockResolvedValue({ items: [order('E1', { externalStatus: '3' })], nextCursor: null });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(db.channelOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { externalStatus: '3' } });
      expect(cancellation.handleChannelCancellation).not.toHaveBeenCalled();
      expect(res.duplicates).toBe(1);
    });

    it('never imports an unknown order that is already cancelled or delivered on the channel', async () => {
      connector.listOrdersSince.mockResolvedValue({
        items: [order('E1', { externalStatus: '6' }), order('E2', { externalStatus: '5' })],
        nextCursor: null,
      });
      const res = await svc.importChannel(TENANT, 'ch1');
      expect(db.channelOrder.create).not.toHaveBeenCalled();
      expect(enqueuer.enqueueRouting).not.toHaveBeenCalled();
      expect(res).toMatchObject({ fetched: 2, imported: 0, ignored: 2 });
    });
  });
});
