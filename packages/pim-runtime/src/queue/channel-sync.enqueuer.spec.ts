import { JOB_PATTERNS } from '@repo/shared';
import { createMockDb } from '../testing/mock-db';
import { BullChannelSyncEnqueuer } from './channel-sync.enqueuer';

describe('BullChannelSyncEnqueuer', () => {
  it('enqueues one sync per channel that lists the changed products', async () => {
    const { db, mock } = createMockDb();
    mock.channelListing.findMany.mockResolvedValue([
      { channelId: 'c1' },
      { channelId: 'c2' },
    ]);
    const queue = {
      add: jest.fn().mockResolvedValue({}),
      getJob: jest.fn().mockResolvedValue(undefined),
    };
    await new BullChannelSyncEnqueuer(db, queue as never).enqueueProductUpdates(
      't',
      ['p1', 'p2'],
    );
    expect(mock.channelListing.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't',
        productId: { in: ['p1', 'p2'] },
        deletedAt: null,
      },
      distinct: ['channelId'],
      select: { channelId: true },
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SYNC_LISTING_STOCK_PRICE,
      { tenantId: 't', channelId: 'c1', productIds: ['p1', 'p2'] },
      { jobId: 'sync-t-c1' },
    );
  });

  it('does nothing without products or listings', async () => {
    const { db, mock } = createMockDb();
    const queue = { add: jest.fn(), getJob: jest.fn() };
    const e = new BullChannelSyncEnqueuer(db, queue as never);
    await e.enqueueProductUpdates('t', []);
    expect(mock.channelListing.findMany).not.toHaveBeenCalled();
    mock.channelListing.findMany.mockResolvedValue([]);
    await e.enqueueProductUpdates('t', ['p']);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
