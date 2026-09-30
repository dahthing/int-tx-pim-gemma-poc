import { Injectable } from '@nestjs/common';
import {
  CatalogIngestionService,
  StockCostSyncService,
  type StockCostSyncOutcome,
  type SyncOutcome,
} from '@repo/pim-catalog';
import {
  ChannelOrderImportService,
  ListingSyncService,
  ShipmentService,
  SupplierOrderSagaService,
  SupplierOrderStatusService,
  type ImportSummary,
  type PublishResult,
  type PushResult,
  type ReviewSummary,
  type RouteOutcome,
  type StatusPollSummary,
  type SyncSummary,
} from '@repo/pim-orders';
import { RequestLogRetentionService } from './adapters/request-log-retention.service';
import { SupplierScope } from './supplier-scope';

/**
 * Single entry point for the worker (BullMQ consumers) and cron (schedulers): one method per job.
 * Every method is idempotent (NFR-01) and safe to retry. Import `PimRuntimeModule.register()` and
 * inject `PimJobs`; never call the pim-* services directly from the apps.
 *
 * Job payloads / queues are in `job-payloads.ts` (QUEUES + JOB_PATTERNS come from `@repo/shared`).
 */
@Injectable()
export class PimJobs {
  constructor(
    private readonly ingestion: CatalogIngestionService,
    private readonly stockSync: StockCostSyncService,
    private readonly orderImport: ChannelOrderImportService,
    private readonly saga: SupplierOrderSagaService,
    private readonly supplierStatus: SupplierOrderStatusService,
    private readonly shipments: ShipmentService,
    private readonly listings: ListingSyncService,
    private readonly scope: SupplierScope,
    private readonly requestLogs: RequestLogRetentionService,
  ) {}

  /** FR-ING-001 (daily + on demand). */
  runCatalogFullSync(
    tenantId: string,
    supplierId: string,
  ): Promise<SyncOutcome> {
    return this.scope.run(tenantId, supplierId, () =>
      this.ingestion.runFullSync(tenantId, supplierId),
    );
  }

  /** FR-ING-002 (every 30 min). */
  runStockCostSync(
    tenantId: string,
    supplierId: string,
  ): Promise<StockCostSyncOutcome> {
    return this.scope.run(tenantId, supplierId, () =>
      this.stockSync.run(tenantId, supplierId),
    );
  }

  /** Polls one channel for new orders and enqueues routing for each. */
  importChannelOrders(
    tenantId: string,
    channelId: string,
  ): Promise<ImportSummary> {
    return this.orderImport.importChannel(tenantId, channelId);
  }

  /** FR-ORD: resumable supplier saga for one channel order. */
  routeSupplierOrder(
    tenantId: string,
    channelOrderId: string,
  ): Promise<RouteOutcome> {
    return this.saga.route(tenantId, channelOrderId);
  }

  /** Polls every submitted supplier order (status, tracking). */
  pollSupplierOrders(tenantId: string): Promise<StatusPollSummary> {
    return this.supplierStatus.pollSubmitted(tenantId);
  }

  /** Pushes a stored shipment to its channel. */
  pushShipment(tenantId: string, shipmentId: string): Promise<PushResult> {
    return this.shipments.pushShipment(tenantId, shipmentId);
  }

  /** Temu ship-by deadline alerts. */
  scanShipByDeadlines(
    tenantId: string,
    now?: Date,
  ): Promise<{ scanned: number; alerted: number }> {
    return this.shipments.scanShipByDeadlines(tenantId, now);
  }

  /** GDPR purge of Temu order PII (default 90 days after delivery). */
  purgeOrderPii(
    tenantId: string,
    now?: Date,
    retentionDays?: number,
  ): Promise<{ scanned: number; purged: number }> {
    return this.shipments.purgeExpiredPii(tenantId, now, retentionDays);
  }

  /** Section 5 retention: IntegrationRequestLog rows older than 30 days. */
  purgeRequestLogs(
    tenantId: string,
    now?: Date,
    retentionDays?: number,
  ): Promise<{ deleted: number }> {
    return this.requestLogs.purge(tenantId, now, retentionDays);
  }

  publishListing(
    tenantId: string,
    productId: string,
    channelId: string,
  ): Promise<PublishResult> {
    return this.listings.publishListing(tenantId, productId, channelId);
  }

  /**
   * Pushes changed stock and prices of a channel. `productIds` is the hint carried by the job (the products whose data
   * changed); the sync recomputes every live listing of the channel anyway, so it is accepted and not required.
   */
  syncListings(
    tenantId: string,
    channelId: string,
    _productIds?: string[],
  ): Promise<SyncSummary> {
    return this.listings.syncStockAndPrices(tenantId, channelId);
  }

  /** Polls Temu listing reviews. */
  pollListingReviews(
    tenantId: string,
    channelId: string,
  ): Promise<ReviewSummary> {
    return this.listings.pollReviews(tenantId, channelId);
  }
}
