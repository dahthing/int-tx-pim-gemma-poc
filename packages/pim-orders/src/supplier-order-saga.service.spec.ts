import { NotFoundException } from '@nestjs/common';
import type { PlaceDropshipOrderCommand, SupplierOrderProgress } from '@repo/connector-contracts';
import { ORDER_ALERT_TYPES } from './constants';
import { encodeOrderLines } from './order-lines.codec';
import { OrderStateService } from './order-state.service';
import { SupplierOrderSagaService } from './supplier-order-saga.service';
import { asDb, createDbMock, encPii, PII, TENANT, type DbMock } from './testing/testing';
import { keyProvider } from './testing/testing';

describe('SupplierOrderSagaService', () => {
  let db: DbMock;
  let gateway: { placeDropshipOrder: jest.Mock; getSupplierOrder: jest.Mock; deleteSupplierDraft: jest.Mock };
  let gateways: { resolve: jest.Mock };
  let alerts: { raise: jest.Mock };
  let settings: { get: jest.Mock };
  let svc: SupplierOrderSagaService;

  const baseOrder = (over: Record<string, unknown> = {}) => ({
    id: 'co1',
    tenantId: TENANT,
    externalId: 'E1',
    internalStatus: 'IMPORTED',
    totalGross: '123',
    totalNet: null,
    customer: encPii({ name: 'Maria Silva', email: null, phone: null }),
    shippingAddress: encPii(PII.shippingAddress),
    lines: encodeOrderLines({ items: [{ sku: 'SKU1', quantity: 2 }], shipByAt: null }),
    channel: { id: 'ch1', code: 'prestashop9' },
    ...over,
  });
  const supplierOrder = (over: Record<string, unknown> = {}) => ({
    id: 'so1',
    supplierId: 'sup1',
    state: 'CREATING',
    sagaProgress: {},
    externalOrderId: null,
    ...over,
  });

  beforeEach(() => {
    db = createDbMock();
    db.channelOrder.findFirst.mockResolvedValue(baseOrder());
    db.channelOrder.updateMany.mockResolvedValue({ count: 1 });
    db.product.findMany.mockResolvedValue([{ sku: 'SKU1', supplierProductId: 'sp1' }]);
    db.supplierAssortmentItem.findMany.mockResolvedValue([
      { supplierProductId: 'sp1', supplierId: 'sup1', externalPortfolioId: 'PF1' },
    ]);
    db.supplierOrder.upsert.mockResolvedValue(supplierOrder());
    db.supplierOrder.update.mockResolvedValue({});
    gateway = {
      placeDropshipOrder: jest.fn().mockResolvedValue({ state: 'submitted', progress: { submitted: true, orderId: 'AW1' }, externalOrderId: 'AW1', totalAmount: '50.00' }),
      getSupplierOrder: jest.fn(),
      deleteSupplierDraft: jest.fn(),
    };
    gateways = { resolve: jest.fn().mockResolvedValue(gateway) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    settings = { get: jest.fn().mockResolvedValue({ defaultEmail: 'd@t.pt', defaultPhone: '+351111', minMargin: '0.2', vatRate: '0.23' }) };
    svc = new SupplierOrderSagaService(asDb(db), new OrderStateService(asDb(db)), gateways, keyProvider, settings, alerts);
  });

  const statuses = () => db.channelOrder.updateMany.mock.calls.map((c) => c[0].data.internalStatus);

  it('throws NotFound for an unknown order (tenant scoped)', async () => {
    db.channelOrder.findFirst.mockResolvedValue(null);
    await expect(svc.route(TENANT, 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.channelOrder.findFirst).toHaveBeenCalledWith({ where: { id: 'x', tenantId: TENANT }, include: { channel: true } });
  });

  it('skips orders that are not routable', async () => {
    db.channelOrder.findFirst.mockResolvedValue(baseOrder({ internalStatus: 'COMPLETED' }));
    await expect(svc.route(TENANT, 'co1')).resolves.toEqual({ outcome: 'skipped' });
    expect(gateway.placeDropshipOrder).not.toHaveBeenCalled();
  });

  it('builds the command with decrypted PII, tenant defaults and max supplier cost, then submits', async () => {
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'submitted', externalOrderId: 'AW1' });
    const cmd: PlaceDropshipOrderCommand = gateway.placeDropshipOrder.mock.calls[0][0];
    expect(cmd.channelCode).toBe('prestashop9');
    expect(cmd.channelOrderId).toBe('E1');
    expect(cmd.recipient).toMatchObject({ fullName: 'Maria Silva', line1: 'Rua A 1', email: null, phone: null });
    expect(cmd.lines).toEqual([{ externalPortfolioId: 'PF1', quantity: 2 }]);
    expect(cmd.tenantDefaults).toEqual({ email: 'd@t.pt', phone: '+351111' });
    // net = 123/1.23 = 100 ; 100 * (1 - 0.2) = 80
    expect(cmd.maxSupplierCost).toBe('80.0000');
    expect(cmd.resume).toEqual({});
    expect(gateways.resolve).toHaveBeenCalledWith(TENANT, 'sup1');
    expect(statuses()).toEqual(['ROUTING', 'SUPPLIER_SUBMITTED']);
    expect(db.supplierOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'so1' },
      data: expect.objectContaining({ state: 'SUBMITTED', externalOrderId: 'AW1', lastError: null, totalNet: '50.00' }),
    });
  });

  it('prefers the order totalNet and recipient contact data when present', async () => {
    db.channelOrder.findFirst.mockResolvedValue(
      baseOrder({ totalNet: '200', customer: encPii({ name: 'M', email: 'm@x.pt', phone: '+351222' }) }),
    );
    await svc.route(TENANT, 'co1');
    const cmd = gateway.placeDropshipOrder.mock.calls[0][0];
    expect(cmd.maxSupplierCost).toBe('160.0000');
    expect(cmd.recipient).toMatchObject({ email: 'm@x.pt', phone: '+351222' });
  });

  it('persists progress after every saga step through onProgress', async () => {
    gateway.placeDropshipOrder.mockImplementation(async (_c, onProgress: (p: SupplierOrderProgress) => Promise<void>) => {
      await onProgress({ clientId: 'C1' });
      await onProgress({ clientId: 'C1', orderId: 'AW1' });
      return { state: 'submitted', progress: { clientId: 'C1', orderId: 'AW1', submitted: true }, externalOrderId: 'AW1' };
    });
    await svc.route(TENANT, 'co1');
    expect(db.supplierOrder.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'so1' },
      data: { sagaProgress: { clientId: 'C1' }, externalClientId: 'C1', externalOrderId: null },
    });
    expect(db.supplierOrder.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'so1' },
      data: { sagaProgress: { clientId: 'C1', orderId: 'AW1' }, externalClientId: 'C1', externalOrderId: 'AW1' },
    });
  });

  it('resumes from the persisted saga progress and never creates a second supplier order', async () => {
    db.channelOrder.findFirst.mockResolvedValue(baseOrder({ internalStatus: 'ROUTING' }));
    db.supplierOrder.upsert.mockResolvedValue(supplierOrder({ sagaProgress: { clientId: 'C1', orderId: 'AW1' }, externalOrderId: 'AW1' }));
    await svc.route(TENANT, 'co1');
    expect(gateway.placeDropshipOrder.mock.calls[0][0].resume).toEqual({ clientId: 'C1', orderId: 'AW1' });
    // keyed on the unique channelOrderId: upsert, never a blind create
    expect(db.supplierOrder.upsert).toHaveBeenCalledWith({
      where: { channelOrderId: 'co1' },
      create: { tenantId: TENANT, channelOrderId: 'co1', supplierId: 'sup1', state: 'CREATING', sagaProgress: {} },
      update: {},
    });
    expect(statuses()).toEqual(['SUPPLIER_SUBMITTED']); // already routing: no ROUTING hop
  });

  it('does not call the supplier again when the supplier order is already submitted', async () => {
    db.channelOrder.findFirst.mockResolvedValue(baseOrder({ internalStatus: 'ROUTING' }));
    db.supplierOrder.upsert.mockResolvedValue(supplierOrder({ state: 'SUBMITTED', externalOrderId: 'AW1' }));
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'already_submitted', externalOrderId: 'AW1' });
    expect(gateway.placeDropshipOrder).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['SUPPLIER_SUBMITTED']);
  });

  it('retries a FAILED supplier order from its progress (back to CREATING)', async () => {
    db.channelOrder.findFirst.mockResolvedValue(baseOrder({ internalStatus: 'SUPPLIER_FAILED' }));
    db.supplierOrder.upsert.mockResolvedValue(supplierOrder({ state: 'FAILED', sagaProgress: { orderId: 'AW1' } }));
    await svc.route(TENANT, 'co1');
    expect(db.supplierOrder.update.mock.calls[0][0]).toEqual({ where: { id: 'so1' }, data: { state: 'CREATING', lastError: null } });
    expect(gateway.placeDropshipOrder.mock.calls[0][0].resume).toEqual({ orderId: 'AW1' });
    expect(statuses()).toEqual(['ROUTING', 'SUPPLIER_SUBMITTED']);
  });

  it('cost_exceeds_max keeps the supplier order creating, the order routing, and raises an alert', async () => {
    gateway.placeDropshipOrder.mockResolvedValue({ state: 'creating', progress: { orderId: 'AW1', validated: false }, alert: 'cost_exceeds_max', externalOrderId: 'AW1' });
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'creating', alert: 'cost_exceeds_max' });
    expect(statuses()).toEqual(['ROUTING']);
    expect(db.supplierOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'so1' },
      data: expect.objectContaining({ state: 'CREATING', lastError: 'cost_exceeds_max' }),
    });
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, channelOrderId: 'co1', type: ORDER_ALERT_TYPES.COST_EXCEEDS_MAX }),
    );
    expect(gateway.deleteSupplierDraft).not.toHaveBeenCalled();
  });

  it('quantity_mismatch raises its own alert', async () => {
    gateway.placeDropshipOrder.mockResolvedValue({ state: 'creating', progress: {}, alert: 'quantity_mismatch' });
    await svc.route(TENANT, 'co1');
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.QUANTITY_MISMATCH }));
  });

  it('creating without alert simply stays in routing', async () => {
    gateway.placeDropshipOrder.mockResolvedValue({ state: 'creating', progress: {} });
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'creating' });
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('failure after max retries marks FAILED / supplier_failed and never deletes the AW order', async () => {
    gateway.placeDropshipOrder.mockResolvedValue({ state: 'failed', progress: { orderId: 'AW1' }, error: 'boom', externalOrderId: 'AW1' });
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'failed', error: 'boom' });
    expect(statuses()).toEqual(['ROUTING', 'SUPPLIER_FAILED']);
    expect(db.supplierOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'so1' },
      data: expect.objectContaining({ state: 'FAILED', lastError: 'boom', externalOrderId: 'AW1' }),
    });
    expect(gateway.deleteSupplierDraft).not.toHaveBeenCalled();
  });

  it('a thrown gateway error is recorded then rethrown for the queue to retry', async () => {
    gateway.placeDropshipOrder.mockRejectedValue(new Error('network'));
    await expect(svc.route(TENANT, 'co1')).rejects.toThrow('network');
    expect(db.supplierOrder.update).toHaveBeenLastCalledWith({ where: { id: 'so1' }, data: { lastError: 'network' } });
  });

  it.each([
    ['unknown product', { products: [], assort: [] }],
    ['no active assortment item', { products: [{ sku: 'SKU1', supplierProductId: 'sp1' }], assort: [] }],
    ['product without supplier product', { products: [{ sku: 'SKU1', supplierProductId: null }], assort: [] }],
  ])('routes to manual review when the line cannot be mapped: %s', async (_n, { products, assort }) => {
    db.product.findMany.mockResolvedValue(products);
    db.supplierAssortmentItem.findMany.mockResolvedValue(assort);
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'manual_review' });
    expect(statuses()).toEqual(['MANUAL_REVIEW']);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.ROUTING_MANUAL_REVIEW }));
    expect(db.supplierOrder.upsert).not.toHaveBeenCalled();
  });

  it('routes to manual review when lines belong to different suppliers', async () => {
    db.channelOrder.findFirst.mockResolvedValue(
      baseOrder({ lines: encodeOrderLines({ items: [{ sku: 'SKU1', quantity: 1 }, { sku: 'SKU2', quantity: 1 }], shipByAt: null }) }),
    );
    db.product.findMany.mockResolvedValue([
      { sku: 'SKU1', supplierProductId: 'sp1' },
      { sku: 'SKU2', supplierProductId: 'sp2' },
    ]);
    db.supplierAssortmentItem.findMany.mockResolvedValue([
      { supplierProductId: 'sp1', supplierId: 'sup1', externalPortfolioId: 'PF1' },
      { supplierProductId: 'sp2', supplierId: 'sup2', externalPortfolioId: 'PF2' },
    ]);
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'manual_review' });
  });

  it('routes to manual review when the cost cannot be computed', async () => {
    settings.get.mockResolvedValue({ defaultEmail: 'd', defaultPhone: 'p', minMargin: '1.5', vatRate: '0.23' });
    await expect(svc.route(TENANT, 'co1')).resolves.toMatchObject({ outcome: 'manual_review' });
    expect(gateway.placeDropshipOrder).not.toHaveBeenCalled();
  });

  it('honours shippingAbsorbed in the max cost', async () => {
    settings.get.mockResolvedValue({ defaultEmail: 'd', defaultPhone: 'p', minMargin: '0.2', vatRate: '0.23', shippingAbsorbed: '5' });
    await svc.route(TENANT, 'co1');
    expect(gateway.placeDropshipOrder.mock.calls[0][0].maxSupplierCost).toBe('75.0000');
  });
});
