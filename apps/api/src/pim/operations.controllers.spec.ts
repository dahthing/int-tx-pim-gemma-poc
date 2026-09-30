import type { INestApplication } from '@nestjs/common';
import { ShipmentService } from '@repo/pim-orders';
import {
  DashboardService,
  OrdersQueryService,
  PriceRuleService,
  SyncTriggerService,
} from '@repo/pim-runtime';
import request from 'supertest';
import { OperationsController } from './operations.controller';
import { OrdersController } from './orders.controller';
import { PriceRulesController } from './price-rules.controller';
import { createTestApp, TENANT_ID } from './testing';

const iso = '2026-09-30T10:00:00.000Z';
const rule = {
  id: 'r1',
  channelId: null,
  priority: 1,
  condition: { channel: 'temu-eu' },
  markupPct: '0.5',
  fixedAdd: null,
  rounding: 'x.99',
  minMarginPct: '0.1',
  vatRate: '0.23',
  createdAt: iso,
  updatedAt: iso,
};
const order = {
  id: 'o1',
  channelId: 'c',
  channelCode: 'temu-eu',
  externalId: 'PO-1',
  externalStatus: null,
  placedAt: iso,
  status: 'manual_review',
  totalGross: '10.00',
  currency: 'EUR',
  lineCount: 1,
  shipByAt: null,
  manualReviewReason: 'mixed_suppliers',
  supplierOrder: null,
  hasTracking: false,
};

