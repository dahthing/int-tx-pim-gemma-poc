import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, PriceRounding, Prisma } from '@repo/database';
import type {
  CreatePriceRuleRequest,
  PriceRuleDto,
  UpdatePriceRuleRequest,
} from '@repo/shared-types';
import { dec, iso } from '../util/mappers';

const TO_DB: Record<'x.99' | 'x.90' | 'none', PriceRounding> = {
  'x.99': PriceRounding.X99,
  'x.90': PriceRounding.X90,
  none: PriceRounding.NONE,
};
const FROM_DB: Record<PriceRounding, 'x.99' | 'x.90' | 'none'> = {
  [PriceRounding.X99]: 'x.99',
  [PriceRounding.X90]: 'x.90',
  [PriceRounding.NONE]: 'none',
};

type Row = Prisma.PriceRuleGetPayload<object>;

/** FR-PRC price rules CRUD (soft delete). Percentages are fractions; money is decimal strings. */
@Injectable()
export class PriceRuleService {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string): Promise<PriceRuleDto[]> {
    const rows = await this.db.priceRule.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(tenantId: string, id: string): Promise<PriceRuleDto> {
    return this.toDto(await this.find(tenantId, id));
  }

  async create(
    tenantId: string,
    input: CreatePriceRuleRequest,
  ): Promise<PriceRuleDto> {
    if (input.channelId) await this.assertChannel(tenantId, input.channelId);
    const row = await this.db.priceRule.create({
      data: {
        tenantId,
        channelId: input.channelId ?? null,
        priority: input.priority,
        condition: input.condition as Prisma.InputJsonValue,
        markupPct: input.markupPct ?? null,
        fixedAdd: input.fixedAdd ?? null,
        rounding: TO_DB[input.rounding],
        minMarginPct: input.minMarginPct ?? null,
        vatRate: input.vatRate,
      },
    });
    return this.toDto(row);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdatePriceRuleRequest,
  ): Promise<PriceRuleDto> {
    await this.find(tenantId, id);
    if (input.channelId) await this.assertChannel(tenantId, input.channelId);
    const data: Prisma.PriceRuleUncheckedUpdateInput = {
      ...(input.channelId !== undefined && { channelId: input.channelId }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.condition !== undefined && {
        condition: input.condition as Prisma.InputJsonValue,
      }),
      ...(input.markupPct !== undefined && { markupPct: input.markupPct }),
      ...(input.fixedAdd !== undefined && { fixedAdd: input.fixedAdd }),
      ...(input.rounding !== undefined && { rounding: TO_DB[input.rounding] }),
      ...(input.minMarginPct !== undefined && {
        minMarginPct: input.minMarginPct,
      }),
      ...(input.vatRate !== undefined && { vatRate: input.vatRate }),
    };
    return this.toDto(await this.db.priceRule.update({ where: { id }, data }));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    await this.db.priceRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async find(tenantId: string, id: string): Promise<Row> {
    const row = await this.db.priceRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`Price rule ${id} not found`);
    return row;
  }

  private async assertChannel(
    tenantId: string,
    channelId: string,
  ): Promise<void> {
    const channel = await this.db.channel.findFirst({
      where: { id: channelId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);
  }

  private toDto(r: Row): PriceRuleDto {
    return {
      id: r.id,
      channelId: r.channelId,
      priority: r.priority,
      condition: (r.condition ?? {}) as PriceRuleDto['condition'],
      markupPct: dec(r.markupPct),
      fixedAdd: dec(r.fixedAdd),
      rounding: FROM_DB[r.rounding],
      minMarginPct: dec(r.minMarginPct),
      vatRate: dec(r.vatRate) as string,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  }
}
