import { ConflictException, Injectable } from '@nestjs/common';
import { ALLOWED_TRANSITIONS, canTransition, transition, type OrderState } from '@repo/core-domain';
import { DatabaseService } from '@repo/database';

export interface OrderStateRef {
  id: string;
  tenantId: string;
  /** Prisma OrderInternalStatus value (UPPER_SNAKE). */
  internalStatus: string;
}

const toDomain = (s: string): OrderState => s.toLowerCase() as OrderState;
const toDb = (s: OrderState): string => s.toUpperCase();

/** Shortest path through the FR-ORD-001 machine (BFS follows ALLOWED_TRANSITIONS order). */
function path(from: OrderState, to: OrderState): OrderState[] | null {
  const prev = new Map<OrderState, OrderState | null>([[from, null]]);
  const queue: OrderState[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) {
      const out: OrderState[] = [];
      for (let n: OrderState | null | undefined = to; n && n !== from; n = prev.get(n)) out.unshift(n);
      return out;
    }
    for (const next of ALLOWED_TRANSITIONS[cur] ?? []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  return null;
}

/** Only writer of ChannelOrder.internalStatus: every hop is validated by the core-domain machine. */
@Injectable()
export class OrderStateService {
  constructor(private readonly db: DatabaseService) {}

  canReach(from: string, to: string): boolean {
    return toDomain(from) === toDomain(to) || path(toDomain(from), toDomain(to)) !== null;
  }

  async moveTo(order: OrderStateRef, target: string): Promise<string> {
    const from = toDomain(order.internalStatus);
    const to = toDomain(target);
    if (from === to) return order.internalStatus;
    const hops = path(from, to);
    if (!hops) {
      transition(from, to); // throws INVALID_ORDER_TRANSITION
      /* istanbul ignore next */
      throw new Error('unreachable');
    }
    let cur = from;
    for (const next of hops) {
      if (!canTransition(cur, next)) transition(cur, next);
      const res = await this.db.channelOrder.updateMany({
        where: { id: order.id, tenantId: order.tenantId, internalStatus: toDb(cur) as never },
        data: { internalStatus: toDb(next) as never },
      });
      if (res.count === 0) {
        throw new ConflictException(`Order ${order.id} changed concurrently while moving ${cur} -> ${next}`);
      }
      cur = next;
    }
    return toDb(to);
  }
}