describe('price rules, orders and operations controllers (HTTP)', () => {
  let app: INestApplication;
  const rules = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const orders = { list: jest.fn(), detail: jest.fn(), retry: jest.fn() };
  const shipments = { recordManualTracking: jest.fn() };
  const dashboard = {
    dashboard: jest.fn(),
    listSyncRuns: jest.fn(),
    listAlerts: jest.fn(),
    acknowledge: jest.fn(),
  };
  const sync = {
    triggerCatalogSync: jest.fn(),
    triggerStockCostSync: jest.fn(),
  };

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [
        PriceRulesController,
        OrdersController,
        OperationsController,
      ],
      providers: [
        { provide: PriceRuleService, useValue: rules },
        { provide: OrdersQueryService, useValue: orders },
        { provide: ShipmentService, useValue: shipments },
        { provide: DashboardService, useValue: dashboard },
        { provide: SyncTriggerService, useValue: sync },
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('price rules', () => {
    it('lists and gets', async () => {
      rules.list.mockResolvedValue([rule]);
      rules.get.mockResolvedValue(rule);
      expect(
        (await request(app.getHttpServer()).get('/price-rules').expect(200))
          .body.items,
      ).toEqual([rule]);
      expect(
        (await request(app.getHttpServer()).get('/price-rules/r1').expect(200))
          .body,
      ).toEqual(rule);
      expect(rules.get).toHaveBeenCalledWith(TENANT_ID, 'r1');
    });

    it('creates with defaults and validates decimals as fractions', async () => {
      rules.create.mockResolvedValue(rule);
      await request(app.getHttpServer())
        .post('/price-rules')
        .send({ vatRate: '0.23', markupPct: '0.5' })
        .expect(201);
      expect(rules.create).toHaveBeenCalledWith(TENANT_ID, {
        priority: 0,
        condition: {},
        rounding: 'none',
        vatRate: '0.23',
        markupPct: '0.5',
      });
      await request(app.getHttpServer())
        .post('/price-rules')
        .send({ vatRate: 0.23 })
        .expect(400);
      await request(app.getHttpServer())
        .post('/price-rules')
        .send({ vatRate: '0.23', rounding: 'x.95' })
        .expect(400);
    });

    it('updates, deletes and rejects empty updates', async () => {
      rules.update.mockResolvedValue(rule);
      rules.remove.mockResolvedValue(undefined);
      await request(app.getHttpServer())
        .patch('/price-rules/r1')
        .send({ priority: 3 })
        .expect(200);
      expect(rules.update).toHaveBeenCalledWith(TENANT_ID, 'r1', {
        priority: 3,
      });
      await request(app.getHttpServer())
        .patch('/price-rules/r1')
        .send({})
        .expect(400);
      await request(app.getHttpServer()).delete('/price-rules/r1').expect(204);
      expect(rules.remove).toHaveBeenCalledWith(TENANT_ID, 'r1');
    });
  });

  describe('orders', () => {
    it('lists orders with filters and never serializes PII even if a service leaked it', async () => {
      orders.list.mockResolvedValue({
        items: [
          {
            ...order,
            customer: { name: 'Maria' },
            shippingAddress: { line1: 'Rua A' },
          },
        ],
        total: 1,
      });
      const res = await request(app.getHttpServer())
        .get('/orders?status=manual_review&channelId=c&search=PO')
        .expect(200);
      expect(orders.list).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          status: 'manual_review',
          channelId: 'c',
          search: 'PO',
        }),
      );
      expect(res.body.items[0]).toEqual(order);
      expect(JSON.stringify(res.body)).not.toMatch(/Maria|Rua A/);
      await request(app.getHttpServer())
        .get('/orders?status=weird')
        .expect(400);
    });

    it('returns the order detail', async () => {
      orders.detail.mockResolvedValue({
        ...order,
        totalNet: null,
        totalShipping: null,
        lines: [],
        shipments: [],
        createdAt: iso,
        updatedAt: iso,
      });
      expect(
        (await request(app.getHttpServer()).get('/orders/o1').expect(200)).body
          .id,
      ).toBe('o1');
      expect(orders.detail).toHaveBeenCalledWith(TENANT_ID, 'o1');
    });

    it('retries routing asynchronously (202)', async () => {
      orders.retry.mockResolvedValue({
        enqueued: true,
        previousStatus: 'supplier_failed',
      });
      const res = await request(app.getHttpServer())
        .post('/orders/o1/retry')
        .expect(202);
      expect(res.body).toEqual({
        enqueued: true,
        previousStatus: 'supplier_failed',
      });
    });

    it('records manual tracking and pushes it to the channel', async () => {
      shipments.recordManualTracking.mockResolvedValue({
        shipmentId: 'sh1',
        pushed: true,
        idempotent: false,
      });
      const res = await request(app.getHttpServer())
        .post('/orders/o1/tracking')
        .send({
          carrierCode: 'DHL',
          carrierName: 'DHL Express',
          trackingNumber: 'T123',
        })
        .expect(200);
      expect(shipments.recordManualTracking).toHaveBeenCalledWith(
        TENANT_ID,
        'o1',
        {
          carrierCode: 'DHL',
          carrierName: 'DHL Express',
          trackingNumber: 'T123',
        },
      );
      expect(res.body).toEqual({
        shipmentId: 'sh1',
        pushed: true,
        idempotent: false,
      });
      await request(app.getHttpServer())
        .post('/orders/o1/tracking')
        .send({ carrierCode: 'DHL' })
        .expect(400);
    });
  });

  describe('operations', () => {
    const run = {
      id: 'r',
      kind: 'aw.catalog.full',
      connector: 'aw-aiku',
      status: 'succeeded',
      startedAt: iso,
      finishedAt: iso,
      counters: { seen: 3 },
      errorSummary: null,
    };
    const alert = {
      id: 'a1',
      type: 'margin_break',
      message: 'm',
      dedupeKey: 'k',
      status: 'open',
      raisedAt: iso,
      productId: 'p',
      channelId: null,
      channelOrderId: null,
    };

    it('GET /dashboard', async () => {
      dashboard.dashboard.mockResolvedValue({
        lastSyncRuns: [run],
        counts: {
          failedSyncRuns24h: 0,
          openAlerts: 1,
          failedOrders: 0,
          manualReviewOrders: 1,
          missingSupplierProducts: 0,
          productsByStatus: { draft: 2 },
          ordersByStatus: {},
        },
        alerts: [alert],
      });
      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .expect(200);
      expect(res.body.counts.openAlerts).toBe(1);
      expect(res.body.lastSyncRuns[0].kind).toBe('aw.catalog.full');
    });

    it('GET /sync-runs is paginated and filterable', async () => {
      dashboard.listSyncRuns.mockResolvedValue({ items: [run], total: 1 });
      const res = await request(app.getHttpServer())
        .get('/sync-runs?kind=aw.catalog.full&status=succeeded&take=5')
        .expect(200);
      expect(dashboard.listSyncRuns).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          kind: 'aw.catalog.full',
          status: 'succeeded',
          take: 5,
        }),
      );
      expect(res.body.meta.total).toBe(1);
    });

    it('GET /alerts defaults to open alerts; acknowledge records the actor', async () => {
      dashboard.listAlerts.mockResolvedValue({ items: [alert], total: 1 });
      await request(app.getHttpServer()).get('/alerts').expect(200);
      expect(dashboard.listAlerts).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ status: 'open' }),
      );
      dashboard.acknowledge.mockResolvedValue({
        id: 'a1',
        status: 'acknowledged',
      });
      const res = await request(app.getHttpServer())
        .post('/alerts/a1/acknowledge')
        .expect(200);
      expect(dashboard.acknowledge).toHaveBeenCalledWith(
        TENANT_ID,
        'a1',
        'admin@gemma.pt',
      );
      expect(res.body).toEqual({ id: 'a1', status: 'acknowledged' });
    });

    it('triggers catalogue and stock syncs (202)', async () => {
      sync.triggerCatalogSync.mockResolvedValue({
        enqueued: true,
        kind: 'catalog',
        supplierId: 's1',
      });
      sync.triggerStockCostSync.mockResolvedValue({
        enqueued: true,
        kind: 'stock-cost',
        supplierId: 's1',
      });
      expect(
        (
          await request(app.getHttpServer())
            .post('/sync/catalog')
            .send({})
            .expect(202)
        ).body,
      ).toEqual({ enqueued: true, kind: 'catalog', supplierId: 's1' });
      expect(sync.triggerCatalogSync).toHaveBeenCalledWith(
        TENANT_ID,
        undefined,
      );
      await request(app.getHttpServer())
        .post('/sync/stock-cost')
        .send({ supplierId: 's1' })
        .expect(202);
      expect(sync.triggerStockCostSync).toHaveBeenCalledWith(TENANT_ID, 's1');
    });
  });
});
