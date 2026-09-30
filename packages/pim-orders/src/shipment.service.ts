import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PushShipmentCommand } from '@repo/connector-contracts';
import { DatabaseService } from '@repo/database';
import { resolveCarrier, shipByAlertDecision, shouldPurgePii, type CarrierTable } from '@repo/connector-temu-eu';
import { CHANNEL_CODES, ORDER_ALERT_TYPES, PIM_ORDERS_DEFAULTS, PIM_ORDERS_TOKENS } from './constants';
import { asJson, asRecord, errorMessage } from './json';
import { decodeOrderLines, updateOrderMeta } from './order-lines.codec';
import { OrderStateService } from './order-state.service';
import type { ChannelConnectorResolver, OrderAlertPort } from './ports';

export interface ManualTrackingInput {
  carrierCode: string;
  carrierName?: string;
  trackingNumber: string;
}

export interface PushResult {
  pushed: boolean;
  alreadyPushed?: boolean;
  error?: string;
}

export interface ManualTrackingResult {
  shipmentId: string;
  pushed: boolean;
  idempotent: boolean;
  error?: string;
}

/** States in which an order may receive tracking (FR-ORD-002 starts from supplier_submitted). */
const TRACKABLE = ['SUPPLIER_SUBMITTED', 'SUPPLIER_DISPATCHED', 'TRACKING_MISSING'];
/** Orders that are still expected to ship: candidates for the ship-by deadline scan. */
const OPEN_STATES = ['IMPORTED', 'ROUTING', 'MANUAL_REVIEW', 'SUPPLIER_SUBMITTED', 'SUPPLIER_FAILED', 'SUPPLIER_DISPATCHED', 'TRACKING_MISSING'];

