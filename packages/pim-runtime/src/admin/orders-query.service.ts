import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, Prisma } from '@repo/database';
import {
  decodeOrderLines,
  PIM_ORDERS_TOKENS,
  type OrderRoutingEnqueuer,
} from '@repo/pim-orders';
import type {
  OrderDetail,
  OrderListItem,
  OrderListQuery,
} from '@repo/shared-types';
import { dec, iso, isoOrNull, lower, orderBy, upper } from '../util/mappers';

const ORDER_SORT = [
  'id',
  'placedAt',
  'createdAt',
  'externalId',
  'internalStatus',
] as const;
/** Same set the supplier saga accepts (SupplierOrderSagaService ROUTABLE). */
const RETRYABLE = ['IMPORTED', 'ROUTING', 'SUPPLIER_FAILED', 'MANUAL_REVIEW'];

const include = {
  channel: { select: { code: true } },
  supplierOrder: true,
  shipments: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ChannelOrderInclude;
type Row = Prisma.ChannelOrderGetPayload<{ include: typeof include }>;

/**
 * Order read models. Customer and address columns are encrypted PII and are never selected into a response (NFR-04):
 * the back office needs the order state, totals, supplier order and tracking, not the recipient.
 */
@Injectable()
export class OrdersQueryService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ROUTING_ENQUEUER)
    private readonly routing: OrderRoutingEnqueuer,
  ) {}

  async list(
    tenantId: string,
    q: OrderListQuery,
  ): Promise<{ items: OrderListItem[]; total: number }> {
    const where: Prisma.ChannelOrderWhereInput = {
      tenantId,
      ...(q.status && {
        internalStatus: upper(
          q.status,
        ) as Prisma.ChannelOrderWhereInput['internalStatus'],
      }),
      ...(q.channelId && { channelId: q.channelId }),
      ...(q.search && {
        externalId: { contains: q.search, mode: 'insensitive' },
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.channelOrder.findMany({
        where,
        include,
        skip: q.skip,
        take: q.take,
        orderBy: this.sort(q),
      }),
      this.db.channelOrder.count({ where }),
    ]);
    return { items: rows.map((r) => this.toListItem(r)), total };
  }

  async detail(tenantId: string, id: string): Promise<OrderDetail> {
    const row = await this.db.channelOrder.findFirst({
      where: { id, tenantId },
      include,
    });
    if (!row) throw new NotFoundException(`Order ${id} not found`);
    const meta = decodeOrderLines(row.lines);
    return {
      ...this.toListItem(row),
      totalNet: dec(row.totalNet),
      totalShipping: dec(row.totalShipping),
      lines: meta.items.map((l) => ({
        sku: l.sku,
        quantity: l.quantity,
        unitPrice: l.unitPrice ?? null,
      })),
      shipments: row.shipments.map((s) => ({
        id: s.id,
        carrierCode: s.carrierCode,
        carrierName: s.carrierName,
        trackingNumber: s.trackingNumber,
        source: lower(s.source),
        pushedToChannelAt: isoOrNull(s.pushedToChannelAt),
        pushError: s.pushError,
        createdAt: iso(s.createdAt),
      })),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  /** Re-runs the supplier saga (asynchronously, through the routing queue). */
  async retry(tenantId: string, id: string) {
    const order = await this.db.channelOrder.findFirst({
      where: { id, tenantId },
      select: { id: true, internalStatus: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (!RETRYABLE.includes(order.internalStatus)) {
      throw new ConflictException(
        `Order ${id} is ${lower(order.internalStatus)} and cannot be routed again`,
      );
    }
    await this.routing.enqueueRouting({ tenantId, channelOrderId: id });
    return {
      enqueued: true as const,
      previousStatus: lower(order.internalStatus),
    };
  }

  /** The untouched pagination default (sortBy=id) means "newest first" for orders. */
  private sort(q: OrderListQuery): Record<string, 'asc' | 'desc'> {
    return q.sortBy === 'id'
      ? { placedAt: 'desc' }
      : orderBy(q.sortBy, q.sortOrder, ORDER_SORT, 'placedAt');
  }

  private toListItem(r: Row): OrderListItem {
    const meta = decodeOrderLines(r.lines);
    const so = r.supplierOrder;
    return {
      id: r.id,
      channelId: r.channelId,
      channelCode: r.channel.code,
      externalId: r.externalId,
      externalStatus: r.externalStatus,
      placedAt: iso(r.placedAt),
      status: lower(r.internalStatus),
      totalGross: dec(r.totalGross),
      currency: r.currency,
      lineCount: meta.items.length,
      shipByAt: isoOrNull(meta.shipByAt),
      manualReviewReason: meta.manualReviewReason,
      supplierOrder: so
        ? {
            id: so.id,
            supplierId: so.supplierId,
            state: lower(so.state),
            externalOrderId: so.externalOrderId,
            externalReference: so.externalReference,
            totalNet: dec(so.totalNet),
            lastError: so.lastError,
          }
        : null,
      hasTracking: r.shipments.length > 0,
    };
  }
}
