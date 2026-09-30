import { ORDER_ALERT_TYPES } from './constants';
import { OrderStateService } from './order-state.service';
import { SupplierOrderStatusService } from './supplier-order-status.service';
import { asDb, createDbMock, TENANT, type DbMock } from './testing/testing';

describe('SupplierOrderStatusService', () => {
  let db: DbMock;
  let gateway: { getSupplierOrder: jest.Mock };
  let gateways: { resolve: jest.Mock };
  let alerts: { raise: jest.Mock };
  let shipments: { pushShipment: jest.Mock };
  let svc: SupplierOrderStatusService;

  const so = (over: Record<string, unknown> = {}) => ({
    id: 'so1',
    supplierId: 'sup1',
    externalOrderId: 'AW1',
    state: 'SUBMITTED',
    channelOrder: { id: 'co1', tenantId: TENANT, externalId: 'E1', internalStatus: 'SUPPLIER_SUBMITTED' },
    ...over,
  });
  const status = (over: Record<string, unknown> = {}) => ({
    externalId: 'AW1',
    state: 'submitted',
    lines: [{ transactionId: 't1', quantityOrdered: 2, quantityDispatched: 0, quantityFail: 0, quantityCancelled: 0 }],
    tracking: null,
    alert: false,
    ...over,
  });
  const dispatchedLines = [{ transactionId: 't1', quantityOrdered: 2, quantityDispatched: 2, quantityFail: 0, quantityCancelled: 0 }];
  const orderStates = () => db.channelOrder.updateMany.mock.calls.map((c) => c[0].data.internalStatus);

  beforeEach(() => {
    db = createDbMock();
    db.supplierOrder.findMany.mockResolvedValue([so()]);
    db.supplierOrder.update.mockResolvedValue({});
    db.channelOrder.updateMany.mockResolvedValue({ count: 1 });
    db.shipment.findFirst.mockResolvedValue(null);
    db.shipment.create.mockResolvedValue({ id: 'sh1' });
    gateway = { getSupplierOrder: jest.fn().mockResolvedValue(status()) };
    gateways = { resolve: jest.fn().mockResolvedValue(gateway) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    shipments = { pushShipment: jest.fn().mockResolvedValue({ pushed: true }) };
    svc = new SupplierOrderStatusService(asDb(db), new OrderStateService(asDb(db)), gateways, alerts, shipments as never);
  });

  it('polls only submitted supplier orders of the tenant', async () => {
    await svc.pollSubmitted(TENANT);
    expect(db.supplierOrder.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, state: 'SUBMITTED', externalOrderId: { not: null } },
      include: { channelOrder: true },
    });
    expect(gateways.resolve).toHaveBeenCalledTimes(1);
    expect(gateway.getSupplierOrder).toHaveBeenCalledWith('AW1');
  });

  it('leaves a still-pending order untouched', async () => {
    const res = await svc.pollSubmitted(TENANT);
    expect(res).toMatchObject({ checked: 1, dispatched: 0 });
    expect(db.supplierOrder.update).not.toHaveBeenCalled();
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
  });

  it('dispatched with tracking: moves to supplier_dispatched, stores a SUPPLIER_API shipment, pushes it', async () => {
    gateway.getSupplierOrder.mockResolvedValue(status({ lines: dispatchedLines, tracking: { carrierName: 'CTT Express', trackingNumber: 'TRK1' } }));
    const res = await svc.pollSubmitted(TENANT);
    expect(db.supplierOrder.update).toHaveBeenCalledWith({ where: { id: 'so1' }, data: { state: 'DISPATCHED' } });
    expect(orderStates()).toEqual(['SUPPLIER_DISPATCHED']);
    expect(db.shipment.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, channelOrderId: 'co1', carrierCode: 'ctt express', carrierName: 'CTT Express', trackingNumber: 'TRK1', source: 'SUPPLIER_API' },
    });
    expect(shipments.pushShipment).toHaveBeenCalledWith(TENANT, 'sh1');
    expect(res).toMatchObject({ dispatched: 1, withTracking: 1, trackingMissing: 0 });
  });

  it('does not duplicate an existing shipment with the same tracking number', async () => {
    db.shipment.findFirst.mockResolvedValue({ id: 'shX' });
    gateway.getSupplierOrder.mockResolvedValue(status({ state: 'dispatched', tracking: { trackingNumber: 'TRK1' } }));
    await svc.pollSubmitted(TENANT);
    expect(db.shipment.create).not.toHaveBeenCalled();
    expect(shipments.pushShipment).toHaveBeenCalledWith(TENANT, 'shX');
    expect(db.shipment.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT, channelOrderId: 'co1', trackingNumber: 'TRK1' } });
  });

  it('dispatched without tracking: order goes to tracking_missing with an alert, no shipment invented', async () => {
    gateway.getSupplierOrder.mockResolvedValue(status({ lines: dispatchedLines, tracking: null }));
    const res = await svc.pollSubmitted(TENANT);
    expect(orderStates()).toEqual(['SUPPLIER_DISPATCHED', 'TRACKING_MISSING']);
    expect(db.shipment.create).not.toHaveBeenCalled();
    expect(shipments.pushShipment).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.TRACKING_MISSING, channelOrderId: 'co1' }));
    expect(res.trackingMissing).toBe(1);
  });

  it('treats fully dispatched remaining quantity (after fails) as dispatched', async () => {
    gateway.getSupplierOrder.mockResolvedValue(
      status({ alert: true, lines: [{ transactionId: 't', quantityOrdered: 3, quantityDispatched: 2, quantityFail: 1, quantityCancelled: 0 }] }),
    );
    const res = await svc.pollSubmitted(TENANT);
    expect(res.dispatched).toBe(1);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.SUPPLIER_QUANTITY_FAIL }));
  });

  it('raises an alert on quantity_fail without dispatching a partially shipped order', async () => {
    gateway.getSupplierOrder.mockResolvedValue(
      status({ alert: true, lines: [{ transactionId: 't', quantityOrdered: 2, quantityDispatched: 0, quantityFail: 1, quantityCancelled: 0 }] }),
    );
    const res = await svc.pollSubmitted(TENANT);
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ type: ORDER_ALERT_TYPES.SUPPLIER_QUANTITY_FAIL, dedupeKey: 'co1:supplier_quantity_fail' }),
    );
    expect(res).toMatchObject({ alerts: 1, dispatched: 0 });
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
  });

  it('a cancelled-only line alert uses the cancelled type', async () => {
    gateway.getSupplierOrder.mockResolvedValue(
      status({ alert: true, lines: [{ transactionId: 't', quantityOrdered: 2, quantityDispatched: 0, quantityFail: 0, quantityCancelled: 2 }] }),
    );
    await svc.pollSubmitted(TENANT);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.SUPPLIER_CANCELLED }));
  });

  it('a cancelled supplier order is recorded, alerts and sends the channel order to manual review', async () => {
    gateway.getSupplierOrder.mockResolvedValue(status({ state: 'cancelled', alert: true }));
    await svc.pollSubmitted(TENANT);
    expect(db.supplierOrder.update).toHaveBeenCalledWith({ where: { id: 'so1' }, data: { state: 'CANCELLED' } });
    expect(orderStates()).toEqual(['MANUAL_REVIEW']);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.SUPPLIER_CANCELLED }));
  });

  it('isolates per-order failures and caches the gateway per supplier', async () => {
    db.supplierOrder.findMany.mockResolvedValue([so(), so({ id: 'so2', channelOrder: { id: 'co2', tenantId: TENANT, externalId: 'E2', internalStatus: 'SUPPLIER_SUBMITTED' } })]);
    gateway.getSupplierOrder.mockRejectedValueOnce(new Error('aw down')).mockResolvedValueOnce(status());
    const res = await svc.pollSubmitted(TENANT);
    expect(res).toMatchObject({ checked: 2, failed: 1 });
    expect(gateways.resolve).toHaveBeenCalledTimes(1);
  });
});
