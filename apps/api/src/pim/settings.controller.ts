import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { SettingsService, TenantContext } from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import { actorOf } from './actor';
import {
  ChannelSettingsDto,
  ConnectionTestResponseDto,
  CreateChannelRequestDto,
  CreateSupplierRequestDto,
  SettingsResponseDto,
  SupplierSettingsDto,
  UpdateChannelRequestDto,
  UpdateSupplierRequestDto,
} from './dto';

/**
 * Credentials are write-only: they are accepted in request bodies, stored AES-GCM encrypted and never returned
 * (responses only carry `credentialsConfigured`).
 */
@ApiTags('settings')
@Roles(RoleEnum.ADMIN)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Suppliers, channels, environments and tenant defaults (never credentials)',
  })
  @ZodResponse({ type: SettingsResponseDto })
  async get() {
    return this.settings.get(await this.tenant.resolve());
  }

  @Post('suppliers')
  @ZodResponse({ status: 201, type: SupplierSettingsDto })
  async createSupplier(
    @Body() body: CreateSupplierRequestDto,
    @CurrentUser() user: unknown,
  ) {
    return this.settings.createSupplier(
      await this.tenant.resolve(),
      body,
      actorOf(user),
    );
  }

  @Patch('suppliers/:id')
  @ZodResponse({ type: SupplierSettingsDto })
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: UpdateSupplierRequestDto,
    @CurrentUser() user: unknown,
  ) {
    return this.settings.updateSupplier(
      await this.tenant.resolve(),
      id,
      body,
      actorOf(user),
    );
  }

  @Post('suppliers/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Test the stored supplier credentials' })
  @ZodResponse({ status: 200, type: ConnectionTestResponseDto })
  async testSupplier(@Param('id') id: string) {
    return this.settings.testSupplier(await this.tenant.resolve(), id);
  }

  @Post('channels')
  @ZodResponse({ status: 201, type: ChannelSettingsDto })
  async createChannel(
    @Body() body: CreateChannelRequestDto,
    @CurrentUser() user: unknown,
  ) {
    return this.settings.createChannel(
      await this.tenant.resolve(),
      body,
      actorOf(user),
    );
  }

  @Patch('channels/:id')
  @ZodResponse({ type: ChannelSettingsDto })
  async updateChannel(
    @Param('id') id: string,
    @Body() body: UpdateChannelRequestDto,
    @CurrentUser() user: unknown,
  ) {
    return this.settings.updateChannel(
      await this.tenant.resolve(),
      id,
      body,
      actorOf(user),
    );
  }

  @Post('channels/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Test the stored channel credentials' })
  @ZodResponse({ status: 200, type: ConnectionTestResponseDto })
  async testChannel(@Param('id') id: string) {
    return this.settings.testChannel(await this.tenant.resolve(), id);
  }
}
