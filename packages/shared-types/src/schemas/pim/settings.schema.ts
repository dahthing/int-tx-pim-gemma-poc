import { z } from 'zod';
import {
  channelCodeSchema,
  isoDateTimeSchema,
  supplierEnvironmentSchema,
} from './common.schema.js';

/**
 * Credentials are WRITE-ONLY: they appear in request schemas only. Responses expose `credentialsConfigured`
 * and never a secret, masked or not (NFR-03).
 */
export const supplierCredentialsSchema = z
  .object({ token: z.string().min(1) })
  .meta({ id: 'SupplierCredentialsInput' });

export const prestashopCredentialsSchema = z
  .object({
    adminApi: z
      .object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
      .optional(),
    webservice: z.object({ key: z.string().min(1) }).optional(),
  })
  .refine((v) => !!(v.adminApi || v.webservice), {
    message: 'Provide adminApi and/or webservice credentials',
  })
  .meta({ id: 'PrestashopCredentialsInput' });

export const temuCredentialsSchema = z
  .object({
    appKey: z.string().min(1),
    appSecret: z.string().min(1),
    accessToken: z.string().min(1),
  })
  .meta({ id: 'TemuCredentialsInput' });

export const supplierSettingsSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    environment: supplierEnvironmentSchema,
    baseUrl: z.string().nullable(),
    credentialsConfigured: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'SupplierSettings' });

export const channelSettingsSchema = z
  .object({
    id: z.string(),
    code: channelCodeSchema,
    name: z.string().nullable(),
    /** Non-secret settings only (base URL, language, carrier table, stock buffer...). */
    settings: z.record(z.string(), z.unknown()),
    credentialsConfigured: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .meta({ id: 'ChannelSettings' });

export const tenantDefaultsSchema = z
  .object({
    defaultEmail: z.string().nullable(),
    defaultPhone: z.string().nullable(),
    minMargin: z.string(),
    vatRate: z.string(),
  })
  .meta({ id: 'TenantDefaults' });

export const settingsResponseSchema = z
  .object({
    suppliers: z.array(supplierSettingsSchema),
    channels: z.array(channelSettingsSchema),
    /** Read-only (configured through the environment). */
    tenantDefaults: tenantDefaultsSchema,
  })
  .meta({ id: 'SettingsResponse' });

export const createSupplierRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    environment: supplierEnvironmentSchema.default('staging'),
    baseUrl: z.url().nullish(),
    credentials: supplierCredentialsSchema,
  })
  .meta({ id: 'CreateSupplierRequest' });

export const updateSupplierRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    environment: supplierEnvironmentSchema,
    baseUrl: z.url().nullish(),
    credentials: supplierCredentialsSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  })
  .meta({ id: 'UpdateSupplierRequest' });

const channelSettingsInput = z.record(z.string(), z.unknown());

export const createChannelRequestSchema = z
  .object({
    code: channelCodeSchema,
    name: z.string().trim().min(1).max(120).optional(),
    settings: channelSettingsInput.default({}),
    credentials: z.union([prestashopCredentialsSchema, temuCredentialsSchema]),
  })
  .meta({ id: 'CreateChannelRequest' });

export const updateChannelRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    settings: channelSettingsInput,
    credentials: z.union([prestashopCredentialsSchema, temuCredentialsSchema]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  })
  .meta({ id: 'UpdateChannelRequest' });

export const connectionTestResponseSchema = z
  .object({
    ok: z.boolean(),
    reason: z
      .enum([
        'invalid_credentials',
        'reauthorization_required',
        'unreachable',
        'unknown',
      ])
      .optional(),
    message: z.string().optional(),
    accountName: z.string().optional(),
    currency: z.string().optional(),
  })
  .meta({ id: 'ConnectionTestResponse' });

export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
export type SupplierSettings = z.infer<typeof supplierSettingsSchema>;
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
