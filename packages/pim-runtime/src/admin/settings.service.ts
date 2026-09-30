import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionTestResult } from '@repo/connector-contracts';
import { DatabaseService, Prisma, SupplierEnvironment } from '@repo/database';
import { isSensitiveKey, redact, redactText } from '@repo/http-client';
import { CHANNEL_CODES } from '@repo/pim-orders';
import {
  prestashopCredentialsSchema,
  temuCredentialsSchema,
  type ChannelSettings,
  type CreateChannelRequest,
  type CreateSupplierRequest,
  type SettingsResponse,
  type SupplierSettings,
  type UpdateChannelRequest,
  type UpdateSupplierRequest,
} from '@repo/shared-types';
import { ConnectorFactory } from '../adapters/connector-factory';
import { CredentialVault } from '../adapters/credential-vault';
import {
  RUNTIME_AUDIT,
  RUNTIME_CONFIG,
  RUNTIME_DEFAULTS,
} from '../runtime.constants';
import { iso, lower, upper } from '../util/mappers';

type SupplierRow = Prisma.SupplierGetPayload<object>;
type ChannelRow = Prisma.ChannelGetPayload<object>;

const CHANNEL_CREDENTIAL_SCHEMAS = {
  [CHANNEL_CODES.PRESTASHOP9]: prestashopCredentialsSchema,
  [CHANNEL_CODES.TEMU_EU]: temuCredentialsSchema,
} as const;

/** Keys that hold a URL *to* a token endpoint are configuration, not secrets. */
const isSecretKey = (key: string): boolean =>
  isSensitiveKey(key) && !/url$/i.test(key);

