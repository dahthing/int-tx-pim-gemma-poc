import { JOB_PATTERNS } from '@repo/shared';
import { BullOrderRoutingEnqueuer } from './order-routing.enqueuer';

describe('BullOrderRoutingEnqueuer', () => {
  it('enqueues one idempotent routing job per channel order', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({}),
      getJob: jest.fn().mockResolvedValue(undefined),
    };
    await new BullOrderRoutingEnqueuer(queue as never).enqueueRouting({
      tenantId: 't',
      channelOrderId: 'o1',
    });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.ROUTE_SUPPLIER_ORDER,
      { tenantId: 't', channelOrderId: 'o1' },
      { jobId: 'route-o1' },
    );
  });
});
