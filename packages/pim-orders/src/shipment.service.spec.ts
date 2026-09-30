import { ConflictException, NotFoundException } from '@nestjs/common';
import { ORDER_ALERT_TYPES } from './constants';
import { decodeOrderLines, encodeOrderLines } from './order-lines.codec';
import { OrderStateService } from './order-state.service';
import { ShipmentService } from './shipment.service';
import { asDb, createDbMock, TENANT, type DbMock } from './testing/testing';

describe('ShipmentService', () => {
  let db: DbMock;
  let connector: { pushShipment: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let alerts: { raise: jest.Mock };
  let svc: ShipmentService;

  const channel = (code = 'prestashop9', settings: unknown = {}) => ({ id: 'ch1', tenantId: TENANT, code, settings });
  const order = (status = 'SUPPLIER_SUBMITTED', code = 'prestashop9', settings: unknown = {}) => ({
    id: 'co1',
    tenantId: TENANT,
    externalId: 'E1',
    internalStatus: status,
    lines: encodeOrderLines({ items: [], shipByAt: null }),
    channel: channel(code, settings),
  });
  const shipment = (over: Record<string, unknown> = {}, ord = order()) => ({
    id: 'sh1',
    tenantId: TENANT,
    channelOrderId: 'co1',
    carrierCode: 'ctt',
    carrierName: 'CTT',
    trackingNumber: 'TRK1',
    source: 'MANUAL',
    pushedToChannelAt: null,
    pushError: null,
    channelOrder: ord,
    ...over,
  });
  const states = () => db.channelOrder.updateMany.mock.calls.map((c) => c[0].data.internalStatus);
  const input = { carrierCode: 'ctt', carrierName: 'CTT', trackingNumber: 'TRK1' };

  beforeEach(() => {
    db = createDbMock();
    connector = { pushShipment: jest.fn().mockResolvedValue(undefined) };
    resolver = { resolve: jest.fn().mockResolvedValue(connector) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    db.channelOrder.updateMany.mockResolvedValue({ count: 1 });
    db.channelOrder.update.mockResolvedValue({});
    db.shipment.update.mockResolvedValue({});
    svc = new ShipmentService(asDb(db), new OrderStateService(asDb(db)), resolver, alerts);
  });

  describe('recordManualTracking', () => {
    it('404 for an unknown order, 409 for a state that cannot take tracking', async () => {
      db.channelOrder.findFirst.mockResolvedValue(null);
      await expect(svc.recordManualTracking(TENANT, 'x', input)).rejects.toBeInstanceOf(NotFoundException);
      db.channelOrder.findFirst.mockResolvedValue(order('IMPORTED'));
      await expect(svc.recordManualTracking(TENANT, 'co1', input)).rejects.toBeInstanceOf(ConflictException);
      expect(db.shipment.create).not.toHaveBeenCalled();
    });

    it('creates Shipment(MANUAL), pushes via the originating channel and walks the state machine', async () => {
      db.channelOrder.findFirst.mockResolvedValue(order());
      db.shipment.findFirst.mockResolvedValue(null);
      db.shipment.create.mockImplementation(async ({ data }) => shipment(data));
      db.shipment.findFirst.mockResolvedValueOnce(null).mockResolvedValue(shipment());
      const res = await svc.recordManualTracking(TENANT, 'co1', input);
      expect(db.shipment.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT, channelOrderId: 'co1', carrierCode: 'ctt', carrierName: 'CTT', trackingNumber: 'TRK1', source: 'MANUAL' },
      });
      expect(connector.pushShipment).toHaveBeenCalledWith({ externalOrderId: 'E1', carrierCode: 'ctt', carrierName: 'CTT', trackingNumber: 'TRK1' });
      expect(db.shipment.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { pushedToChannelAt: expect.any(Date), pushError: null },
      });
      expect(states()).toEqual(['SUPPLIER_DISPATCHED', 'TRACKING_PUSHED']);
      expect(res).toMatchObject({ shipmentId: 'sh1', pushed: true, idempotent: false });
    });

    it('is idempotent: an already pushed identical shipment is returned without a second push', async () => {
      db.channelOrder.findFirst.mockResolvedValue(order('TRACKING_PUSHED'));
      db.shipment.findFirst.mockResolvedValue(shipment({ pushedToChannelAt: new Date() }, order('TRACKING_PUSHED')));
      const res = await svc.recordManualTracking(TENANT, 'co1', input);
      expect(res).toMatchObject({ shipmentId: 'sh1', pushed: false, idempotent: true });
      expect(db.shipment.create).not.toHaveBeenCalled();
      expect(connector.pushShipment).not.toHaveBeenCalled();
    });

    it('retries the push of an existing un-pushed identical shipment without duplicating it', async () => {
      db.channelOrder.findFirst.mockResolvedValue(order('TRACKING_MISSING'));
      db.shipment.findFirst.mockResolvedValue(shipment({}, order('TRACKING_MISSING')));
      const res = await svc.recordManualTracking(TENANT, 'co1', input);
      expect(db.shipment.create).not.toHaveBeenCalled();
      expect(res.pushed).toBe(true);
      expect(states()).toEqual(['TRACKING_PUSHED']);
    });
  });

  describe('pushShipment', () => {
    it('404 when missing', async () => {
      db.shipment.findFirst.mockResolvedValue(null);
      await expect(svc.pushShipment(TENANT, 'x')).rejects.toBeInstanceOf(NotFoundException);
      expect(db.shipment.findFirst).toHaveBeenCalledWith({ where: { id: 'x', tenantId: TENANT }, include: { channelOrder: { include: { channel: true } } } });
    });

    it('maps the carrier to Temu ids through the settings carrier table', async () => {
      const ord = order('SUPPLIER_DISPATCHED', 'temu-eu', { carrierTable: { ctt: { temuCarrierId: '99', temuCarrierName: 'CTT Temu' } } });
      db.shipment.findFirst.mockResolvedValue(shipment({}, ord));
      const res = await svc.pushShipment(TENANT, 'sh1');
      expect(connector.pushShipment).toHaveBeenCalledWith({ externalOrderId: 'E1', carrierCode: '99', carrierName: 'CTT Temu', trackingNumber: 'TRK1' });
      expect(res.pushed).toBe(true);
      expect(states()).toEqual(['TRACKING_PUSHED']);
    });

    it('blocks an unknown Temu carrier with an explicit error, records pushError and never calls Temu', async () => {
      const ord = order('SUPPLIER_DISPATCHED', 'temu-eu', { carrierTable: {} });
      db.shipment.findFirst.mockResolvedValue(shipment({ carrierCode: 'weird' }, ord));
      const res = await svc.pushShipment(TENANT, 'sh1');
      expect(connector.pushShipment).not.toHaveBeenCalled();
      expect(res).toMatchObject({ pushed: false, error: expect.stringContaining('weird') });
      expect(db.shipment.update).toHaveBeenCalledWith({ where: { id: 'sh1' }, data: { pushError: expect.stringContaining('weird') } });
      expect(states()).toEqual(['TRACKING_MISSING']);
      expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.TRACKING_PUSH_FAILED }));
    });

    it('treats a missing carrier table / carrier code as unknown for Temu', async () => {
      const ord = order('SUPPLIER_SUBMITTED', 'temu-eu', undefined);
      db.shipment.findFirst.mockResolvedValue(shipment({ carrierCode: null }, ord));
      const res = await svc.pushShipment(TENANT, 'sh1');
      expect(res.pushed).toBe(false);
      expect(states()).toEqual([]); // submitted order: state untouched
    });

    it('records connector errors without throwing or advancing the order', async () => {
      connector.pushShipment.mockRejectedValue(new Error('PS 500'));
      db.shipment.findFirst.mockResolvedValue(shipment({}, order('SUPPLIER_SUBMITTED')));
      const res = await svc.pushShipment(TENANT, 'sh1');
      expect(res).toMatchObject({ pushed: false, error: 'PS 500' });
      expect(states()).toEqual([]);
    });

    it('does nothing when already pushed', async () => {
      db.shipment.findFirst.mockResolvedValue(shipment({ pushedToChannelAt: new Date() }));
      await expect(svc.pushShipment(TENANT, 'sh1')).resolves.toEqual({ pushed: false, alreadyPushed: true });
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('uses an empty carrier code for non-Temu channels that have none', async () => {
      db.shipment.findFirst.mockResolvedValue(shipment({ carrierCode: null, carrierName: null }));
      await svc.pushShipment(TENANT, 'sh1');
      expect(connector.pushShipment).toHaveBeenCalledWith({ externalOrderId: 'E1', carrierCode: '', trackingNumber: 'TRK1' });
    });
  });

  describe('markDelivered', () => {
    it('completes a pushed order and stores deliveredAt', async () => {
      const at = new Date('2026-09-10T00:00:00.000Z');
      db.channelOrder.findFirst.mockResolvedValue(order('TRACKING_PUSHED'));
      await svc.markDelivered(TENANT, 'co1', at);
      expect(states()).toEqual(['COMPLETED']);
      const data = db.channelOrder.update.mock.calls[0][0].data;
      expect(decodeOrderLines(data.lines).deliveredAt).toEqual(at);
    });
    it('keeps the first deliveredAt so the 90-day clock never restarts', async () => {
      const first = new Date('2026-09-10T00:00:00.000Z');
      const o = order('COMPLETED');
      o.lines = { ...encodeOrderLines({ items: [], shipByAt: null }), deliveredAt: first.toISOString() };
      db.channelOrder.findFirst.mockResolvedValue(o);
      await svc.markDelivered(TENANT, 'co1', new Date('2026-10-01T00:00:00.000Z'));
      const data = db.channelOrder.update.mock.calls[0]?.[0].data;
      expect(data ? decodeOrderLines(data.lines).deliveredAt : first).toEqual(first);
    });
    it('404 when missing', async () => {
      db.channelOrder.findFirst.mockResolvedValue(null);
      await expect(svc.markDelivered(TENANT, 'x', new Date())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('scanShipByDeadlines', () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    const temuOrder = (shipBy: Date | null, shipments: unknown[] = [], alertedAt: Date | null = null) => {
      const lines = encodeOrderLines({ items: [], shipByAt: shipBy });
      if (alertedAt) lines.shipByAlertedAt = alertedAt.toISOString();
      return { ...order('SUPPLIER_SUBMITTED', 'temu-eu'), lines, shipments };
    };

    it('alerts Temu orders without tracking within 12h of ship-by, once', async () => {
      db.channelOrder.findMany.mockResolvedValue([
        temuOrder(new Date('2026-09-10T06:00:00.000Z')), // 6h left -> alert
        { ...temuOrder(new Date('2026-09-10T06:00:00.000Z')), id: 'co2' }, // alert
        { ...temuOrder(new Date('2026-09-10T06:00:00.000Z'), [{ id: 's' }]), id: 'co3' }, // has tracking
        { ...temuOrder(new Date('2026-09-20T06:00:00.000Z')), id: 'co4' }, // far away
        { ...temuOrder(null), id: 'co5' }, // no deadline
        { ...temuOrder(new Date('2026-09-10T06:00:00.000Z'), [], new Date('2026-09-09T20:00:00.000Z')), id: 'co6' }, // already alerted
      ]);
      const res = await svc.scanShipByDeadlines(TENANT, now);
      expect(db.channelOrder.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, channel: { code: 'temu-eu' }, internalStatus: { in: expect.arrayContaining(['SUPPLIER_SUBMITTED', 'TRACKING_MISSING']) } },
        include: { channel: true, shipments: true },
      });
      expect(res).toEqual({ scanned: 6, alerted: 2 });
      expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.SHIP_BY_DEADLINE, channelOrderId: 'co1' }));
      expect(decodeOrderLines(db.channelOrder.update.mock.calls[0][0].data.lines).shipByAlertedAt).toEqual(now);
    });

    it('flags overdue orders in the alert message', async () => {
      db.channelOrder.findMany.mockResolvedValue([temuOrder(new Date('2026-09-09T00:00:00.000Z'))]);
      await svc.scanShipByDeadlines(TENANT, now);
      expect(alerts.raise.mock.calls[0][0].message).toContain('overdue');
    });
  });

  describe('purgeExpiredPii', () => {
    const now = new Date('2026-12-31T00:00:00.000Z');
    const completed = (id: string, deliveredAt: Date | null, purgedAt: Date | null = null) => {
      const lines = encodeOrderLines({ items: [{ sku: 'A', quantity: 1 }], shipByAt: null });
      lines.deliveredAt = deliveredAt?.toISOString() ?? null;
      lines.piiPurgedAt = purgedAt?.toISOString() ?? null;
      return { id, tenantId: TENANT, lines };
    };

    it('purges PII of Temu orders 90 days after delivery, keeps the rest', async () => {
      db.channelOrder.findMany.mockResolvedValue([
        completed('old', new Date('2026-08-01T00:00:00.000Z')),
        completed('fresh', new Date('2026-12-01T00:00:00.000Z')),
        completed('undelivered', null),
        completed('done', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-05-01T00:00:00.000Z')),
      ]);
      const res = await svc.purgeExpiredPii(TENANT, now);
      expect(db.channelOrder.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, internalStatus: 'COMPLETED', channel: { code: 'temu-eu' } },
        select: { id: true, tenantId: true, lines: true },
      });
      expect(res).toEqual({ scanned: 4, purged: 1 });
      expect(db.channelOrder.update).toHaveBeenCalledTimes(1);
      const call = db.channelOrder.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'old' });
      expect(call.data.customer).toBe('PURGED');
      expect(call.data.shippingAddress).toBe('PURGED');
      const dec = decodeOrderLines(call.data.lines);
      expect(dec.piiPurgedAt).toEqual(now);
      expect(dec.items).toEqual([{ sku: 'A', quantity: 1 }]);
    });

    it('honours a custom retention', async () => {
      db.channelOrder.findMany.mockResolvedValue([completed('o', new Date('2026-12-01T00:00:00.000Z'))]);
      expect((await svc.purgeExpiredPii(TENANT, now, 10)).purged).toBe(1);
    });
  });
});
