import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, PaginatedUtil } from '@repo/shared';
import { CategoryMappingService, EnrichmentService } from '@repo/pim-catalog';
import {
  CatalogOpsService,
  CatalogQueryService,
  ChannelAdminService,
  TenantContext,
} from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import { actorOf } from './actor';
import {
  EnrichmentApproveResponseDto,
  EnrichmentGenerateResponseDto,
  MediaImportResponseDto,
  PricingQuoteDto,
  PricingQuoteRequestDto,
  ProductDetailDto,
  ProductListQueryDto,
  ProductPageDto,
  ProductPricingDto,
  PublishListingResponseDto,
  PublishReadinessDto,
  UnpublishListingResponseDto,
} from './dto';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly catalog: CatalogQueryService,
    private readonly ops: CatalogOpsService,
    private readonly channels: ChannelAdminService,
    private readonly enrichment: EnrichmentService,
    private readonly categoryMapping: CategoryMappingService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Products with status and per-channel listing status',
  })
  @ZodResponse({ type: ProductPageDto })
  async list(@Query() query: ProductListQueryDto) {
    const { items, total } = await this.catalog.listProducts(
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
  @ApiOperation({
    summary:
      'Golden record: info, media, enrichment, supplier data and listings',
  })
  @ZodResponse({ type: ProductDetailDto })
  async detail(@Param('id') id: string) {
    return this.catalog.productDetail(await this.tenant.resolve(), id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Remove from Gemma: archive, deactivate listings and leave the AW portfolio',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.ops.removeFromGemma(await this.tenant.resolve(), id);
  }

  @Post(':id/media/import')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Download the supplier images into our storage (deduplicated by checksum)',
  })
  @ZodResponse({ status: 200, type: MediaImportResponseDto })
  async importMedia(@Param('id') id: string) {
    return this.ops.importMedia(await this.tenant.resolve(), id);
  }

  @Post(':id/enrichment/generate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Generate the PT-PT enrichment draft with the LLM; invalid output is returned as errors, never saved',
  })
  @ZodResponse({ status: 200, type: EnrichmentGenerateResponseDto })
  async generateEnrichment(@Param('id') id: string) {
    const r = await this.enrichment.generate(await this.tenant.resolve(), id);
    return r.ok ? { ok: true } : { ok: false, errors: r.errors };
  }

  @Post(':id/enrichment/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Human approval of the AI draft (required before publishing)',
  })
  @ZodResponse({ status: 200, type: EnrichmentApproveResponseDto })
  async approveEnrichment(
    @Param('id') id: string,
    @CurrentUser() user: unknown,
  ) {
    await this.enrichment.approve(
      await this.tenant.resolve(),
      id,
      actorOf(user),
    );
    return { enrichmentStatus: 'approved' as const };
  }

  @Get(':id/pricing')
  @ApiOperation({ summary: 'Computed price and margin per channel' })
  @ZodResponse({ type: ProductPricingDto })
  async pricing(@Param('id') id: string) {
    return { quotes: await this.ops.quoteAll(await this.tenant.resolve(), id) };
  }

  @Post(':id/pricing/quote')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Price quote for one channel, optionally with a cost or price override (what-if)',
  })
  @ZodResponse({ status: 200, type: PricingQuoteDto })
  async quote(@Param('id') id: string, @Body() body: PricingQuoteRequestDto) {
    return this.ops.quote(await this.tenant.resolve(), {
      productId: id,
      channelId: body.channelId,
      cost: body.cost,
      override: body.override,
    });
  }

  @Get(':id/channels/:channelId/readiness')
  @ApiOperation({
    summary: 'Everything that prevents publishing the product to the channel',
  })
  @ZodResponse({ type: PublishReadinessDto })
  async readiness(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.categoryMapping.validatePublishReadiness(
      await this.tenant.resolve(),
      id,
      channelId,
    );
  }

  @Post(':id/channels/:channelId/publish')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Publish or update the product on the channel (needs approved enrichment and a category mapping)',
  })
  @ZodResponse({ status: 200, type: PublishListingResponseDto })
  async publish(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.publish(await this.tenant.resolve(), id, channelId);
  }

  @Post(':id/channels/:channelId/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate the listing on the channel' })
  @ZodResponse({ status: 200, type: UnpublishListingResponseDto })
  async unpublish(
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.unpublish(await this.tenant.resolve(), id, channelId);
  }
}
