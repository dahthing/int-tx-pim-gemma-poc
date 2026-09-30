import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, PaginatedUtil } from '@repo/shared';
import {
  DashboardService,
  SyncTriggerService,
  TenantContext,
} from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import { actorOf } from './actor';
import {
  AcknowledgeAlertResponseDto,
  AlertListQueryDto,
  AlertPageDto,
  DashboardDto,
  SyncRunListQueryDto,
  SyncRunPageDto,
  TriggerSyncRequestDto,
  TriggerSyncResponseDto,
} from './dto';

@ApiTags('operations')
@Controller()
export class OperationsController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly dashboard: DashboardService,
    private readonly sync: SyncTriggerService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Last sync run per job, error counts and open alerts',
  })
  @ZodResponse({ type: DashboardDto })
  async getDashboard() {
    return this.dashboard.dashboard(await this.tenant.resolve());
  }

  @Get('sync-runs')
  @ZodResponse({ type: SyncRunPageDto })
  async syncRuns(@Query() query: SyncRunListQueryDto) {
    const { items, total } = await this.dashboard.listSyncRuns(
      await this.tenant.resolve(),
      query,
    );
    return PaginatedUtil.getPaginatedResponse(
      items,
      total,
      query.skip,
      query.take,
    );
  }

  @Get('alerts')
  @ApiOperation({
    summary:
      'Alerts (margin blocked, missing products, Temu deadlines, failed orders...)',
  })
  @ZodResponse({ type: AlertPageDto })
  async alerts(@Query() query: AlertListQueryDto) {
    const { items, total } = await this.dashboard.listAlerts(
      await this.tenant.resolve(),
      query,
    );
    return PaginatedUtil.getPaginatedResponse(
      items,
      total,
      query.skip,
      query.take,
    );
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: AcknowledgeAlertResponseDto })
  async acknowledge(@Param('id') id: string, @CurrentUser() user: unknown) {
    return this.dashboard.acknowledge(
      await this.tenant.resolve(),
      id,
      actorOf(user),
    );
  }

  @Post('sync/catalog')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Start a full supplier catalogue sync now (queued; 409 while one is running)',
  })
  @ZodResponse({ status: 202, type: TriggerSyncResponseDto })
  async triggerCatalogSync(@Body() body: TriggerSyncRequestDto) {
    return this.sync.triggerCatalogSync(
      await this.tenant.resolve(),
      body.supplierId,
    );
  }

  @Post('sync/stock-cost')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a stock and cost sync now (queued)' })
  @ZodResponse({ status: 202, type: TriggerSyncResponseDto })
  async triggerStockCostSync(@Body() body: TriggerSyncRequestDto) {
    return this.sync.triggerStockCostSync(
      await this.tenant.resolve(),
      body.supplierId,
    );
  }
}
