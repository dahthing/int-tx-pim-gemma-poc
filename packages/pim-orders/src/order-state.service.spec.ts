import { ConflictException } from '@nestjs/common';
import { DomainError } from '@repo/core-domain';
import { OrderStateService } from './order-state.service';
import { asDb, createDbMock, TENANT, type DbMock } from './testing/testing';

describe('OrderStateService', () => {
  let db: DbMock;
  let svc: OrderStateService;
  const order = (s: string) => ({ id: 'o1', tenantId: TENANT, internalStatus: s });

  beforeEach(() => {
    db = createDbMock();
    db.channelOrder.updateMany.mockResolvedValue({ count: 1 });
    svc = new OrderStateService(asDb(db));
  });

  it('applies a valid single transition with optimistic, tenant-scoped update', async () => {
    await expect(svc.moveTo(order('IMPORTED'), 'ROUTING')).resolves.toBe('ROUTING');
    expect(db.channelOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', tenantId: TENANT, internalStatus: 'IMPORTED' },
      data: { internalStatus: 'ROUTING' },
    });
  });

  it('is a no-op when already in the target state', async () => {
    await expect(svc.moveTo(order('ROUTING'), 'ROUTING')).resolves.toBe('ROUTING');
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
  });

  it('walks intermediate states through the machine', async () => {
    await expect(svc.moveTo(order('SUPPLIER_SUBMITTED'), 'TRACKING_PUSHED')).resolves.toBe('TRACKING_PUSHED');
    expect(db.channelOrder.updateMany.mock.calls.map((c) => c[0].data.internalStatus)).toEqual([
      'SUPPLIER_DISPATCHED',
      'TRACKING_PUSHED',
    ]);
  });

  it('rejects unreachable targets with a domain error and writes nothing', async () => {
    await expect(svc.moveTo(order('COMPLETED'), 'ROUTING')).rejects.toBeInstanceOf(DomainError);
    await expect(svc.moveTo(order('CANCELLED'), 'IMPORTED')).rejects.toBeInstanceOf(DomainError);
    expect(db.channelOrder.updateMany).not.toHaveBeenCalled();
  });

  it('throws Conflict when a concurrent writer changed the state', async () => {
    db.channelOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.moveTo(order('IMPORTED'), 'ROUTING')).rejects.toBeInstanceOf(ConflictException);
  });

  it('canReach mirrors the machine', () => {
    expect(svc.canReach('SUPPLIER_SUBMITTED', 'MANUAL_REVIEW')).toBe(true);
    expect(svc.canReach('COMPLETED', 'MANUAL_REVIEW')).toBe(false);
    expect(svc.canReach('COMPLETED', 'COMPLETED')).toBe(true);
  });
});
