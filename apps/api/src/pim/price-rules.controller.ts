import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PriceRuleService, TenantContext } from '@repo/pim-runtime';
import { ZodResponse } from 'nestjs-zod';
import {
  CreatePriceRuleRequestDto,
  PriceRuleDto,
  PriceRuleListDto,
  UpdatePriceRuleRequestDto,
} from './dto';

@ApiTags('price-rules')
@Controller('price-rules')
export class PriceRulesController {
  constructor(
    private readonly tenant: TenantContext,
    private readonly rules: PriceRuleService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Price rules by priority (percentages are fractions: 0.5 = 50 %)',
  })
  @ZodResponse({ type: PriceRuleListDto })
  async list() {
    return { items: await this.rules.list(await this.tenant.resolve()) };
  }

  @Get(':id')
  @ZodResponse({ type: PriceRuleDto })
  async get(@Param('id') id: string) {
    return this.rules.get(await this.tenant.resolve(), id);
  }

  @Post()
  @ZodResponse({ status: 201, type: PriceRuleDto })
  async create(@Body() body: CreatePriceRuleRequestDto) {
    return this.rules.create(await this.tenant.resolve(), body);
  }

  @Patch(':id')
  @ZodResponse({ type: PriceRuleDto })
  async update(
    @Param('id') id: string,
    @Body() body: UpdatePriceRuleRequestDto,
  ) {
    return this.rules.update(await this.tenant.resolve(), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.rules.remove(await this.tenant.resolve(), id);
  }
}
