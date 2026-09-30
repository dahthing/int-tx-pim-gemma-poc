import { createMockDb } from '../testing/mock-db';
import { ChannelAdminService } from './channel-admin.service';

function setup() {
  const { db, mock } = createMockDb();
  const connector: Record<string, jest.Mock> = {
    deactivateListing: jest.fn().mockResolvedValue(undefined),
    getCategoryTree: jest
      .fn()
      .mockResolvedValue([
        { id: '1', parentId: null, name: 'A', leaf: true, extra: 'x' },
      ]),
    getCategoryAttributes: jest.fn().mockResolvedValue([
      { id: 'a', name: 'Colour', mandatory: true },
      { id: 'b', name: 'Size', mandatory: false },
    ]),
  };
  const connectors = { resolve: jest.fn().mockResolvedValue(connector) };
  const listings = {
    publishListing: jest
      .fn()
      .mockResolvedValue({ status: 'LIVE', externalId: 'x1', skipped: false }),
  };
  const mapping = {
    setMandatoryAttributes: jest.fn().mockResolvedValue(undefined),
  };
  return {
    mock,
    connector,
    connectors,
    listings,
    mapping,
    svc: new ChannelAdminService(
      db,
      listings as never,
      mapping as never,
      connectors as never,
    ),
  };
}

describe('ChannelAdminService.publish', () => {
  it('moves a ready product to PUBLISHED before publishing', async () => {
    const { svc, mock, listings } = setup();
    mock.product.findFirst.mockResolvedValue({ id: 'p', status: 'READY' });
    await expect(svc.publish('t', 'p', 'c')).resolves.toEqual({
      status: 'live',
      externalId: 'x1',
      skipped: false,
    });
    expect(mock.product.update).toHaveBeenCalledWith({
      where: { id: 'p' },
      data: { status: 'PUBLISHED' },
    });
    expect(listings.publishListing).toHaveBeenCalledWith('t', 'p', 'c');
  });

  it('does not touch an already published product', async () => {
    const { svc, mock } = setup();
    mock.product.findFirst.mockResolvedValue({ id: 'p', status: 'PUBLISHED' });
    await svc.publish('t', 'p', 'c');
    expect(mock.product.update).not.toHaveBeenCalled();
  });

  it('restores the previous status when the publish fails', async () => {
    const { svc, mock, listings } = setup();
    mock.product.findFirst.mockResolvedValue({ id: 'p', status: 'DRAFT' });
    listings.publishListing.mockRejectedValue(new Error('not approved'));
    await expect(svc.publish('t', 'p', 'c')).rejects.toThrow('not approved');
    expect(mock.product.update).toHaveBeenLastCalledWith({
      where: { id: 'p' },
      data: { status: 'DRAFT' },
    });
  });

  it('does not restore anything when an already published product fails to update', async () => {
    const { svc, mock, listings } = setup();
    mock.product.findFirst.mockResolvedValue({ id: 'p', status: 'PUBLISHED' });
    listings.publishListing.mockRejectedValue(new Error('x'));
    await expect(svc.publish('t', 'p', 'c')).rejects.toThrow('x');
    expect(mock.product.update).not.toHaveBeenCalled();
  });

  it('rejects unknown and archived products', async () => {
    const { svc, mock } = setup();
    mock.product.findFirst.mockResolvedValue(null);
    await expect(svc.publish('t', 'p', 'c')).rejects.toThrow(/not found/);
    mock.product.findFirst.mockResolvedValue({ id: 'p', status: 'ARCHIVED' });
    await expect(svc.publish('t', 'p', 'c')).rejects.toThrow(/archived/);
  });
});

describe('ChannelAdminService.unpublish', () => {
  const listing = {
    id: 'l',
    externalId: 'ext',
    channel: { id: 'c', code: 'temu-eu', settings: {} },
  };

  it('deactivates on the channel, zeroes stock locally and demotes a product with no other live listing', async () => {
    const { svc, mock, connector, connectors } = setup();
    mock.channelListing.findFirst.mockResolvedValue(listing);
    mock.channelListing.count.mockResolvedValue(0);
    await expect(svc.unpublish('t', 'p', 'c')).resolves.toEqual({
      status: 'inactive',
    });
    expect(connectors.resolve).toHaveBeenCalledWith({
      id: 'c',
      tenantId: 't',
      code: 'temu-eu',
      settings: {},
    });
    expect(connector.deactivateListing).toHaveBeenCalledWith('ext');
    expect(mock.channelListing.update).toHaveBeenCalledWith({
      where: { id: 'l' },
      data: expect.objectContaining({
        status: 'INACTIVE',
        lastStock: 0,
        lastError: null,
      }),
    });
    expect(mock.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p', tenantId: 't', status: 'PUBLISHED' },
      data: { status: 'READY' },
    });
  });

  it('keeps the product published while another channel is live, and skips the channel call for unlinked listings', async () => {
    const { svc, mock, connector } = setup();
    mock.channelListing.findFirst.mockResolvedValue({
      ...listing,
      externalId: null,
    });
    mock.channelListing.count.mockResolvedValue(1);
    await svc.unpublish('t', 'p', 'c');
    expect(connector.deactivateListing).not.toHaveBeenCalled();
    expect(mock.product.updateMany).not.toHaveBeenCalled();
  });

  it('404s a product without listing', async () => {
    const { svc, mock } = setup();
    mock.channelListing.findFirst.mockResolvedValue(null);
    await expect(svc.unpublish('t', 'p', 'c')).rejects.toThrow(/no listing/);
  });
});

describe('ChannelAdminService categories', () => {
  it('returns the category tree', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue({
      id: 'c',
      code: 'temu-eu',
      settings: {},
    });
    expect(await svc.categoryTree('t', 'c')).toEqual([
      { id: '1', parentId: null, name: 'A', leaf: true },
    ]);
  });

  it('rejects channels without tree or attribute support and unknown channels', async () => {
    const { svc, mock, connector } = setup();
    mock.channel.findFirst.mockResolvedValue({
      id: 'c',
      code: 'prestashop9',
      settings: {},
    });
    delete connector.getCategoryTree;
    delete connector.getCategoryAttributes;
    await expect(svc.categoryTree('t', 'c')).rejects.toThrow(/category tree/);
    await expect(svc.loadAttributes('t', 'c', '1')).rejects.toThrow(
      /attributes/,
    );
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(svc.categoryTree('t', 'zz')).rejects.toThrow(/Channel zz/);
  });

  it('stores the mandatory attributes of a channel category', async () => {
    const { svc, mock, mapping } = setup();
    mock.channel.findFirst.mockResolvedValue({
      id: 'c',
      code: 'temu-eu',
      settings: {},
    });
    const r = await svc.loadAttributes('t', 'c', '1');
    expect(r.mandatory).toEqual(['Colour']);
    expect(r.items).toHaveLength(2);
    expect(mapping.setMandatoryAttributes).toHaveBeenCalledWith('t', 'c', '1', [
      'Colour',
    ]);
  });
});
