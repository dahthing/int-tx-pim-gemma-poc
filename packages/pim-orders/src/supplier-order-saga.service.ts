import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DropshipOrderLine,
  PlaceDropshipOrderCommand,
  RecipientAddress,
  SupplierOrderProgress,
} from '@repo/connector-contracts';
import { decryptSecret, DomainError, toDecimal } from '@repo/core-domain';
import { computeMaxSupplierCost } from '@repo/connector-temu-eu';
import { DatabaseService } from '@repo/database';
import { MANUAL_REVIEW_REASONS, ORDER_ALERT_TYPES, PIM_ORDERS_TOKENS } from './constants';
import { asJson, errorMessage } from './json';
import { decodeOrderLines } from './order-lines.codec';
import { OrderStateService } from './order-state.service';
import type {
  EncryptionKeyProvider,
  OrderAlertPort,
  OrderSettingsProvider,
  SupplierGatewayResolver,
} from './ports';

export type RouteOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'manual_review'; reason: string }
  | { outcome: 'already_submitted'; externalOrderId?: string }
  | { outcome: 'submitted'; externalOrderId?: string }
  | { outcome: 'creating'; alert?: string }
  | { outcome: 'failed'; error?: string };

const ROUTABLE = ['IMPORTED', 'ROUTING', 'SUPPLIER_FAILED', 'MANUAL_REVIEW'];
const SUBMITTED_STATES = ['SUBMITTED', 'DISPATCHED'];

interface LineResolution {
  supplierId?: string;
  lines: DropshipOrderLine[];
  reason?: string;
}