@Injectable()
export class ShipmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly states: OrderStateService,
    @Inject(PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER) private readonly connectors: ChannelConnectorResolver,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ALERT_PORT) private readonly alerts: OrderAlertPort,
  ) {}

  /** FR-ORD-002: manual carrier + tracking, then push through the originating channel. */
  async recordManualTracking(tenantId: string, channelOrderId: string, input: ManualTrackingInput): Promise<ManualTrackingResult> {
    const order = await this.db.channelOrder.findFirst({ where: { id: channelOrderId, tenantId }, include: { channel: true } });
    if (!order) throw new NotFoundException(`Channel order ${channelOrderId} not found`);

    const carrierCode = input.carrierCode.trim();
    const trackingNumber = input.trackingNumber.trim();
    const existing = await this.db.shipment.findFirst({
      where: { tenantId, channelOrderId, trackingNumber, carrierCode },
      include: { channelOrder: { include: { channel: true } } },
    });
    if (existing) {
      if (existing.pushedToChannelAt) return { shipmentId: existing.id, pushed: false, idempotent: true };
      const res = await this.pushShipment(tenantId, existing.id);
      return { shipmentId: existing.id, pushed: res.pushed, idempotent: true, error: res.error };
    }

    if (!TRACKABLE.includes(order.internalStatus)) {
      throw new ConflictException(`Order ${channelOrderId} is ${order.internalStatus}; tracking cannot be recorded`);
    }
    const shipment = await this.db.shipment.create({
      data: {
        tenantId,
        channelOrderId,
        carrierCode,
        carrierName: input.carrierName ?? null,
        trackingNumber,
        source: 'MANUAL',
      },
    });
    const res = await this.pushShipment(tenantId, shipment.id);
    return { shipmentId: shipment.id, pushed: res.pushed, idempotent: false, error: res.error };
  }

  /** Pushes one shipment to its channel. Never pushes twice; failures are recorded, not thrown. */
  async pushShipment(tenantId: string, shipmentId: string): Promise<PushResult> {
    const shipment = await this.db.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: { channelOrder: { include: { channel: true } } },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (shipment.pushedToChannelAt) return { pushed: false, alreadyPushed: true };

    const order = shipment.channelOrder;
    const channel = order.channel;
    try {
      const cmd = this.buildCommand(channel, order.externalId, shipment);
      const connector = await this.connectors.resolve({ id: channel.id, tenantId, code: channel.code, settings: channel.settings });
      await connector.pushShipment(cmd);
    } catch (e) {
      const error = errorMessage(e);
      await this.db.shipment.update({ where: { id: shipment.id }, data: { pushError: error } });
      if (order.internalStatus === 'SUPPLIER_DISPATCHED') await this.states.moveTo(order, 'TRACKING_MISSING');
      await this.alerts.raise({
        tenantId,
        channelOrderId: order.id,
        type: ORDER_ALERT_TYPES.TRACKING_PUSH_FAILED,
        message: `Tracking push for order ${order.externalId} failed: ${error}`,
        dedupeKey: `${order.id}:push:${shipment.id}`,
        metadata: { shipmentId: shipment.id, channel: channel.code },
      });
      return { pushed: false, error };
    }

    await this.db.shipment.update({ where: { id: shipment.id }, data: { pushedToChannelAt: new Date(), pushError: null } });
    if (this.states.canReach(order.internalStatus, 'TRACKING_PUSHED')) await this.states.moveTo(order, 'TRACKING_PUSHED');
    return { pushed: true };
  }

  async markDelivered(tenantId: string, channelOrderId: string, deliveredAt: Date): Promise<void> {
    const order = await this.db.channelOrder.findFirst({ where: { id: channelOrderId, tenantId } });
    if (!order) throw new NotFoundException(`Channel order ${channelOrderId} not found`);
    await this.states.moveTo(order, 'COMPLETED');
    // The purge clock starts at the first delivery report and never restarts.
    if (decodeOrderLines(order.lines).deliveredAt) return;
    await this.db.channelOrder.update({
      where: { id: order.id },
      data: { lines: asJson(updateOrderMeta(order.lines, { deliveredAt })) },
    });
  }

  /** FR-TEMU-004 AC4: alert when a Temu order has no tracking 12 h before its ship-by deadline. */
  async scanShipByDeadlines(tenantId: string, now: Date = new Date()): Promise<{ scanned: number; alerted: number }> {
    const orders = await this.db.channelOrder.findMany({
      where: { tenantId, channel: { code: CHANNEL_CODES.TEMU_EU }, internalStatus: { in: OPEN_STATES as never } },
      include: { channel: true, shipments: true },
    });
    let alerted = 0;
    for (const order of orders) {
      const meta = decodeOrderLines(order.lines);
      const d = shipByAlertDecision({
        shipByAt: meta.shipByAt,
        hasTracking: order.shipments.length > 0,
        now,
        alertHoursBefore: PIM_ORDERS_DEFAULTS.SHIP_BY_ALERT_HOURS,
        alreadyAlerted: meta.shipByAlertedAt !== null,
      });
      if (!d.alert) continue;
      alerted++;
      await this.alerts.raise({
        tenantId,
        channelOrderId: order.id,
        type: ORDER_ALERT_TYPES.SHIP_BY_DEADLINE,
        message: `Temu order ${order.externalId} has no tracking and its ship-by deadline is ${d.overdue ? 'overdue' : `in ${Math.max(0, Math.round(d.hoursLeft ?? 0))}h`}`,
        dedupeKey: `${order.id}:ship_by`,
        metadata: { shipByAt: meta.shipByAt?.toISOString(), hoursLeft: d.hoursLeft },
      });
      await this.db.channelOrder.update({
        where: { id: order.id },
        data: { lines: asJson(updateOrderMeta(order.lines, { shipByAlertedAt: now })) },
      });
    }
    return { scanned: orders.length, alerted };
  }

  /** FR-TEMU-004 AC2: PII of Temu orders is purged 90 days after delivery. */
  async purgeExpiredPii(
    tenantId: string,
    now: Date = new Date(),
    retentionDays: number = PIM_ORDERS_DEFAULTS.PII_RETENTION_DAYS,
  ): Promise<{ scanned: number; purged: number }> {
    const orders = await this.db.channelOrder.findMany({
      where: { tenantId, internalStatus: 'COMPLETED', channel: { code: CHANNEL_CODES.TEMU_EU } },
      select: { id: true, tenantId: true, lines: true },
    });
    let purged = 0;
    for (const order of orders) {
      const meta = decodeOrderLines(order.lines);
      const { purge } = shouldPurgePii({ deliveredAt: meta.deliveredAt, now, alreadyPurged: meta.piiPurgedAt !== null, retentionDays });
      if (!purge) continue;
      purged++;
      await this.db.channelOrder.update({
        where: { id: order.id },
        data: {
          customer: PIM_ORDERS_DEFAULTS.PII_PURGED_MARKER,
          shippingAddress: PIM_ORDERS_DEFAULTS.PII_PURGED_MARKER,
          lines: asJson(updateOrderMeta(order.lines, { piiPurgedAt: now })),
        },
      });
    }
    return { scanned: orders.length, purged };
  }

  private buildCommand(
    channel: { code: string; settings: unknown },
    externalOrderId: string,
    s: { carrierCode: string | null; carrierName: string | null; trackingNumber: string },
  ): PushShipmentCommand {
    if (channel.code === CHANNEL_CODES.TEMU_EU) {
      const table = asRecord(asRecord(channel.settings)[PIM_ORDERS_DEFAULTS.CARRIER_TABLE_SETTING]) as CarrierTable;
      const carrier = resolveCarrier(table, s.carrierCode ?? ''); // throws UnknownCarrierError: never guess
      return { externalOrderId, carrierCode: carrier.temuCarrierId, carrierName: carrier.temuCarrierName, trackingNumber: s.trackingNumber };
    }
    return {
      externalOrderId,
      carrierCode: s.carrierCode ?? '',
      ...(s.carrierName && { carrierName: s.carrierName }),
      trackingNumber: s.trackingNumber,
    };
  }
}
