import { PimJobs } from './pim-jobs';

function build() {
  const ingestion = { runFullSync: jest.fn().mockResolvedValue('full') };
  const stockSync = { run: jest.fn().mockResolvedValue('stock') };
  const orderImport = { importChannel: jest.fn().mockResolvedValue('import') };
  const saga = { route: jest.fn().mockResolvedValue('route') };
  const status = { pollSubmitted: jest.fn().mockResolvedValue('poll') };
  const shipments = {
    pushShipment: jest.fn().mockResolvedValue('push'),
    scanShipByDeadlines: jest.fn().mockResolvedValue('scan'),
    purgeExpiredPii: jest.fn().mockResolvedValue('purge'),
  };
  const listings = {
    publishListing: jest.fn().mockResolvedValue('publish'),
    syncStockAndPrices: jest.fn().mockResolvedValue('sync'),
    pollReviews: jest.fn().mockResolvedValue('reviews'),
  };
  const scope = {
    run: jest.fn((_t: string, _s: string, fn: () => Promise<unknown>) => fn()),
    runForTenant: jest.fn((_t: string, fn: () => Promise<unknown>) => fn()),
  };
  const jobs = new PimJobs(
    ingestion as never,
    stockSync as never,
    orderImport as never,
    saga as never,
    status as never,
    shipments as never,
    listings as never,
    scope as never,
  );
  return {
    jobs,
    ingestion,
    stockSync,
    orderImport,
    saga,
    status,
    shipments,
    listings,
    scope,
  };
}

describe('PimJobs', () => {
  it('runs the full catalogue sync inside the supplier scope', async () => {
    const { jobs, ingestion, scope } = build();
    await expect(jobs.runCatalogFullSync('t', 's')).resolves.toBe('full');
    expect(scope.run).toHaveBeenCalledWith('t', 's', expect.any(Function));
    expect(ingestion.runFullSync).toHaveBeenCalledWith('t', 's');
  });

  it('runs the stock and cost sync inside the supplier scope', async () => {
    const { jobs, stockSync, scope } = build();
    await expect(jobs.runStockCostSync('t', 's')).resolves.toBe('stock');
    expect(scope.run).toHaveBeenCalledWith('t', 's', expect.any(Function));
    expect(stockSync.run).toHaveBeenCalledWith('t', 's');
  });

  it('delegates order jobs', async () => {
    const { jobs, orderImport, saga, status, shipments } = build();
    await expect(jobs.importChannelOrders('t', 'c')).resolves.toBe('import');
    expect(orderImport.importChannel).toHaveBeenCalledWith('t', 'c');
    await expect(jobs.routeSupplierOrder('t', 'o')).resolves.toBe('route');
    expect(saga.route).toHaveBeenCalledWith('t', 'o');
    await expect(jobs.pollSupplierOrders('t')).resolves.toBe('poll');
    expect(status.pollSubmitted).toHaveBeenCalledWith('t');
    await expect(jobs.pushShipment('t', 'sh')).resolves.toBe('push');
    expect(shipments.pushShipment).toHaveBeenCalledWith('t', 'sh');
  });

  it('delegates the maintenance scans with optional clock and retention', async () => {
    const { jobs, shipments } = build();
    const now = new Date('2026-01-01T00:00:00Z');
    await expect(jobs.scanShipByDeadlines('t', now)).resolves.toBe('scan');
    expect(shipments.scanShipByDeadlines).toHaveBeenCalledWith('t', now);
    await expect(jobs.purgeOrderPii('t', now, 30)).resolves.toBe('purge');
    expect(shipments.purgeExpiredPii).toHaveBeenCalledWith('t', now, 30);
    await jobs.purgeOrderPii('t');
    expect(shipments.purgeExpiredPii).toHaveBeenLastCalledWith(
      't',
      undefined,
      undefined,
    );
  });

  it('delegates listing jobs', async () => {
    const { jobs, listings } = build();
    await expect(jobs.publishListing('t', 'p', 'c')).resolves.toBe('publish');
    expect(listings.publishListing).toHaveBeenCalledWith('t', 'p', 'c');
    await expect(jobs.syncListings('t', 'c', ['p1'])).resolves.toBe('sync');
    expect(listings.syncStockAndPrices).toHaveBeenCalledWith('t', 'c');
    await expect(jobs.pollListingReviews('t', 'c')).resolves.toBe('reviews');
    expect(listings.pollReviews).toHaveBeenCalledWith('t', 'c');
  });
});
