import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginatedUtil } from '@repo/shared';
import {
  CatalogOpsService,
  CatalogQueryService,
  TenantContext,
} from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import {
  BulkAddRequestDto,
  BulkAddResponseDto,
  SupplierProductFacetsDto,
  SupplierProductFacetsQueryDto,
  SupplierProductListQueryDto,
  SupplierProductPageDto,
} from './dto';

@ApiTags('supplier-catalogue')
@Controller('supplier-products')
export class SupplierProductsController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly catalog: CatalogQueryService,
    private readonly ops: CatalogOpsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Supplier catalogue with search, department / family filters, stock and cost',
  })
  @ZodResponse({ type: SupplierProductPageDto })
  async list(@Query() query: SupplierProductListQueryDto) {
    const { items, total } = await this.catalog.listSupplierProducts(
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

  @Get('facets')
  @ApiOperation({
    summary:
      'Distinct department / sub-department / family values for the filters',
  })
  @ZodResponse({ type: SupplierProductFacetsDto })
  async facets(@Query() query: SupplierProductFacetsQueryDto) {
    return this.catalog.supplierFacets(await this.tenant.resolve(), query);
  }

  @Post('bulk-add')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Add supplier products to the Gemma assortment (AW portfolio + draft product); per-item results',
  })
  @ZodResponse({ status: 200, type: BulkAddResponseDto })
  async bulkAdd(@Body() body: BulkAddRequestDto) {
    return {
      results: await this.ops.addToGemma(
        await this.tenant.resolve(),
        body.supplierProductIds,
        body.supplierId,
      ),
    };
  }
}
