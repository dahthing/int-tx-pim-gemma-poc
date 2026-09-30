import { createMockDb } from '../testing/mock-db';
import { ConnectorListingStockZeroer } from './listing-stock.zeroer';

function setup() {
  const { db, mock } = createMockDb();
  mock.channelListing.findMany.mockResolvedValue([
    {
      id: 'l1',
      channelId: 'c1',
      externalId: 'e1',
      externalVariantId: 'v1',
      channel: { id: 'c1', code: 'temu-eu', settings: {} },
    },
    {
      id: 'l2',
      channelId: 'c1',
      externalId: 'e2',
      externalVariantId: null,
      channel: { id: 'c1', code: 'temu-eu', settings: {} },
    },
    {
      id: 'l3',
      channelId: 'c2',
      externalId: null,
      externalVariantId: null,
      channel: { id: 'c2', code: 'prestashop9', settings: {} },
    },
  ]);
  const connector = {
    updateStock: jest.fn().mockResolvedValue({ results: [] }),
  };
  const connectors = { resolve: jest.fn().mockResolvedValue(connector) };
  return {
    mock,
    connector,
    connectors,
    zeroer: new ConnectorListingStockZeroer(db, connectors as never),
  };
}

describe('ConnectorListingStockZeroer', () => {
  it('sets stock 0 on every linked listing, per channel, and records it', async () => {
    const { zeroer, connector, connectors, mock } = setup();
    await zeroer.zeroStock('t', ['p1']);
    expect(connectors.resolve).toHaveBeenCalledTimes(1);
    expect(connectors.resolve).toHaveBeenCalledWith({
      id: 'c1',
      tenantId: 't',
      code: 'temu-eu',
      settings: {},
    });
    expect(connector.updateStock).toHaveBeenCalledWith([
      { externalId: 'e1', externalVariantId: 'v1', available: 0 },
      { externalId: 'e2', available: 0 },
    ]);
    expect(mock.channelListing.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't', productId: { in: ['p1'] } },
      data: { lastStock: 0 },
    });
  });

  it('is a no-op for an empty product list', async () => {
    const { zeroer, mock } = setup();
    await zeroer.zeroStock('t', []);
    expect(mock.channelListing.findMany).not.toHaveBeenCalled();
  });

  it('still records the local zero when a channel update fails, then reports the failure', async () => {
    const { zeroer, connector, mock } = setup();
    connector.updateStock.mockRejectedValue(new Error('channel down'));
    await expect(zeroer.zeroStock('t', ['p1'])).rejects.toThrow(/channel down/);
    expect(mock.channelListing.updateMany).toHaveBeenCalled();
  });
});
