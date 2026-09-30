import { createMockDb } from '../testing/mock-db';
import { OrdersQueryService } from './orders-query.service';

const d = new Date('2026-02-03T04:05:06Z');
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  tenantId: 't',
  channelId: 'c',
  channel: { code: 'temu-eu' },
  externalId: 'PO-1',
  externalStatus: 'paid',
  placedAt: d,
  internalStatus: 'SUPPLIER_SUBMITTED',
  totalGross: { toString: () => '49.90' },
  totalNet: { toString: () => '40.57' },
  totalShipping: null,
  currency: 'EUR',
  customer: 'ENCRYPTED-CUSTOMER',
  shippingAddress: 'ENCRYPTED-ADDRESS',
  lines: {
    items: [
      { sku: 'A', quantity: 2, unitPrice: '10.00' },
      { sku: 'B', quantity: 1 },
    ],
    shipByAt: d.toISOString(),
    shipByAlertedAt: null,
    deliveredAt: null,
    piiPurgedAt: null,
    manualReviewReason: 'mixed_suppliers',
  },
  supplierOrder: {
    id: 'so',
    supplierId: 's',
    state: 'SUBMITTED',
    externalOrderId: 'AW1',
    externalReference: 'ref',
    totalNet: { toString: () => '30' },
    lastError: null,
  },
  shipments: [
    {
      id: 'sh',
      carrierCode: 'DHL',
      carrierName: 'DHL',
      trackingNumber: 'T1',
      source: 'MANUAL',
      pushedToChannelAt: null,
      pushError: 'boom',
      createdAt: d,
    },
  ],
  createdAt: d,
  updatedAt: d,
  ...over,
});
const setup = () => {
  const { db, mock } = createMockDb();
  const routing = { enqueueRouting: jest.fn().mockResolvedValue(undefined) };
  return { mock, routing, svc: new OrdersQueryService(db, routing) };
};
const q = { skip: 0, take: 20, sortBy: 'id', sortOrder: 'asc' as const };

describe('OrdersQueryService', () => {
  it('lists orders with filters and never exposes encrypted PII', async () => {
    const { svc, mock } = setup();
    mock.channelOrder.findMany.mockResolvedValue([order()]);
    mock.channelOrder.count.mockResolvedValue(1);
    const r = await svc.list('t', {
      ...q,
      sortBy: 'externalId',
      status: 'supplier_submitted',
      channelId: 'c',
      search: 'po',
    });
    const args = mock.channelOrder.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 't',
      internalStatus: 'SUPPLIER_SUBMITTED',
      channelId: 'c',
      externalId: { contains: 'po', mode: 'insensitive' },
    });
    expect(args.orderBy).toEqual({ externalId: 'asc' });
    expect(r.total).toBe(1);
    expect(r.items[0]).toEqual({
      id: 'o1',
      channelId: 'c',
      channelCode: 'temu-eu',
      externalId: 'PO-1',
      externalStatus: 'paid',
      placedAt: d.toISOString(),
      status: 'supplier_submitted',
      totalGross: '49.90',
      currency: 'EUR',
      lineCount: 2,
      shipByAt: d.toISOString(),
      manualReviewReason: 'mixed_suppliers',
      hasTracking: true,
      supplierOrder: {
        id: 'so',
        supplierId: 's',
        state: 'submitted',
        externalOrderId: 'AW1',
        externalReference: 'ref',
        totalNet: '30',
        lastError: null,
      },
    });
    expect(JSON.stringify(r)).not.toContain('ENCRYPTED');
  });

  it('defaults the sort to newest first and tolerates orders without supplier order or shipments', async () => {
    const { svc, mock } = setup();
    mock.channelOrder.findMany.mockResolvedValue([
      order({
        supplierOrder: null,
        shipments: [],
        lines: [{ sku: 'A', quantity: 1 }],
      }),
    ]);
    mock.channelOrder.count.mockResolvedValue(1);
    const r = await svc.list('t', q);
    expect(mock.channelOrder.findMany.mock.calls[0][0].orderBy).toEqual({
      placedAt: 'desc',
    });
    await svc.list('t', { ...q, sortBy: 'bogus', sortOrder: 'desc' });
    expect(mock.channelOrder.findMany.mock.calls[1][0].orderBy).toEqual({
      placedAt: 'desc',
    });
    expect(r.items[0]).toMatchObject({
      supplierOrder: null,
      hasTracking: false,
      lineCount: 1,
      shipByAt: null,
      manualReviewReason: null,
    });
  });

  it('returns the detail with lines and shipments but no PII', async () => {
    const { svc, mock } = setup();
    mock.channelOrder.findFirst.mockResolvedValue(order());
    const r = await svc.detail('t', 'o1');
    expect(r.lines).toEqual([
      { sku: 'A', quantity: 2, unitPrice: '10.00' },
      { sku: 'B', quantity: 1, unitPrice: null },
    ]);
    expect(r.shipments[0]).toEqual({
      id: 'sh',
      carrierCode: 'DHL',
      carrierName: 'DHL',
      trackingNumber: 'T1',
      source: 'manual',
      pushedToChannelAt: null,
      pushError: 'boom',
      createdAt: d.toISOString(),
    });
    expect(r).toMatchObject({ totalNet: '40.57', totalShipping: null });
    expect(JSON.stringify(r)).not.toContain('ENCRYPTED');
  });

  it('404s an unknown order', async () => {
    const { svc, mock } = setup();
    mock.channelOrder.findFirst.mockResolvedValue(null);
    await expect(svc.detail('t', 'x')).rejects.toThrow(/Order x/);
    await expect(svc.retry('t', 'x')).rejects.toThrow(/Order x/);
  });

  it.each(['SUPPLIER_FAILED', 'MANUAL_REVIEW', 'IMPORTED', 'ROUTING'])(
    'retries a %s order through the routing queue',
    async (status) => {
      const { svc, mock, routing } = setup();
      mock.channelOrder.findFirst.mockResolvedValue({
        id: 'o1',
        internalStatus: status,
      });
      expect(await svc.retry('t', 'o1')).toEqual({
        enqueued: true,
        previousStatus: status.toLowerCase(),
      });
      expect(routing.enqueueRouting).toHaveBeenCalledWith({
        tenantId: 't',
        channelOrderId: 'o1',
      });
    },
  );

  it.each(['SUPPLIER_SUBMITTED', 'COMPLETED', 'CANCELLED', 'TRACKING_PUSHED'])(
    'refuses to retry a %s order',
    async (status) => {
      const { svc, mock, routing } = setup();
      mock.channelOrder.findFirst.mockResolvedValue({
        id: 'o1',
        internalStatus: status,
      });
      await expect(svc.retry('t', 'o1')).rejects.toThrow(
        /cannot be routed again/,
      );
      expect(routing.enqueueRouting).not.toHaveBeenCalled();
    },
  );
});
