import { NotFoundException } from '@nestjs/common';
import type { PriceInput, StockInput } from '@repo/core-domain';
import { ORDER_ALERT_TYPES } from './constants';
import { ListingSyncService } from './listing-sync.service';
import { encodeListingState } from './listing-state.codec';
import { asDb, createDbMock, TENANT, type DbMock } from './testing/testing';

const payload = { sku: 'SKU1', title: 't', priceNet: '10.00', stock: 4, vatRate: '0.23' } as never;
const rule = { id: 'default', markupPct: '0.5', minMarginPct: '0.1', rounding: 'none', priority: 0 } as never;
const stockIn = (over: Partial<StockInput> = {}): StockInput => ({ supplierStock: 10, buffer: 2, published: true, supplierProductMissing: false, assortmentDisabled: false, ...over });
const priceIn = (over: Partial<PriceInput> = {}): PriceInput => ({ cost: '10', vatRate: '0.23', rules: [], defaultRule: rule, ...over });

describe('ListingSyncService', () => {
  let db: DbMock;
  let connector: { upsertListing: jest.Mock; updateStock: jest.Mock; updatePrice: jest.Mock; pollReviewStatus: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let builder: { build: jest.Mock };
  let inputs: { getInputs: jest.Mock };
  let alerts: { raise: jest.Mock };
  let svc: ListingSyncService;
  const channel = { id: 'ch1', tenantId: TENANT, code: 'prestashop9', settings: {} };

  beforeEach(() => {
    db = createDbMock();
    connector = {
      upsertListing: jest.fn(),
      updateStock: jest.fn().mockResolvedValue({ results: [], okCount: 0, failCount: 0 }),
      updatePrice: jest.fn().mockResolvedValue({ results: [], okCount: 0, failCount: 0 }),
      pollReviewStatus: jest.fn(),
    };
    resolver = { resolve: jest.fn().mockResolvedValue(connector) };
    builder = { build: jest.fn().mockResolvedValue(payload) };
    inputs = { getInputs: jest.fn().mockResolvedValue([]) };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
    db.channel.findFirst.mockResolvedValue(channel);
    db.channelListing.findFirst.mockResolvedValue(null);
    db.channelListing.upsert.mockResolvedValue({ id: 'l1' });
    db.channelListing.update.mockResolvedValue({});
    svc = new ListingSyncService(asDb(db), resolver, builder, inputs, alerts);
  });

  describe('publishListing', () => {
    it('404 for an unknown channel', async () => {
      db.channel.findFirst.mockResolvedValue(null);
      await expect(svc.publishListing(TENANT, 'p1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates the listing from the connector result and stores status, price, stock, hash and checksums', async () => {
      connector.upsertListing.mockResolvedValue({ externalId: 'X1', externalVariantId: 'V1', status: 'live', payloadHash: 'h1', imageChecksums: ['c1'] });
      const res = await svc.publishListing(TENANT, 'p1', 'ch1');
      expect(builder.build).toHaveBeenCalledWith(TENANT, 'p1', 'ch1');
      expect(connector.upsertListing).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU1', externalId: undefined, lastPayloadHash: undefined }));
      expect(db.channelListing.upsert).toHaveBeenCalledWith({
        where: { productId_channelId: { productId: 'p1', channelId: 'ch1' } },
        create: expect.objectContaining({ tenantId: TENANT, productId: 'p1', channelId: 'ch1', externalId: 'X1', externalVariantId: 'V1', status: 'LIVE', lastPrice: '10.00', lastStock: 4, lastPayloadHash: encodeListingState('h1', ['c1']), lastError: null }),
        update: expect.objectContaining({ externalId: 'X1', status: 'LIVE', lastPayloadHash: encodeListingState('h1', ['c1']) }),
      });
      expect(res).toEqual({ status: 'LIVE', externalId: 'X1', skipped: false });
    });

    it('round-trips the previous hash and checksums into the next upsert; unchanged payload is skipped', async () => {
      db.channelListing.findFirst.mockResolvedValue({ id: 'l1', externalId: 'X1', externalVariantId: 'V1', lastPayloadHash: encodeListingState('h1', ['c1']), lastPrice: '9', lastStock: 1 });
      connector.upsertListing.mockResolvedValue({ externalId: 'X1', status: 'live', skipped: true, reason: 'payload_unchanged', payloadHash: 'h1', imageChecksums: ['c1'] });
      const res = await svc.publishListing(TENANT, 'p1', 'ch1');
      expect(connector.upsertListing).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'X1', lastPayloadHash: 'h1', lastImageChecksums: ['c1'] }));
      const update = db.channelListing.upsert.mock.calls[0][0].update;
      expect(update.lastError).toBeNull();
      expect(update).not.toHaveProperty('lastPrice'); // nothing was sent
      expect(res.skipped).toBe(true);
    });

    it('stores a skip reason (e.g. Temu validation) as lastError and keeps the old hash', async () => {
      db.channelListing.findFirst.mockResolvedValue({ id: 'l1', externalId: null, lastPayloadHash: 'old' });
      connector.upsertListing.mockResolvedValue({ externalId: '', status: 'inactive', skipped: true, reason: 'missing: images' });
      await svc.publishListing(TENANT, 'p1', 'ch1');
      const update = db.channelListing.upsert.mock.calls[0][0].update;
      expect(update).toMatchObject({ status: 'INACTIVE', lastError: 'missing: images', lastPayloadHash: 'old' });
      expect(update.externalId).toBeUndefined();
    });

    it.each([
      ['submitted', 'SUBMITTED'],
      ['rejected', 'REJECTED'],
    ])('maps %s', async (s, expected) => {
      connector.upsertListing.mockResolvedValue({ externalId: 'X', status: s, reason: s === 'rejected' ? 'bad' : undefined });
      const res = await svc.publishListing(TENANT, 'p1', 'ch1');
      expect(res.status).toBe(expected);
    });

    it('records lastError and rethrows when the connector fails', async () => {
      connector.upsertListing.mockRejectedValue(new Error('PS down'));
      await expect(svc.publishListing(TENANT, 'p1', 'ch1')).rejects.toThrow('PS down');
      expect(db.channelListing.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'PENDING', lastError: 'PS down' }), update: { lastError: 'PS down' } }),
      );
    });

    it('records lastError and rethrows when the payload cannot be built', async () => {
      builder.build.mockRejectedValue(new Error('not approved'));
      await expect(svc.publishListing(TENANT, 'p1', 'ch1')).rejects.toThrow('not approved');
      expect(connector.upsertListing).not.toHaveBeenCalled();
      expect(db.channelListing.upsert.mock.calls[0][0].update).toEqual({ lastError: 'not approved' });
    });
  });

  describe('syncStockAndPrices', () => {
    const listing = (id: string, over: Record<string, unknown> = {}) => ({ id, productId: `p-${id}`, externalId: `X-${id}`, externalVariantId: null, lastStock: null, lastPrice: null, ...over });

    it('loads only live, linked listings of the channel and skips the connector when nothing is desired', async () => {
      db.channelListing.findMany.mockResolvedValue([]);
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(db.channelListing.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, channelId: 'ch1', deletedAt: null, status: 'LIVE', externalId: { not: null } } });
      expect(connector.updateStock).not.toHaveBeenCalled();
      expect(res).toMatchObject({ considered: 0 });
    });

    it('sends only changed stock / price and persists them on success', async () => {
      db.channelListing.findMany.mockResolvedValue([
        listing('a'), // never synced: both
        listing('b', { lastStock: 8, lastPrice: '99' }), // stock unchanged (10-2=8); price changes
        listing('c', { lastStock: 8, lastPrice: { toString: () => '0' } }), // filled below
      ]);
      const priced = priceIn();
      inputs.getInputs.mockResolvedValue([
        { productId: 'p-a', stock: stockIn(), price: priced },
        { productId: 'p-b', stock: stockIn(), price: priced },
      ]);
      connector.updateStock.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true }], okCount: 1, failCount: 0 });
      connector.updatePrice.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true }, { externalId: 'X-b', ok: true }], okCount: 2, failCount: 0 });
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(inputs.getInputs).toHaveBeenCalledWith(TENANT, 'ch1', ['p-a', 'p-b', 'p-c']);
      expect(connector.updateStock).toHaveBeenCalledWith([{ externalId: 'X-a', available: 8 }]);
      const sent = connector.updatePrice.mock.calls[0][0];
      expect(sent.map((i: { externalId: string }) => i.externalId)).toEqual(['X-a', 'X-b']);
      expect(res).toMatchObject({ considered: 2, stockSent: 1, priceSent: 2, failed: 0, blocked: 0 });
      expect(db.channelListing.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: expect.objectContaining({ lastStock: 8, lastError: null }) });
      expect(db.channelListing.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: expect.objectContaining({ lastPrice: sent[1].priceNet, lastError: null }) });
    });

    it('skips unchanged price (Decimal compare) and unchanged stock entirely', async () => {
      const priced = priceIn();
      db.channelListing.findMany.mockResolvedValue([listing('a')]);
      inputs.getInputs.mockResolvedValue([{ productId: 'p-a', stock: stockIn(), price: priced }]);
      connector.updateStock.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true }], okCount: 1, failCount: 0 });
      connector.updatePrice.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true }], okCount: 1, failCount: 0 });
      await svc.syncStockAndPrices(TENANT, 'ch1');
      const net = connector.updatePrice.mock.calls[0][0][0].priceNet;
      connector.updateStock.mockClear();
      connector.updatePrice.mockClear();
      db.channelListing.findMany.mockResolvedValue([listing('a', { lastStock: 8, lastPrice: { toString: () => `${net}00` } })]);
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(connector.updateStock).not.toHaveBeenCalled();
      expect(connector.updatePrice).not.toHaveBeenCalled();
      expect(res).toMatchObject({ unchanged: 1, stockSent: 0, priceSent: 0 });
    });

    it('never sends a margin-blocked price and alerts, but still syncs its stock', async () => {
      db.channelListing.findMany.mockResolvedValue([listing('a')]);
      // cost 100 with a 0.5 markup rule and 90% min margin: blocked
      const blockedRule = { id: 'r', markupPct: '0.01', minMarginPct: '0.9', rounding: 'none', priority: 0 } as never;
      inputs.getInputs.mockResolvedValue([{ productId: 'p-a', stock: stockIn(), price: priceIn({ cost: '100', defaultRule: blockedRule }) }]);
      connector.updateStock.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true }], okCount: 1, failCount: 0 });
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(connector.updatePrice).not.toHaveBeenCalled();
      expect(connector.updateStock).toHaveBeenCalled();
      expect(res).toMatchObject({ blocked: 1, priceSent: 0, stockSent: 1 });
      expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.PRICE_BLOCKED, tenantId: TENANT }));
    });

    it('records per-item failures and leaves skipped (pending review) items untouched', async () => {
      db.channelListing.findMany.mockResolvedValue([listing('a'), listing('b')]);
      inputs.getInputs.mockResolvedValue([
        { productId: 'p-a', stock: stockIn(), price: priceIn() },
        { productId: 'p-b', stock: stockIn(), price: priceIn() },
      ]);
      connector.updateStock.mockResolvedValue({ results: [{ externalId: 'X-a', ok: false, error: 'boom' }, { externalId: 'X-b', ok: true }], okCount: 1, failCount: 1 });
      connector.updatePrice.mockResolvedValue({ results: [{ externalId: 'X-a', ok: true, skipped: true, error: 'pending review' }, { externalId: 'X-b', ok: true }, { externalId: 'unknown', ok: true }], okCount: 3, failCount: 0 });
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(res).toMatchObject({ failed: 1, skipped: 1 });
      expect(db.channelListing.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { lastError: 'boom' } });
      const priceWrites = db.channelListing.update.mock.calls.filter((c) => 'lastPrice' in c[0].data);
      expect(priceWrites.map((c) => c[0].where.id)).toEqual(['b']);
    });

    it('counts a listing whose inputs cannot be priced as failed and continues', async () => {
      db.channelListing.findMany.mockResolvedValue([listing('a')]);
      inputs.getInputs.mockResolvedValue([{ productId: 'p-a', stock: stockIn(), price: priceIn({ vatRate: 'abc' }) }]);
      const res = await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(res.failed).toBe(1);
    });

    it('passes the variant id through', async () => {
      db.channelListing.findMany.mockResolvedValue([listing('a', { externalVariantId: 'V9' })]);
      inputs.getInputs.mockResolvedValue([{ productId: 'p-a', stock: stockIn(), price: priceIn() }]);
      await svc.syncStockAndPrices(TENANT, 'ch1');
      expect(connector.updateStock).toHaveBeenCalledWith([{ externalId: 'X-a', externalVariantId: 'V9', available: 8 }]);
    });
  });

  describe('pollReviews', () => {
    it('moves submitted listings to live / rejected (with reason) and leaves pending ones', async () => {
      db.channelListing.findMany.mockResolvedValue([
        { id: 'a', externalId: 'X-a', productId: 'p-a' },
        { id: 'b', externalId: 'X-b', productId: 'p-b' },
        { id: 'c', externalId: 'X-c', productId: 'p-c' },
      ]);
      connector.pollReviewStatus.mockResolvedValue([
        { externalId: 'X-a', status: 'live' },
        { externalId: 'X-b', status: 'rejected', reason: 'bad images' },
        { externalId: 'X-c', status: 'submitted' },
        { externalId: 'other', status: 'live' },
      ]);
      const res = await svc.pollReviews(TENANT, 'ch1');
      expect(db.channelListing.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, channelId: 'ch1', deletedAt: null, status: 'SUBMITTED', externalId: { not: null } } });
      expect(connector.pollReviewStatus).toHaveBeenCalledWith(['X-a', 'X-b', 'X-c']);
      expect(db.channelListing.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'LIVE', lastError: null, lastSyncedAt: expect.any(Date) } });
      expect(db.channelListing.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { status: 'REJECTED', lastError: 'bad images', lastSyncedAt: expect.any(Date) } });
      expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_ALERT_TYPES.LISTING_REJECTED }));
      expect(res).toEqual({ checked: 3, live: 1, rejected: 1, pending: 1 });
    });

    it('does nothing for connectors without review polling or with nothing submitted', async () => {
      db.channelListing.findMany.mockResolvedValue([{ id: 'a', externalId: 'X-a', productId: 'p' }]);
      delete (connector as Partial<typeof connector>).pollReviewStatus;
      await expect(svc.pollReviews(TENANT, 'ch1')).resolves.toEqual({ checked: 0, live: 0, rejected: 0, pending: 0 });
      connector.pollReviewStatus = jest.fn();
      db.channelListing.findMany.mockResolvedValue([]);
      await svc.pollReviews(TENANT, 'ch1');
      expect(connector.pollReviewStatus).not.toHaveBeenCalled();
    });
  });
});
