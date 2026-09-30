import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryMappingService } from '@repo/pim-catalog';
import {
  CatalogQueryService,
  ChannelAdminService,
  TenantContext,
} from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import {
  CategoryDto,
  CategoryListDto,
  ChannelAttributesResponseDto,
  ChannelCategoryTreeDto,
  CreateCategoryRequestDto,
  MapSupplierPathRequestDto,
  SupplierPathMappingListDto,
} from './dto';

@ApiTags('category-mapping')
@Controller()
export class CategoriesController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly catalog: CatalogQueryService,
    private readonly channels: ChannelAdminService,
    private readonly mapping: CategoryMappingService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: 'Internal category tree (flat, with parentId)' })
  @ZodResponse({ type: CategoryListDto })
  async categories() {
    return {
      items: await this.catalog.listCategories(await this.tenant.resolve()),
    };
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create an internal category' })
  @ZodResponse({ status: 201, type: CategoryDto })
  async createCategory(@Body() body: CreateCategoryRequestDto) {
    return this.catalog.createCategory(await this.tenant.resolve(), body);
  }

  @Get('category-mappings/supplier-paths')
  @ApiOperation({
    summary:
      'Every supplier department / sub-department / family with its current mapping',
  })
  @ZodResponse({ type: SupplierPathMappingListDto })
  async supplierPaths() {
    return {
      items: await this.catalog.supplierPathMappings(
        await this.tenant.resolve(),
      ),
    };
  }

  @Put('category-mappings')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Map a supplier path to an internal category and channel category ids (history is kept)',
  })
  async mapSupplierPath(
    @Body() body: MapSupplierPathRequestDto,
  ): Promise<void> {
    const tenantId = await this.tenant.resolve();
    await this.mapping.mapSupplierPath(
      tenantId,
      await this.catalog.prepareMapping(tenantId, body),
    );
  }

  @Get('channels/:channelId/categories')
  @ApiOperation({ summary: 'Category tree of the channel (Temu)' })
  @ZodResponse({ type: ChannelCategoryTreeDto })
  async channelCategories(@Param('channelId') channelId: string) {
    return {
      items: await this.channels.categoryTree(
        await this.tenant.resolve(),
        channelId,
      ),
    };
  }

  @Post('channels/:channelId/categories/:channelCategoryId/attributes')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Load the attributes of a channel category and store which are mandatory',
  })
  @ZodResponse({ status: 200, type: ChannelAttributesResponseDto })
  async loadAttributes(
    @Param('channelId') channelId: string,
    @Param('channelCategoryId') channelCategoryId: string,
  ) {
    return this.channels.loadAttributes(
      await this.tenant.resolve(),
      channelId,
      channelCategoryId,
    );
  }
}
