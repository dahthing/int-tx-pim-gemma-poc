import { Injectable } from '@nestjs/common';
import { DatabaseService, Prisma } from '@repo/database';
import type { AlertInput, AlertService } from '@repo/pim-catalog';
import type { OrderAlert, OrderAlertPort } from '@repo/pim-orders';
import { RUNTIME_AUDIT } from '../runtime.constants';

interface AlertRecord {
  tenantId: string;
  type: string;
  message: string;
  dedupeKey: string;
  extra: Record<string, unknown>;
}

/**
 * Alerts are AuditEvent rows (entity 'Alert', entityId = dedupeKey, action 'alert.raised').
 * An alert is not duplicated while the latest event for its key is still 'raised'; acknowledging it
 * (action 'alert.acknowledged', written by the API) lets the same condition alert again.
 */
@Injectable()
export class AuditAlertAdapter implements AlertService, OrderAlertPort {
  constructor(private readonly db: DatabaseService) {}

  /** pim-orders OrderAlertPort */
  async raise(alert: OrderAlert | AlertInput): Promise<void> {
    if ('dedupeKey' in alert) {
      await this.write({
        tenantId: alert.tenantId,
        type: alert.type,
        message: alert.message,
        dedupeKey: alert.dedupeKey,
        extra: {
          ...(alert.channelOrderId && { channelOrderId: alert.channelOrderId }),
          ...(alert.metadata && { metadata: alert.metadata }),
        },
      });
      return;
    }
    const dedupeKey = `${alert.type}:${alert.productId ?? ''}:${alert.channelId ?? ''}`;
    await this.write({
      tenantId: alert.tenantId,
      type: alert.type,
      message: alert.message,
      dedupeKey,
      extra: {
        ...(alert.productId && { productId: alert.productId }),
        ...(alert.channelId && { channelId: alert.channelId }),
        ...(alert.details && { metadata: alert.details }),
      },
    });
  }

  private async write(a: AlertRecord): Promise<void> {
    const latest = await this.db.auditEvent.findFirst({
      where: {
        tenantId: a.tenantId,
        entity: RUNTIME_AUDIT.ENTITY_ALERT,
        entityId: a.dedupeKey,
        action: {
          in: [
            RUNTIME_AUDIT.ACTION_ALERT_RAISED,
            RUNTIME_AUDIT.ACTION_ALERT_ACKNOWLEDGED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    });
    if (latest?.action === RUNTIME_AUDIT.ACTION_ALERT_RAISED) return;
    await this.db.auditEvent.create({
      data: {
        tenantId: a.tenantId,
        actor: RUNTIME_AUDIT.SYSTEM_ACTOR,
        entity: RUNTIME_AUDIT.ENTITY_ALERT,
        entityId: a.dedupeKey,
        action: RUNTIME_AUDIT.ACTION_ALERT_RAISED,
        diff: {
          type: a.type,
          message: a.message,
          dedupeKey: a.dedupeKey,
          ...a.extra,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