/** FR-AW-006: persistence, resume and state transitions around the connector's saga. */
@Injectable()
export class SupplierOrderSagaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly states: OrderStateService,
    @Inject(PIM_ORDERS_TOKENS.SUPPLIER_GATEWAY_RESOLVER) private readonly gateways: SupplierGatewayResolver,
    @Inject(PIM_ORDERS_TOKENS.ENCRYPTION_KEY_PROVIDER) private readonly keys: EncryptionKeyProvider,
    @Inject(PIM_ORDERS_TOKENS.ORDER_SETTINGS_PROVIDER) private readonly settings: OrderSettingsProvider,
    @Inject(PIM_ORDERS_TOKENS.ORDER_ALERT_PORT) private readonly alerts: OrderAlertPort,
  ) {}

  async route(tenantId: string, channelOrderId: string): Promise<RouteOutcome> {
    const order = await this.db.channelOrder.findFirst({
      where: { id: channelOrderId, tenantId },
      include: { channel: true },
    });
    if (!order) throw new NotFoundException(`Channel order ${channelOrderId} not found`);
    if (!ROUTABLE.includes(order.internalStatus)) return { outcome: 'skipped' };

    const items = decodeOrderLines(order.lines).items;
    const resolved = await this.resolveLines(tenantId, items);
    if (resolved.reason) return this.toManualReview(order, resolved.reason);

    const settings = await this.settings.get(tenantId);
    let maxSupplierCost: string;
    try {
      const net = order.totalNet ? toDecimal(order.totalNet.toString()) : toDecimal(String(order.totalGross ?? 0)).div(toDecimal(1).plus(toDecimal(settings.vatRate)));
      maxSupplierCost = computeMaxSupplierCost({ orderNet: net, minMargin: settings.minMargin, shippingAbsorbed: settings.shippingAbsorbed }).toFixed(4);
    } catch (e) {
      if (e instanceof DomainError) return this.toManualReview(order, MANUAL_REVIEW_REASONS.INVALID_COST_INPUT);
      throw e;
    }

    await this.states.moveTo(order, 'ROUTING');

    // Unique on channelOrderId: a second AW order for the same channel order can never be started.
    let supplierOrder = await this.db.supplierOrder.upsert({
      where: { channelOrderId },
      create: { tenantId, channelOrderId, supplierId: resolved.supplierId!, state: 'CREATING', sagaProgress: {} },
      update: {},
    });
    if (SUBMITTED_STATES.includes(supplierOrder.state)) {
      await this.states.moveTo({ ...order, internalStatus: 'ROUTING' }, 'SUPPLIER_SUBMITTED');
      return { outcome: 'already_submitted', externalOrderId: supplierOrder.externalOrderId ?? undefined };
    }
    if (supplierOrder.state === 'FAILED') {
      await this.db.supplierOrder.update({ where: { id: supplierOrder.id }, data: { state: 'CREATING', lastError: null } });
      supplierOrder = { ...supplierOrder, state: 'CREATING' };
    }

    const cmd = await this.buildCommand(tenantId, order, resolved.lines, maxSupplierCost, settings, supplierOrder.sagaProgress as SupplierOrderProgress);
    const gateway = await this.gateways.resolve(tenantId, supplierOrder.supplierId);
    const soId = supplierOrder.id;

    let result;
    try {
      result = await gateway.placeDropshipOrder(cmd, async (progress) => {
        await this.db.supplierOrder.update({
          where: { id: soId },
          data: {
            sagaProgress: asJson(progress),
            externalClientId: progress.clientId ?? null,
            externalOrderId: progress.orderId ?? null,
          },
        });
      });
    } catch (e) {
      await this.db.supplierOrder.update({ where: { id: soId }, data: { lastError: errorMessage(e) } });
      throw e;
    }

    const common = {
      sagaProgress: asJson(result.progress),
      ...(result.externalOrderId && { externalOrderId: result.externalOrderId }),
    };
    const routing = { ...order, internalStatus: 'ROUTING' };

    if (result.state === 'submitted') {
      await this.db.supplierOrder.update({
        where: { id: soId },
        data: { ...common, state: 'SUBMITTED', lastError: null, ...(result.totalAmount !== undefined && { totalNet: result.totalAmount }) },
      });
      await this.states.moveTo(routing, 'SUPPLIER_SUBMITTED');
      return { outcome: 'submitted', externalOrderId: result.externalOrderId };
    }
    if (result.state === 'failed') {
      await this.db.supplierOrder.update({ where: { id: soId }, data: { ...common, state: 'FAILED', lastError: result.error ?? 'failed' } });
      await this.states.moveTo(routing, 'SUPPLIER_FAILED');
      return { outcome: 'failed', error: result.error };
    }

    await this.db.supplierOrder.update({
      where: { id: soId },
      data: { ...common, state: 'CREATING', lastError: result.alert ?? null },
    });
    if (result.alert) {
      await this.alerts.raise({
        tenantId,
        channelOrderId,
        type: result.alert === 'cost_exceeds_max' ? ORDER_ALERT_TYPES.COST_EXCEEDS_MAX : ORDER_ALERT_TYPES.QUANTITY_MISMATCH,
        message: `Supplier order for ${order.externalId} held before submit: ${result.alert}`,
        dedupeKey: `${channelOrderId}:${result.alert}`,
        metadata: { externalOrderId: result.externalOrderId, totalAmount: result.totalAmount, maxSupplierCost },
      });
    }
    return { outcome: 'creating', alert: result.alert };
  }

  private async toManualReview(
    order: { id: string; tenantId: string; internalStatus: string; externalId: string },
    reason: string,
  ): Promise<RouteOutcome> {
    await this.states.moveTo(order, 'MANUAL_REVIEW');
    await this.alerts.raise({
      tenantId: order.tenantId,
      channelOrderId: order.id,
      type: ORDER_ALERT_TYPES.ROUTING_MANUAL_REVIEW,
      message: `Order ${order.externalId} needs manual review: ${reason}`,
      dedupeKey: `${order.id}:${reason}`,
      metadata: { reason },
    });
    return { outcome: 'manual_review', reason };
  }

  private async resolveLines(tenantId: string, items: { sku: string; quantity: number }[]): Promise<LineResolution> {
    const skus = [...new Set(items.map((i) => i.sku))];
    const products = await this.db.product.findMany({
      where: { tenantId, deletedAt: null, sku: { in: skus } },
      select: { sku: true, supplierProductId: true },
    });
    const bySku = new Map(products.map((p) => [p.sku, p.supplierProductId]));
    if (skus.some((s) => !bySku.get(s))) {
      return { lines: [], reason: skus.some((s) => !bySku.has(s)) ? MANUAL_REVIEW_REASONS.UNKNOWN_SKU : MANUAL_REVIEW_REASONS.NO_ASSORTMENT_ITEM };
    }
    const assortment = await this.db.supplierAssortmentItem.findMany({
      where: { tenantId, status: 'ACTIVE', supplierProductId: { in: [...bySku.values()] as string[] } },
      select: { supplierProductId: true, supplierId: true, externalPortfolioId: true },
    });
    const byProduct = new Map(assortment.map((a) => [a.supplierProductId, a]));
    const lines: DropshipOrderLine[] = [];
    const suppliers = new Set<string>();
    for (const item of items) {
      const a = byProduct.get(bySku.get(item.sku)!);
      if (!a) return { lines: [], reason: MANUAL_REVIEW_REASONS.NO_ASSORTMENT_ITEM };
      suppliers.add(a.supplierId);
      lines.push({ externalPortfolioId: a.externalPortfolioId, quantity: item.quantity });
    }
    if (suppliers.size !== 1) return { lines: [], reason: MANUAL_REVIEW_REASONS.MIXED_SUPPLIERS };
    return { supplierId: [...suppliers][0], lines };
  }

  private async buildCommand(
    tenantId: string,
    order: { externalId: string; customer: unknown; shippingAddress: unknown; channel: { code: string } },
    lines: DropshipOrderLine[],
    maxSupplierCost: string,
    settings: { defaultEmail: string; defaultPhone: string },
    resume: SupplierOrderProgress,
  ): Promise<PlaceDropshipOrderCommand> {
    const key = await this.keys.getKey(tenantId);
    const customer = JSON.parse(decryptSecret(String(order.customer), key)) as { email?: string | null; phone?: string | null };
    const address = JSON.parse(decryptSecret(String(order.shippingAddress), key)) as RecipientAddress;
    return {
      channelCode: order.channel.code,
      channelOrderId: order.externalId,
      recipient: { ...address, email: customer.email ?? address.email ?? null, phone: customer.phone ?? address.phone ?? null },
      lines,
      maxSupplierCost,
      tenantDefaults: { email: settings.defaultEmail, phone: settings.defaultPhone },
      resume,
    };
  }
}
