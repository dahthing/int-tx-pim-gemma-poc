import { Injectable, NotFoundException } from '@nestjs/common';
import {
  selectRule,
  type PriceInput,
  type PricingRule,
  type RoundingMode,
  type RuleConditions,
  type StockInput,
} from '@repo/core-domain';
import {
  AssortmentItemStatus,
  DatabaseService,
  PriceRounding,
  ProductStatus,
  SupplierProductStatus,
} from '@repo/database';
import {
  DEFAULT_PRICING,
  DEFAULT_STOCK_BUFFER,
  FALLBACK_STOCK_BUFFER,
} from '@repo/pim-catalog';
import { z } from 'zod';

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

export interface PricingContext {
  productId: string;
  price: PriceInput;
  stock: StockInput;
}

const str = (v: string | number | undefined): string | undefined =>
  v === undefined ? undefined : String(v);

/**
 * Builds the pure-function inputs (core-domain `PriceInput` / `StockInput`) for products on a channel, with the same
 * rules as `PricingService.quote` (which only exposes the computed result). Used by the listing payload builder and
 * the stock/price sync input provider so both agree on price and availability.
 */
@Injectable()
export class PricingInputBuilder {
  constructor(private readonly db: DatabaseService) {}

  async buildMany(
    tenantId: string,
    channelId: string,
    productIds: string[],
  ): Promise<PricingContext[]> {
    const channel = await this.db.channel.findFirst({
      where: { id: channelId, tenantId, deletedAt: null },
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);
    if (productIds.length === 0) return [];

    const settings =
      channelSettingsSchema.safeParse(channel.settings ?? {}).data ?? {};
    const rows = await this.db.priceRule.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ channelId: null }, { channelId: channel.id }],
      },
    });
    const vatById = new Map<string, string>();
    const rules: PricingRule[] = rows.map((r) => {
      vatById.set(r.id, String(r.vatRate));
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

    const products = await this.db.product.findMany({
      where: { id: { in: productIds }, tenantId, deletedAt: null },
      include: { supplierProduct: true },
    });
    const supplierProductIds = products
      .map((p) => p.supplierProductId)
      .filter((id): id is string => !!id);
    const assortment = await this.db.supplierAssortmentItem.findMany({
      where: {
        tenantId,
        supplierProductId: { in: supplierProductIds },
        status: AssortmentItemStatus.ACTIVE,
      },
      select: { supplierProductId: true },
    });
    const active = new Set(assortment.map((a) => a.supplierProductId));

    const out: PricingContext[] = [];
    for (const product of products) {
      const sp = product.supplierProduct;
      if (!sp || sp.costPrice === null || sp.costPrice === undefined) continue;
      const context = {
        channel: channel.code,
        category: product.categoryId ?? undefined,
      };
      // VAT follows the rule the calculator will pick, so resolve the winner with the same selector.
      const chosen = selectRule(rules, defaultRule, {
        cost: String(sp.costPrice),
        ...context,
      });
      const vatRate = vatById.get(chosen.id) ?? DEFAULT_PRICING.VAT_RATE;
      out.push({
        productId: product.id,
        price: {
          cost: String(sp.costPrice),
          shippingAbsorbed: str(settings.shippingAbsorbed),
          vatRate,
          channelFeePct: str(settings.channelFeePct),
          channelFeeFixed: str(settings.channelFeeFixed),
          rules,
          defaultRule,
          context,
        },
        stock: {
          supplierStock: sp.stock,
          buffer:
            settings.stockBuffer ??
            DEFAULT_STOCK_BUFFER[channel.code] ??
            FALLBACK_STOCK_BUFFER,
          cap: settings.stockCap,
          published: product.status === ProductStatus.PUBLISHED,
          supplierProductMissing: sp.status === SupplierProductStatus.MISSING,
          assortmentDisabled: !active.has(sp.id),
        },
      });
    }
    return out;
  }

  async build(
    tenantId: string,
    productId: string,
    channelId: string,
  ): Promise<PricingContext> {
    const [ctx] = await this.buildMany(tenantId, channelId, [productId]);
    if (!ctx)
      throw new NotFoundException(
        `Product ${productId} cannot be priced (missing, no supplier product or no cost)`,
      );
    return ctx;
  }
}
