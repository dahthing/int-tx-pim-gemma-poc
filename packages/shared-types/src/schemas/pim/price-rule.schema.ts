import { z } from 'zod';
import {
  fractionStringSchema,
  isoDateTimeSchema,
  priceRoundingSchema,
} from './common.schema.js';

export const priceRuleConditionSchema = z
  .object({
    channel: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    costMin: fractionStringSchema.optional(),
    costMax: fractionStringSchema.optional(),
    tag: z.string().min(1).optional(),
  })
  .strict()
  .meta({ id: 'PriceRuleCondition' });

/** All percentages are fractions (0.5 = 50 %). */
export const priceRuleSchema = z
  .object({
    id: z.string(),
    channelId: z.string().nullable(),
    priority: z.number().int(),
    condition: priceRuleConditionSchema,
    markupPct: fractionStringSchema.nullable(),
    fixedAdd: fractionStringSchema.nullable(),
    rounding: priceRoundingSchema,
    minMarginPct: fractionStringSchema.nullable(),
    vatRate: fractionStringSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'PriceRule' });

export const priceRuleListSchema = z
  .object({ items: z.array(priceRuleSchema) })
  .meta({ id: 'PriceRuleList' });

export const createPriceRuleRequestSchema = z
  .object({
    channelId: z.string().min(1).nullish(),
    priority: z.number().int().min(0).max(10_000).default(0),
    condition: priceRuleConditionSchema.default({}),
    markupPct: fractionStringSchema.nullish(),
    fixedAdd: fractionStringSchema.nullish(),
    rounding: priceRoundingSchema.default('none'),
    minMarginPct: fractionStringSchema.nullish(),
    vatRate: fractionStringSchema,
  })
  .meta({ id: 'CreatePriceRuleRequest' });

export const updatePriceRuleRequestSchema = z
  .object({
    channelId: z.string().min(1).nullish(),
    priority: z.number().int().min(0).max(10_000),
    condition: priceRuleConditionSchema,
    markupPct: fractionStringSchema.nullish(),
    fixedAdd: fractionStringSchema.nullish(),
    rounding: priceRoundingSchema,
    minMarginPct: fractionStringSchema.nullish(),
    vatRate: fractionStringSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  })
  .meta({ id: 'UpdatePriceRuleRequest' });

export type PriceRuleDto = z.infer<typeof priceRuleSchema>;
export type CreatePriceRuleRequest = z.infer<
  typeof createPriceRuleRequestSchema
>;
export type UpdatePriceRuleRequest = z.infer<
  typeof updatePriceRuleRequestSchema
>;
