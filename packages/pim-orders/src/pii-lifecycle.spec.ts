import type { ChannelOrderRaw } from '@repo/connector-contracts';
import { decryptSecret } from '@repo/core-domain';
import { ChannelOrderImportService } from './channel-order-import.service';
import { OrderCancellationService } from './order-cancellation.service';
import { decodeOrderLines } from './order-lines.codec';
import { OrderStateService } from './order-state.service';
import { ShipmentService } from './shipment.service';
import { asDb, createDbMock, keyProvider, PII, TENANT, TEST_KEY } from './testing/testing';

/**
 * FR-TEMU-004 AC2 / NFR-04 end to end over one in-memory order row: import -> Temu reports DELIVERED on the next poll
 * -> markDelivered starts the clock -> the purge job wipes the PII 90 days later (and not before).
 */
describe('Temu order PII lifecycle (import poll -> delivered -> purge)', () => {
  const raw = (status: string): ChannelOrderRaw => ({
    externalId: 'PO-1',
    externalStatus: status,
    placedAt: new Date('2026-09-01T10:00:00.000Z'),
    currency: 'EUR',
    total: '50.00',
    shipByAt: null,
    customer: PII.customer,
    shippingAddress: PII.shippingAddress,
    lines: [{ sku: 'SKU1', quantity: 1 }],
  });

  it('starts the purge clock when the channel reports delivery and purges after the retention window', async () => {
    const db = createDbMock();
    const row: Record<string, any> = {};
    db.channel.findFirst.mockResolvedValue({ id: 'ch1', tenantId: TENANT, code: 'temu-eu', settings: {} });
    db.product.findMany.mockResolvedValue([{ sku: 'SKU1' }]);
    db.channelOrder.findUnique.mockImplementation(async () => (row.id ? { ...row } : null));
    db.channelOrder.create.mockImplementation(async ({ data }) => Object.assign(row, { id: 'co1' }, data));
    db.channelOrder.findFirst.mockImplementation(async () => ({ ...row }));
    db.channelOrder.findMany.mockImplementation(async () => (row.internalStatus === 'COMPLETED' ? [{ ...row }] : []));
    db.channelOrder.update.mockImplementation(async ({ data }) => Object.assign(row, data));
    db.channelOrder.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(row, data);
      return { count: 1 };
    });
    db.supplierOrder.findFirst.mockResolvedValue(null);

    const dbx = asDb(db);
    const states = new OrderStateService(dbx);
    const shipments = new ShipmentService(dbx, states, { resolve: jest.fn() }, { raise: jest.fn() });
    const cancellation = new OrderCancellationService(dbx, states, { resolve: jest.fn() }, { raise: jest.fn() });
    const connector = { listOrdersSince: jest.fn() };
    const importer = new ChannelOrderImportService(
      dbx,
      { resolve: jest.fn().mockResolvedValue(connector) },
      keyProvider,
      { enqueueRouting: jest.fn() },
      cancellation,
      shipments,
      states,
    );

    connector.listOrdersSince.mockResolvedValue({ items: [raw('AWAITING_SHIPMENT')], nextCursor: null });
    await importer.importChannel(TENANT, 'ch1');
    expect(row.internalStatus).toBe('IMPORTED');
    expect(JSON.parse(decryptSecret(row.customer, TEST_KEY)).name).toBe('Maria Silva');

    // The order has been shipped and its tracking pushed by the saga; then the channel reports delivery.
    row.internalStatus = 'TRACKING_PUSHED';
    connector.listOrdersSince.mockResolvedValue({ items: [raw('DELIVERED')], nextCursor: null });
    const summary = await importer.importChannel(TENANT, 'ch1');
    expect(summary.delivered).toBe(1);
    expect(row.internalStatus).toBe('COMPLETED');
    const deliveredAt = decodeOrderLines(row.lines).deliveredAt;
    expect(deliveredAt).toBeInstanceOf(Date);

    const day = 86_400_000;
    const before = await shipments.purgeExpiredPii(TENANT, new Date(deliveredAt!.getTime() + 89 * day));
    expect(before.purged).toBe(0);
    expect(row.customer).not.toBe('PURGED');

    const after = await shipments.purgeExpiredPii(TENANT, new Date(deliveredAt!.getTime() + 91 * day));
    expect(after).toEqual({ scanned: 1, purged: 1 });
    expect(row.customer).toBe('PURGED');
    expect(row.shippingAddress).toBe('PURGED');
    expect(decodeOrderLines(row.lines).piiPurgedAt).toBeInstanceOf(Date);
    expect(decodeOrderLines(row.lines).items).toEqual([{ sku: 'SKU1', quantity: 1 }]);

    // A second run is a no-op.
    expect((await shipments.purgeExpiredPii(TENANT, new Date(deliveredAt!.getTime() + 200 * day))).purged).toBe(0);
  });
});
