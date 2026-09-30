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
import { PaginatedUtil } from '@repo/shared';
import { ShipmentService } from '@repo/pim-orders';
import { OrdersQueryService, TenantContext } from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import {
  ManualTrackingRequestDto,
  ManualTrackingResponseDto,
  OrderDetailDto,
  OrderListQueryDto,
  OrderPageDto,
  RetryOrderResponseDto,
} from './dto';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly orders: OrdersQueryService,
    private readonly shipments: ShipmentService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Channel orders with state machine status and AW order (no customer data)',
  })
  @ZodResponse({ type: OrderPageDto })
  async list(@Query() query: OrderListQueryDto) {
    const { items, total } = await this.orders.list(
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

  @Get(':id')
  @ZodResponse({ type: OrderDetailDto })
  async detail(@Param('id') id: string) {
    return this.orders.detail(await this.tenant.resolve(), id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Route the order to the supplier again (queued); only for imported / routing / failed / manual review orders',
  })
  @ZodResponse({ status: 202, type: RetryOrderResponseDto })
  async retry(@Param('id') id: string) {
    return this.orders.retry(await this.tenant.resolve(), id);
  }

  @Post(':id/tracking')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Manual tracking: creates the shipment and pushes it to the originating channel (idempotent)',
  })
  @ZodResponse({ status: 200, type: ManualTrackingResponseDto })
  async recordTracking(
    @Param('id') id: string,
    @Body() body: ManualTrackingRequestDto,
  ) {
    return this.shipments.recordManualTracking(
      await this.tenant.resolve(),
      id,
      body,
    );
  }
}
