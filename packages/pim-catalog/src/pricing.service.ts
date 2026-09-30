import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, AssortmentItemStatus, PriceRounding, ProductStatus, SupplierProductStatus } from '@repo/database';
import {
  availableStock,
  calculatePrice,
  selectRule,
  type BlockReason,
  type PriceResult,
  type PricingRule,
  type RoundingMode,
  type RuleConditions,
} from '@repo/core-domain';
import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  DEFAULT_PRICING,
  DEFAULT_STOCK_BUFFER,
  FALLBACK_STOCK_BUFFER,
} from './constants';

const num = z.union([z.string(), z.number()]).optional();
const channelSettingsSchema = z.object({
  channelFeePct: num,
  channelFeeFixed: num,
  shippingAbsorbed: num,
  stockBuffer: z.number().optional(),
  stockCap: z.number().optional(),
});

const ROUNDING: Record<PriceRounding, RoundingMode> = {
  [PriceRounding.X99]: 'x.99',
  [PriceRounding.X90]: 'x.90',
  [PriceRounding.NONE]: 'none',
};

export interface QuoteInput {
  productId: string;
  channelId: string;
  /** Overrides the supplier cost (e.g. right after a cost sync). */
  cost?: string;
  override?: { gross: string; force?: boolean };
}

export interface ApplyInput extends QuoteInput {
  /** Required when forcing an override (audited). */
  actor?: string;
}

export interface PricingQuote {
  result: PriceResult;
  available: number;
}

export interface ApplyOutcome {
  sent: boolean;
  reason?: BlockReason;
  quote: PricingQuote;
}

@Injectable()
export class PricingService {
  constructor(private readonly db: DatabaseService) {}

  async quote(tenantId: string, input: QuoteInput): Promise<PricingQuote> {
    const product = await this.db.product.findFirst({
      where: { id: input.productId, tenantId, deletedAt: null },
      include: { supplierProduct: true },
    });
    if (!product) throw new NotFoundException(`Product ${input.productId} not found`);
    const channel = await this.db.channel.findFirst({ where: { id: input.channelId, tenantId, deletedAt: null } });
    if (!channel) throw new NotFoundException(`Channel ${input.channelId} not found`);
    const supplierProduct = product.supplierProduct;
    if (!supplierProduct) throw new BadRequestException(`Product ${product.id} has no supplier product`);
    const rawCost = input.cost ?? supplierProduct.costPrice;
    if (rawCost === null || rawCost === undefined) throw new BadRequestException(`Product ${product.id} has no cost`);
    const cost = String(rawCost);

    const settings = channelSettingsSchema.safeParse(channel.settings ?? {}).data ?? {};
    const rows = await this.db.priceRule.findMany({
      where: { tenantId, deletedAt: null, OR: [{ channelId: null }, { channelId: channel.id }] },
    });
    const vatByRule = new Map<string, string>();
    const rules: PricingRule[] = rows.map((r) => {
      vatByRule.set(r.id, String(r.vatRate));
      return {
        id: r.id,
        priority: r.priority,
        conditions: (r.condition ?? {}) as RuleConditions,
        markupPct: String(r.markupPct ?? 0),
        fixedAdd: r.fixedAdd === null ? undefined : String(r.fixedAdd),
        rounding: ROUNDING[r.rounding],
        minMarginPct: String(r.minMarginPct ?? 0),
      };
    });
    const defaultRule: PricingRule = {
      id: DEFAULT_PRICING.RULE_ID,
      priority: 0,
      markupPct: DEFAULT_PRICING.MARKUP_PCT,
      minMarginPct: DEFAULT_PRICING.MIN_MARGIN_PCT,
      rounding: DEFAULT_PRICING.ROUNDING,
    };
    const context = { channel: channel.code, category: product.categoryId ?? undefined };
    const chosen = selectRule(rules, defaultRule, { cost, ...context });
    const result = calculatePrice({
      cost,
      shippingAbsorbed: settings.shippingAbsorbed,
      vatRate: vatByRule.get(chosen.id) ?? DEFAULT_PRICING.VAT_RATE,
      channelFeePct: settings.channelFeePct,
      channelFeeFixed: settings.channelFeeFixed,
      rules,
      defaultRule,
      context,
      override: input.override,
    });

    const assortment = await this.db.supplierAssortmentItem.findFirst({
      where: { tenantId, supplierProductId: supplierProduct.id, status: AssortmentItemStatus.ACTIVE },
    });
    const available = availableStock({
      supplierStock: supplierProduct.stock,
      buffer: settings.stockBuffer ?? DEFAULT_STOCK_BUFFER[channel.code] ?? FALLBACK_STOCK_BUFFER,
      cap: settings.stockCap,
      published: product.status === ProductStatus.PUBLISHED,
      supplierProductMissing: supplierProduct.status === SupplierProductStatus.MISSING,
      assortmentDisabled: !assortment,
    });
    return { result, available };
  }

  /** Persists price/stock on the listing only when the price is not blocked. */
  async applyToListing(tenantId: string, input: ApplyInput): Promise<ApplyOutcome> {
    const forced = input.override?.force === true;
    if (forced && !input.actor) throw new BadRequestException('A forced price override requires an actor');
    const quote = await this.quote(tenantId, input);
    if (quote.result.status === 'blocked') return { sent: false, reason: quote.result.reason, quote };

    const values = { lastPrice: quote.result.gross, lastStock: quote.available };
    await this.db.channelListing.upsert({
      where: { productId_channelId: { productId: input.productId, channelId: input.channelId } },
      update: values,
      create: { tenantId, productId: input.productId, channelId: input.channelId, ...values },
    });
    if (forced) {
      await this.db.auditEvent.create({
        data: {
          tenantId,
          actor: input.actor as string,
          entity: AUDIT_ENTITIES.PRODUCT,
          entityId: input.productId,
          action: AUDIT_ACTIONS.PRICE_FORCE_OVERRIDE,
          diff: { channelId: input.channelId, gross: quote.result.gross, marginPct: quote.result.marginPct, ruleId: quote.result.ruleId },
        },
      });
    }
    return { sent: true, quote };
  }
}
