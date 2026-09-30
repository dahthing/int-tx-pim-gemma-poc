import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, SyncRunStatus } from '@repo/database';
import type { AlertDto, DashboardDto, SyncRunDto } from '@repo/shared-types';
import { RUNTIME_AUDIT } from '../runtime.constants';
import { iso, isoOrNull, lower, orderBy, upper } from '../util/mappers';
import { foldAlerts } from './alerts';

const SYNC_SORT = ['id', 'startedAt', 'finishedAt', 'kind', 'status'] as const;
/** Upper bound of alert events read per request (the POC raises few alerts; older ones are expired by retention). */
const ALERT_EVENT_CAP = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_ALERTS = 20;

type SyncRow = {
  id: string;
  kind: string;
  connector: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  counters: unknown;
  errorSummary: string | null;
};

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async listSyncRuns(
    tenantId: string,
    q: {
      skip: number;
      take: number;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
      kind?: string;
      status?: string;
    },
  ) {
    const where = {
      tenantId,
      ...(q.kind && { kind: q.kind }),
      ...(q.status && { status: upper(q.status) as SyncRunStatus }),
    };
    const sort =
      q.sortBy === 'id'
        ? { startedAt: 'desc' as const }
        : orderBy(q.sortBy, q.sortOrder, SYNC_SORT, 'startedAt');
    const [rows, total] = await Promise.all([
      this.db.syncRun.findMany({
        where,
        skip: q.skip,
        take: q.take,
        orderBy: sort,
      }),
      this.db.syncRun.count({ where }),
    ]);
    return { items: rows.map((r) => this.toSyncRun(r)), total };
  }

  async dashboard(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<DashboardDto> {
    const since = new Date(now.getTime() - DAY_MS);
    const [
      runs,
      failedRuns,
      failedOrders,
      manualReview,
      missing,
      productGroups,
      orderGroups,
      alerts,
    ] = await Promise.all([
      this.db.syncRun.findMany({
        where: { tenantId },
        distinct: ['kind', 'connector'],
        orderBy: { startedAt: 'desc' },
      }),
      this.db.syncRun.count({
        where: {
          tenantId,
          status: SyncRunStatus.FAILED,
          startedAt: { gte: since },
        },
      }),
      this.db.channelOrder.count({
        where: { tenantId, internalStatus: 'SUPPLIER_FAILED' },
      }),
      this.db.channelOrder.count({
        where: { tenantId, internalStatus: 'MANUAL_REVIEW' },
      }),
      this.db.supplierProduct.count({
        where: { tenantId, deletedAt: null, status: 'MISSING' },
      }),
      this.db.product.groupBy({
        by: ['status'],
        where: { tenantId, deletedAt: null },
        _count: { _all: true },
      }),
      this.db.channelOrder.groupBy({
        by: ['internalStatus'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.alertsFor(tenantId),
    ]);
    const open = alerts.filter((a) => a.status === 'open');
    return {
      lastSyncRuns: runs.map((r) => this.toSyncRun(r)),
      counts: {
        failedSyncRuns24h: failedRuns,
        openAlerts: open.length,
        failedOrders,
        manualReviewOrders: manualReview,
        missingSupplierProducts: missing,
        productsByStatus: Object.fromEntries(
          productGroups.map((g) => [lower(g.status), g._count._all]),
        ),
        ordersByStatus: Object.fromEntries(
          orderGroups.map((g) => [lower(g.internalStatus), g._count._all]),
        ),
      },
      alerts: open.slice(0, DASHBOARD_ALERTS),
    };
  }

  async listAlerts(
    tenantId: string,
    q: { skip: number; take: number; status: 'open' | 'all' },
  ): Promise<{ items: AlertDto[]; total: number }> {
    const all = await this.alertsFor(tenantId);
    const filtered =
      q.status === 'open' ? all.filter((a) => a.status === 'open') : all;
    return {
      items: filtered.slice(q.skip, q.skip + q.take),
      total: filtered.length,
    };
  }

  /** Closes the alert raised by event `id` (idempotent). The same condition may alert again afterwards. */
  async acknowledge(
    tenantId: string,
    id: string,
    actor: string,
  ): Promise<{ id: string; status: 'acknowledged' }> {
    const event = await this.db.auditEvent.findFirst({
      where: {
        id,
        tenantId,
        entity: RUNTIME_AUDIT.ENTITY_ALERT,
        action: RUNTIME_AUDIT.ACTION_ALERT_RAISED,
      },
      select: { id: true, entityId: true },
    });
    if (!event) throw new NotFoundException(`Alert ${id} not found`);
    const latest = await this.db.auditEvent.findFirst({
      where: {
        tenantId,
        entity: RUNTIME_AUDIT.ENTITY_ALERT,
        entityId: event.entityId,
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
    if (latest?.action === RUNTIME_AUDIT.ACTION_ALERT_RAISED) {
      await this.db.auditEvent.create({
        data: {
          tenantId,
          actor,
          entity: RUNTIME_AUDIT.ENTITY_ALERT,
          entityId: event.entityId,
          action: RUNTIME_AUDIT.ACTION_ALERT_ACKNOWLEDGED,
          diff: { acknowledgedEventId: id },
        },
      });
    }
    return { id, status: 'acknowledged' };
  }

  private async alertsFor(tenantId: string): Promise<AlertDto[]> {
    const events = await this.db.auditEvent.findMany({
      where: {
        tenantId,
        entity: RUNTIME_AUDIT.ENTITY_ALERT,
        action: {
          in: [
            RUNTIME_AUDIT.ACTION_ALERT_RAISED,
            RUNTIME_AUDIT.ACTION_ALERT_ACKNOWLEDGED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: ALERT_EVENT_CAP,
      select: {
        id: true,
        entityId: true,
        action: true,
        createdAt: true,
        diff: true,
      },
    });
    return foldAlerts(events);
  }

  private toSyncRun(r: SyncRow): SyncRunDto {
    const counters = (r.counters ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      kind: r.kind,
      connector: r.connector,
      status: lower(r.status) as SyncRunDto['status'],
      startedAt: iso(r.startedAt),
      finishedAt: isoOrNull(r.finishedAt),
      counters: Object.fromEntries(
        Object.entries(counters).filter(
          (e): e is [string, number] => typeof e[1] === 'number',
        ),
      ),
      errorSummary: r.errorSummary,
    };
  }
}