function assertNoSecrets(value: unknown, path = 'settings'): void {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      throw new BadRequestException(
        `${path}.${key} looks like a secret: send credentials in "credentials" (write-only), not in settings`,
      );
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

/**
 * Supplier and channel configuration. Credentials are WRITE-ONLY (NFR-03): encrypted with core-domain AES-GCM into
 * `credentialsEnc`, audited by field name only, and never returned, masked or otherwise. Responses only say whether
 * credentials are configured.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vault: CredentialVault,
    private readonly factory: ConnectorFactory,
    private readonly config: ConfigService,
  ) {}

  async get(tenantId: string): Promise<SettingsResponse> {
    const [suppliers, channels] = await Promise.all([
      this.db.supplier.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.channel.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      suppliers: suppliers.map((s) => this.supplierDto(s)),
      channels: channels.map((c) => this.channelDto(c)),
      tenantDefaults: {
        defaultEmail:
          this.config.get<string>(RUNTIME_CONFIG.ORDER_DEFAULT_EMAIL) ?? null,
        defaultPhone:
          this.config.get<string>(RUNTIME_CONFIG.ORDER_DEFAULT_PHONE) ?? null,
        minMargin:
          this.config.get<string>(RUNTIME_CONFIG.ORDER_MIN_MARGIN) ??
          RUNTIME_DEFAULTS.ORDER_MIN_MARGIN,
        vatRate:
          this.config.get<string>(RUNTIME_CONFIG.ORDER_VAT_RATE) ??
          RUNTIME_DEFAULTS.ORDER_VAT_RATE,
      },
    };
  }

  // ---- suppliers ---------------------------------------------------------------------------------------------

  async createSupplier(
    tenantId: string,
    input: CreateSupplierRequest,
    actor: string,
  ): Promise<SupplierSettings> {
    const clash = await this.db.supplier.findFirst({
      where: { tenantId, code: input.code },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(`Supplier "${input.code}" already exists`);
    const row = await this.db.supplier.create({
      data: {
        tenantId,
        code: input.code,
        name: input.name,
        environment: upper(input.environment) as SupplierEnvironment,
        baseUrl: input.baseUrl ?? null,
        credentialsEnc: await this.vault.encrypt(tenantId, input.credentials),
      },
    });
    await this.auditCredentials(
      tenantId,
      actor,
      'supplier',
      row.id,
      Object.keys(input.credentials),
    );
    return this.supplierDto(row);
  }

  async updateSupplier(
    tenantId: string,
    id: string,
    input: UpdateSupplierRequest,
    actor: string,
  ): Promise<SupplierSettings> {
    await this.findSupplier(tenantId, id);
    const data: Prisma.SupplierUncheckedUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.environment !== undefined && {
        environment: upper(input.environment) as SupplierEnvironment,
      }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.credentials !== undefined && {
        credentialsEnc: await this.vault.encrypt(tenantId, input.credentials),
      }),
    };
    const row = await this.db.supplier.update({ where: { id }, data });
    if (input.credentials)
      await this.auditCredentials(
        tenantId,
        actor,
        'supplier',
        id,
        Object.keys(input.credentials),
      );
    return this.supplierDto(row);
  }

  async testSupplier(tenantId: string, id: string) {
    await this.findSupplier(tenantId, id);
    try {
      return this.flatten(
        await (await this.factory.source(tenantId, id)).testConnection(),
      );
    } catch (e) {
      return {
        ok: false,
        reason: 'unknown' as const,
        message: redactText((e as Error).message),
      };
    }
  }

  // ---- channels ----------------------------------------------------------------------------------------------

  async createChannel(
    tenantId: string,
    input: CreateChannelRequest,
    actor: string,
  ): Promise<ChannelSettings> {
    const clash = await this.db.channel.findFirst({
      where: { tenantId, code: input.code },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(`Channel "${input.code}" already exists`);
    assertNoSecrets(input.settings);
    const credentials = this.parseChannelCredentials(
      input.code,
      input.credentials,
    );
    const row = await this.db.channel.create({
      data: {
        tenantId,
        code: input.code,
        name: input.name ?? null,
        settings: input.settings as Prisma.InputJsonValue,
        credentialsEnc: await this.vault.encrypt(tenantId, credentials),
      },
    });
    await this.auditCredentials(
      tenantId,
      actor,
      'channel',
      row.id,
      Object.keys(credentials),
    );
    return this.channelDto(row);
  }

  async updateChannel(
    tenantId: string,
    id: string,
    input: UpdateChannelRequest,
    actor: string,
  ): Promise<ChannelSettings> {
    const existing = await this.findChannel(tenantId, id);
    if (input.settings !== undefined) assertNoSecrets(input.settings);
    const credentials =
      input.credentials === undefined
        ? undefined
        : this.parseChannelCredentials(existing.code, input.credentials);
    const data: Prisma.ChannelUncheckedUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.settings !== undefined && {
        settings: input.settings as Prisma.InputJsonValue,
      }),
      ...(credentials !== undefined && {
        credentialsEnc: await this.vault.encrypt(tenantId, credentials),
      }),
    };
    const row = await this.db.channel.update({ where: { id }, data });
    if (credentials)
      await this.auditCredentials(
        tenantId,
        actor,
        'channel',
        id,
        Object.keys(credentials),
      );
    return this.channelDto(row);
  }

  async testChannel(tenantId: string, id: string) {
    const channel = await this.findChannel(tenantId, id);
    try {
      const connector = await this.factory.channel({
        id,
        tenantId,
        code: channel.code,
        settings: channel.settings,
      });
      return this.flatten(await connector.testConnection());
    } catch (e) {
      return {
        ok: false,
        reason: 'unknown' as const,
        message: redactText((e as Error).message),
      };
    }
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  private parseChannelCredentials(
    code: string,
    raw: unknown,
  ): Record<string, unknown> {
    const schema =
      CHANNEL_CREDENTIAL_SCHEMAS[
        code as keyof typeof CHANNEL_CREDENTIAL_SCHEMAS
      ];
    if (!schema)
      throw new BadRequestException(`Unsupported channel code: ${code}`);
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(
        `Invalid ${code} credentials: ${parsed.error.issues.map((i) => i.path.join('.') || 'value').join(', ')}`,
      );
    return parsed.data as Record<string, unknown>;
  }

  /** The audit trail records which credential fields changed, never their values. */
  private async auditCredentials(
    tenantId: string,
    actor: string,
    target: 'supplier' | 'channel',
    entityId: string,
    fields: string[],
  ): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        tenantId,
        actor,
        entity: RUNTIME_AUDIT.ENTITY_SETTINGS,
        entityId,
        action: RUNTIME_AUDIT.ACTION_CREDENTIALS_UPDATED,
        diff: { target, fields },
      },
    });
  }

  private async findSupplier(
    tenantId: string,
    id: string,
  ): Promise<SupplierRow> {
    const row = await this.db.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`Supplier ${id} not found`);
    return row;
  }

  private async findChannel(tenantId: string, id: string): Promise<ChannelRow> {
    const row = await this.db.channel.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return row;
  }

  private supplierDto(s: SupplierRow): SupplierSettings {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      environment: lower(s.environment),
      baseUrl: s.baseUrl,
      credentialsConfigured: !!s.credentialsEnc,
      updatedAt: iso(s.updatedAt),
    };
  }

  private channelDto(c: ChannelRow): ChannelSettings {
    return {
      id: c.id,
      code: c.code as ChannelSettings['code'],
      name: c.name,
      settings: redact(c.settings ?? {}) as Record<string, unknown>,
      credentialsConfigured: !!c.credentialsEnc,
      updatedAt: iso(c.updatedAt),
    };
  }

  private flatten(r: ConnectionTestResult) {
    return r.ok
      ? { ok: true, accountName: r.accountName, currency: r.currency }
      : { ok: false, reason: r.reason, message: r.message };
  }
}
