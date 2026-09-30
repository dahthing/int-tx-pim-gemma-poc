import type { AlertDto } from '@repo/shared-types';
import { RUNTIME_AUDIT } from '../runtime.constants';
import { iso } from '../util/mappers';

export interface AlertEventRow {
  id: string;
  entityId: string;
  action: string;
  createdAt: Date;
  diff: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Folds alert audit events into one alert per dedupe key: the latest `alert.raised` supplies the content, and the
 * alert is open while the latest event for that key is a `raised` (an acknowledge after it closes it).
 */
export function foldAlerts(events: AlertEventRow[]): AlertDto[] {
  const byKey = new Map<string, AlertEventRow[]>();
  for (const e of events)
    byKey.set(e.entityId, [...(byKey.get(e.entityId) ?? []), e]);
  const out: AlertDto[] = [];
  for (const [key, group] of byKey) {
    const sorted = [...group].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const raised = sorted.filter(
      (e) => e.action === RUNTIME_AUDIT.ACTION_ALERT_RAISED,
    );
    const latestRaised = raised[raised.length - 1];
    if (!latestRaised) continue;
    const last = sorted[sorted.length - 1] as AlertEventRow;
    const diff = (latestRaised.diff ?? {}) as Record<string, unknown>;
    out.push({
      id: latestRaised.id,
      type: str(diff.type) ?? 'unknown',
      message: str(diff.message) ?? '',
      dedupeKey: key,
      status:
        last.action === RUNTIME_AUDIT.ACTION_ALERT_RAISED
          ? 'open'
          : 'acknowledged',
      raisedAt: iso(latestRaised.createdAt),
      productId: str(diff.productId),
      channelId: str(diff.channelId),
      channelOrderId: str(diff.channelOrderId),
    });
  }
  return out.sort((a, b) =>
    a.raisedAt < b.raisedAt ? 1 : a.raisedAt > b.raisedAt ? -1 : 0,
  );
}
