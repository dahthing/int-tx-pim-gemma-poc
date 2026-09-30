import { baseEnvSchema } from '@repo/shared';
import z from 'zod';

export const apiEnvSchema = baseEnvSchema.extend({
  CORS_ORIGIN: z.string().min(1),
  // PIM runtime (@repo/pim-runtime). All optional at boot: each value is read when a feature first needs it.
  PIM_ENCRYPTION_KEY: z.string().optional(),
  PIM_TENANT_SLUG: z.string().optional(),
  PIM_S3_ENDPOINT: z.string().optional(),
  PIM_S3_REGION: z.string().optional(),
  PIM_S3_BUCKET: z.string().optional(),
  PIM_S3_ACCESS_KEY: z.string().optional(),
  PIM_S3_SECRET_KEY: z.string().optional(),
  PIM_S3_PUBLIC_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  PIM_LLM_MODEL: z.string().optional(),
  PIM_LLM_BASE_URL: z.string().optional(),
  PIM_LLM_MAX_TOKENS: z.string().optional(),
  PIM_ORDER_DEFAULT_EMAIL: z.string().optional(),
  PIM_ORDER_DEFAULT_PHONE: z.string().optional(),
  PIM_ORDER_MIN_MARGIN: z.string().optional(),
  PIM_ORDER_VAT_RATE: z.string().optional(),
  PIM_ORDER_SHIPPING_ABSORBED: z.string().optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
