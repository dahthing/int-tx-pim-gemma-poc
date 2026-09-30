import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { canTransition, decideCancellation, type OrderState, type SupplierOrderStatus } from '@repo/core-domain';
import { DatabaseService } from '@repo/database';
import { ORDER_ALERT_TYPES, PIM_ORDERS_TOKENS } from './constants';
import { errorMessage } from './json';
import { OrderStateService } from './order-state.service';
import type { OrderAlertPort, SupplierGatewayResolver } from './ports';

export interface CancellationResult {
  action: 'cancel' | 'delete_supplier_draft' | 'manual_review' | 'ignored';
  nextState?: string;
}

const TERMINAL = ['CANCELLED', 'COMPLETED'];

/** FR-ORD-001 AC2: channel-initiated cancellation. */
@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly states: OrderStateService,
    @Inject(PIM_ORDERS_TOKENS.SUPPLIER_GATEWAY_RESOLVER) private readonly gateways: SupplierGatewayResolver,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ALERT_PORT) private readonly alerts: OrderAlertPort,
  ) {}

  async handleChannelCancellation(tenantId: string, channelOrderId: string): Promise<CancellationResult> {
    const order = await this.db.channelOrder.findFirst({
      where: { id: channelOrderId, tenantId },
      include: { supplierOrder: true },
    });
    if (!order) throw new NotFoundException(`Channel order ${channelOrderId} not found`);
    if (TERMINAL.includes(order.internalStatus)) return { action: 'ignored' };

    const so = order.supplierOrder;
    const decision = decideCancellation(this.supplierStatus(so));

    if (decision.action === 'delete_supplier_draft') {
      try {
        if (so!.externalOrderId) {
          const gateway = await this.gateways.resolve(tenantId, so!.supplierId);
          await gateway.deleteSupplierDraft(so!.externalOrderId);
        }
      } catch (e) {
        const message = `Could not delete supplier draft ${so!.externalOrderId}: ${errorMessage(e)}`;
        this.logger.error(message);
        await this.alert(tenantId, order, ORDER_ALERT_TYPES.SUPPLIER_DRAFT_DELETE_FAILED, message);
        await this.states.moveTo(order, 'MANUAL_REVIEW');
        return { action: 'manual_review', nextState: 'MANUAL_REVIEW' };
      }
      await this.db.supplierOrder.update({ where: { id: so!.id }, data: { state: 'CANCELLED' } });
      await this.states.moveTo(order, 'CANCELLED');
      return { action: decision.action, nextState: 'CANCELLED' };
    }

    if (decision.action === 'manual_review') {
      await this.alert(tenantId, order, ORDER_ALERT_TYPES.CANCELLATION_NEEDS_MANUAL_REVIEW, `Channel cancelled order ${order.externalId} but the supplier order is already submitted`);
      // Only a direct machine hop: a dispatched order must not be pushed through tracking_missing.
      if (!canTransition(order.internalStatus.toLowerCase() as OrderState, 'manual_review')) {
        return { action: 'manual_review', nextState: order.internalStatus };
      }
      await this.states.moveTo(order, 'MANUAL_REVIEW');
      return { action: 'manual_review', nextState: 'MANUAL_REVIEW' };
    }

    await this.states.moveTo(order, 'CANCELLED');
    return { action: 'cancel', nextState: 'CANCELLED' };
  }

  /** FAILED with an AW order id is treated as submitted: AW orders are never deleted automatically. */
  private supplierStatus(so: { state: string; externalOrderId: string | null } | null): SupplierOrderStatus {
    if (!so || so.state === 'CANCELLED') return 'none';
    if (so.state === 'CREATING') return 'creating';
    if (so.state === 'FAILED' && !so.externalOrderId) return 'none';
    return 'submitted';
  }

  private alert(tenantId: string, order: { id: string; externalId: string }, type: (typeof ORDER_ALERT_TYPES)[keyof typeof ORDER_ALERT_TYPES], message: string) {
    return this.alerts.raise({ tenantId, channelOrderId: order.id, type, message, dedupeKey: `${order.id}:${type}` });
  }
}
