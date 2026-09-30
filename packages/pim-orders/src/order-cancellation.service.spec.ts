import { NotFoundException } from '@nestjs/common';
import { ORDER_ALERT_TYPES } from './constants';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderStateService } from './order-state.service';
import { asDb, createDbMock, TENANT, type DbMock } from './testing/testing';

describe('OrderCancellationService', () => {
  let db: DbMock;
  let gateway: { deleteSupplierDraft: jest.Mock };
  let gateways: { resolve: jest.Mock };
  let alerts: { raise: jest.Mock };
  let svc: OrderCancellationService;

  const order = (status: string, supplierOrder: unknown = null) => ({
    id: 'co1',
    tenantId: TENANT,
    externalId: 'E1',
    internalStatus: status,
    supplierOrder,
  });
  const so = (state: string, externalOrderId: string | null = 'AW1') => ({ id: 'so1', supplierId: 'sup1', state, externalOrderId });
  const orderStates = () => db.channelOrder.updateMany.mock.calls.map((c) => c[0].data.internalStatus);

  beforeEach(() => {
    db = createDbMock();
    db.channelOrder.updateMany.mockResolvedValue({ count: 1 });
    db.supplierOrder.update.mockResolvedValue({});
    gateway = { deleteSupplierDraft: jest.fn().mockResolvedValue(undefined) };
    gateways = { resolve: jest.fn().mockResolvedValue(gateway) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    svc = new OrderCancellationService(asDb(db), new OrderStateService(asDb(db)), gateways, alerts);
  });

  it('404 for an unknown order (tenant scoped)', async () => {
    db.channelOrder.findFirst.mockResolvedValue(null);
    await expect(svc.handleChannelCancellation(TENANT, 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.channelOrder.findFirst).toHaveBeenCalledWith({ where: { id: 'x', tenantId: TENANT }, include: { supplierOrder: true } });
  });

  it('ignores orders already cancelled or completed', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('CANCELLED'));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'ignored' });
    db.channelOrder.findFirst.mockResolvedValue(order('COMPLETED'));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'ignored' });
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
  });

  it('no supplier order: cancels directly', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('IMPORTED'));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'cancel', nextState: 'CANCELLED' });
    expect(orderStates()).toEqual(['CANCELLED']);
    expect(gateways.resolve).not.toHaveBeenCalled();
  });

  it('a cancelled supplier order counts as none', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('ROUTING', so('CANCELLED')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toMatchObject({ action: 'cancel' });
  });

  it('supplier order creating: deletes the AW draft then cancels', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('ROUTING', so('CREATING')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'delete_supplier_draft', nextState: 'CANCELLED' });
    expect(gateways.resolve).toHaveBeenCalledWith(TENANT, 'sup1');
    expect(gateway.deleteSupplierDraft).toHaveBeenCalledWith('AW1');
    expect(db.supplierOrder.update).toHaveBeenCalledWith({ where: { id: 'so1' }, data: { state: 'CANCELLED' } });
    expect(orderStates()).toEqual(['CANCELLED']);
  });

  it('creating but the AW order was never created: nothing to delete', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('ROUTING', so('CREATING', null)));
    await svc.handleChannelCancellation(TENANT, 'co1');
    expect(gateway.deleteSupplierDraft).not.toHaveBeenCalled();
    expect(orderStates()).toEqual(['CANCELLED']);
  });

  it('draft deletion failure sends the order to manual review with an alert', async () => {
    gateway.deleteSupplierDraft.mockRejectedValue(new Error('AW 500'));
    db.channelOrder.findFirst.mockResolvedValue(order('ROUTING', so('CREATING')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'manual_review', nextState: 'MANUAL_REVIEW' });
    expect(orderStates()).toEqual(['MANUAL_REVIEW']);
    expect(db.supplierOrder.update).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.SUPPLIER_DRAFT_DELETE_FAILED }));
  });

  it('submitted supplier order: manual review, never deleted', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('SUPPLIER_SUBMITTED', so('SUBMITTED')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'manual_review', nextState: 'MANUAL_REVIEW' });
    expect(orderStates()).toEqual(['MANUAL_REVIEW']);
    expect(gateway.deleteSupplierDraft).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.CANCELLATION_NEEDS_MANUAL_REVIEW }));
  });

  it('a failed supplier order that has an AW order is conservatively reviewed manually', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('SUPPLIER_FAILED', so('FAILED')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toMatchObject({ action: 'manual_review' });
    expect(gateway.deleteSupplierDraft).not.toHaveBeenCalled();
  });

  it('a failed supplier order without an AW order is cancelled (via manual review hop)', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('SUPPLIER_FAILED', so('FAILED', null)));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toMatchObject({ action: 'cancel' });
    expect(orderStates()).toEqual(['MANUAL_REVIEW', 'CANCELLED']);
  });

  it('dispatched orders cannot go to manual review directly: alert only, state untouched', async () => {
    db.channelOrder.findFirst.mockResolvedValue(order('SUPPLIER_DISPATCHED', so('DISPATCHED')));
    await expect(svc.handleChannelCancellation(TENANT, 'co1')).resolves.toEqual({ action: 'manual_review', nextState: 'SUPPLIER_DISPATCHED' });
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.CANCELLATION_NEEDS_MANUAL_REVIEW }));
  });
});
