import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncTriggerService, TenantContext } from '@repo/pim-runtime';
import { Roles } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { ZodResponse } from 'nestjs-zod';
import {
  TriggerChannelRequestDto,
  TriggerChannelsResponseDto,
  TriggerPollResponseDto,
} from './dto';

/**
 * Admin triggers for the polls the cron app schedules (order import every 10 min, supplier order status every 15 min,
 * Temu listing reviews every 30 min). They enqueue the same jobs, so the worker does the work and retries apply.
 */
@ApiTags('operations')
@Roles(RoleEnum.ADMIN)
@Controller()
export class TriggersController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly sync: SyncTriggerService,
  ) {}

  @Post('orders/import')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Poll the channel(s) for new, cancelled and delivered orders now (queued)',
  })
  @ZodResponse({ status: 202, type: TriggerChannelsResponseDto })
  async importOrders(@Body() body: TriggerChannelRequestDto) {
    return this.sync.triggerOrderImport(
      await this.tenant.resolve(),
      body.channelId,
    );
  }

  @Post('orders/supplier-status/poll')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Poll the status and tracking of submitted supplier orders now (queued)',
  })
  @ZodResponse({ status: 202, type: TriggerPollResponseDto })
  async pollSupplierOrderStatus() {
    return this.sync.triggerSupplierOrderStatusPoll(
      await this.tenant.resolve(),
    );
  }

  @Post('listings/reviews/poll')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Poll Temu listing and price reviews now (queued)',
  })
  @ZodResponse({ status: 202, type: TriggerChannelsResponseDto })
  async pollListingReviews(@Body() body: TriggerChannelRequestDto) {
    return this.sync.triggerListingReviewPoll(
      await this.tenant.resolve(),
      body.channelId,
    );
  }
}
