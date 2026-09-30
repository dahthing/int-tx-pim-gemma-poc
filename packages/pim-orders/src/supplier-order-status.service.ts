import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupplierOrderStatus } from '@repo/connector-contracts';
import { DatabaseService } from '@repo/database';
import { ORDER_ALERT_TYPES, PIM_ORDERS_TOKENS, SUPPLIER_STATES } from './constants';
import { errorMessage } from './json';
import { OrderStateService } from './order-state.service';
import type { OrderAlertPort, SupplierGatewayResolver, SupplierOrderGateway } from './ports';
import { ShipmentService } from './shipment.service';

export interface StatusPollSummary {
  checked: number;
  dispatched: number;
  withTracking: number;
  trackingMissing: number;
  alerts: number;
  failed: number;
}

function isDispatched(s: SupplierOrderStatus): boolean {
  if ((SUPPLIER_STATES.DISPATCHED as readonly string[]).includes(s.state)) return true;
  const dispatched = s.lines.reduce((n, l) => n + l.quantityDispatched, 0);
  const expected = s.lines.reduce((n, l) => n + l.quantityOrdered - l.quantityFail - l.quantityCancelled, 0);
  return dispatched > 0 && dispatched >= expected;
}

/** FR-AW-007: status / tracking polling for submitted supplier orders. */
@Injectable()
export class SupplierOrderStatusService {
  private readonly logger = new Logger(SupplierOrderStatusService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly states: OrderStateService,
    @Inject(PIM_ORDERS_TOKENS.SUPPLIER_GATEWAY_RESOLVER) private readonly gateways: SupplierGatewayResolver,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ALERT_PORT) private readonly alerts: OrderAlertPort,
    private readonly shipments: ShipmentService,
  ) {}

  async pollSubmitted(tenantId: string): Promise<StatusPollSummary> {
    const orders = await this.db.supplierOrder.findMany({
      where: { tenantId, state: 'SUBMITTED', externalOrderId: { not: null } },
      include: { channelOrder: true },
    });
    const summary: StatusPollSummary = { checked: 0, dispatched: 0, withTracking: 0, trackingMissing: 0, alerts: 0, failed: 0 };
    const cache = new Map<string, SupplierOrderGateway>();

    for (const so of orders) {
      summary.checked++;
      try {
        let gateway = cache.get(so.supplierId);
        if (!gateway) {
          gateway = await this.gateways.resolve(tenantId, so.supplierId);
          cache.set(so.supplierId, gateway);
        }
        const status = await gateway.getSupplierOrder(so.externalOrderId!);
        await this.apply(tenantId, so, status, summary);
      } catch (e) {
        summary.failed++;
        this.logger.error(`Status poll of supplier order ${so.id} failed: ${errorMessage(e)}`);
      }
    }
    return summary;
  }

  private async apply(
    tenantId: string,
    so: { id: string; channelOrder: { id: string; tenantId: string; externalId: string; internalStatus: string } },
    status: SupplierOrderStatus,
    summary: StatusPollSummary,
  ): Promise<void> {
    const order = so.channelOrder;
    const cancelledOrder = status.state === SUPPLIER_STATES.CANCELLED;
    const anyFail = status.lines.some((l) => l.quantityFail > 0);

    if (status.alert) {
      summary.alerts++;
      const type = anyFail || !status.lines.some((l) => l.quantityCancelled > 0) ? ORDER_ALERT_TYPES.SUPPLIER_QUANTITY_FAIL : ORDER_ALERT_TYPES.SUPPLIER_CANCELLED;
      await this.alerts.raise({
        tenantId,
        channelOrderId: order.id,
        type: cancelledOrder ? ORDER_ALERT_TYPES.SUPPLIER_CANCELLED : type,
        message: `Supplier order for ${order.externalId} has failed or cancelled quantities`,
        dedupeKey: `${order.id}:${cancelledOrder ? ORDER_ALERT_TYPES.SUPPLIER_CANCELLED : type}`,
        metadata: { lines: status.lines },
      });
    }

    if (cancelledOrder) {
      await this.db.supplierOrder.update({ where: { id: so.id }, data: { state: 'CANCELLED' } });
      await this.states.moveTo(order, 'MANUAL_REVIEW');
      return;
    }
    if (!isDispatched(status)) return;

    summary.dispatched++;
    await this.db.supplierOrder.update({ where: { id: so.id }, data: { state: 'DISPATCHED' } });
    await this.states.moveTo(order, 'SUPPLIER_DISPATCHED');

    if (!status.tracking) {
      summary.trackingMissing++;
      await this.states.moveTo({ ...order, internalStatus: 'SUPPLIER_DISPATCHED' }, 'TRACKING_MISSING');
      await this.alerts.raise({
        tenantId,
        channelOrderId: order.id,
        type: ORDER_ALERT_TYPES.TRACKING_MISSING,
        message: `Supplier dispatched ${order.externalId} but returned no tracking; enter it manually`,
        dedupeKey: `${order.id}:tracking_missing`,
      });
      return;
    }

    summary.withTracking++;
    const { trackingNumber, carrierName } = status.tracking;
    const existing = await this.db.shipment.findFirst({ where: { tenantId, channelOrderId: order.id, trackingNumber } });
    const shipment =
      existing ??
      (await this.db.shipment.create({
        data: {
          tenantId,
          channelOrderId: order.id,
          carrierCode: carrierName ? carrierName.trim().toLowerCase() : null,
          carrierName: carrierName ?? null,
          trackingNumber,
          source: 'SUPPLIER_API',
        },
      }));
    await this.shipments.pushShipment(tenantId, shipment.id);
  }
}
