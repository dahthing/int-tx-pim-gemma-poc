import { Injectable } from '@nestjs/common';
import { AwAikuConnector } from '@repo/connector-aw-aiku';
import type {
  IChannelConnector,
  ISourceConnector,
} from '@repo/connector-contracts';
import {
  PrestaShop9Connector,
  type PrestaShop9Settings,
} from '@repo/connector-prestashop9';
import { TemuEuConnector, type CarrierTable } from '@repo/connector-temu-eu';
import { DatabaseService } from '@repo/database';
import { CHANNEL_CODES, type ChannelRef } from '@repo/pim-orders';
import { CredentialVault } from './credential-vault';
import { DbRequestLogSink } from './request-log.sink';

export type SupplierEnvironmentName = 'staging' | 'production';

export interface SupplierAccess {
  token: string;
  environment: SupplierEnvironmentName;
}

interface Ps9Credentials {
  adminApi?: { clientId: string; clientSecret: string };
  webservice?: { key: string };
}

interface TemuCredentialsRecord {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

interface Cached<T> {
  signature: string;
  connector: T;
}

/**
 * Builds connectors from decrypted Supplier / Channel credentials and wires the http-client request sink to
 * IntegrationRequestLog. Connectors are cached until their stored credentials or settings change.
 */
@Injectable()
export class ConnectorFactory {
  private readonly sources = new Map<string, Cached<AwAikuConnector>>();
  private readonly channels = new Map<string, Cached<IChannelConnector>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly vault: CredentialVault,
  ) {}

  async supplierAccess(
    tenantId: string,
    supplierId: string,
  ): Promise<SupplierAccess> {
    const supplier = await this.db.supplier.findFirst({
      where: { id: supplierId, tenantId, deletedAt: null },
    });
    if (!supplier) throw new Error(`Supplier ${supplierId} not found`);
    return this.accessOf(tenantId, supplier);
  }

  private async accessOf(
    tenantId: string,
    supplier: {
      id: string;
      environment: string;
      credentialsEnc: string | null;
    },
  ): Promise<SupplierAccess> {
    const creds = await this.vault.decrypt<{ token?: string }>(
      tenantId,
      supplier.credentialsEnc,
    );
    if (!creds?.token)
      throw new Error(`Supplier ${supplier.id} has no credentials configured`);
    return {
      token: creds.token,
      environment:
        supplier.environment === 'PRODUCTION' ? 'production' : 'staging',
    };
  }

  async source(
    tenantId: string,
    supplierId: string,
  ): Promise<ISourceConnector> {
    const supplier = await this.db.supplier.findFirst({
      where: { id: supplierId, tenantId, deletedAt: null },
    });
    if (!supplier) throw new Error(`Supplier ${supplierId} not found`);
    const signature = `${supplier.environment}|${supplier.credentialsEnc ?? ''}`;
    const hit = this.sources.get(supplierId);
    if (hit?.signature === signature) return hit.connector;
    const access = await this.accessOf(tenantId, supplier);
    const connector = new AwAikuConnector({
      token: access.token,
      environment: access.environment,
      sink: new DbRequestLogSink(this.db, tenantId),
    });
    this.sources.set(supplierId, { signature, connector });
    return connector;
  }

  /** A fresh AW connector whose saga progress is forwarded to `onProgress` (not cached: the callback is per call). */
  async sourceWithProgress(
    tenantId: string,
    supplierId: string,
    onProgress: NonNullable<
      ConstructorParameters<typeof AwAikuConnector>[0]['onProgress']
    >,
  ): Promise<AwAikuConnector> {
    const access = await this.supplierAccess(tenantId, supplierId);
    return new AwAikuConnector({
      token: access.token,
      environment: access.environment,
      sink: new DbRequestLogSink(this.db, tenantId),
      onProgress,
    });
  }

  sink(tenantId: string): DbRequestLogSink {
    return new DbRequestLogSink(this.db, tenantId);
  }

  async channel(ref: ChannelRef): Promise<IChannelConnector> {
    const row = await this.db.channel.findFirst({
      where: { id: ref.id, tenantId: ref.tenantId, deletedAt: null },
    });
    if (!row) throw new Error(`Channel ${ref.id} not found`);
    const signature = `${row.code}|${row.credentialsEnc ?? ''}|${JSON.stringify(row.settings ?? {})}`;
    const hit = this.channels.get(ref.id);
    if (hit?.signature === signature) return hit.connector;
    const connector = await this.buildChannel(ref.tenantId, row);
    this.channels.set(ref.id, { signature, connector });
    return connector;
  }

  private async buildChannel(
    tenantId: string,
    row: {
      id: string;
      code: string;
      credentialsEnc: string | null;
      settings: unknown;
    },
  ): Promise<IChannelConnector> {
    const creds = await this.vault.decrypt(tenantId, row.credentialsEnc);
    if (!creds)
      throw new Error(`Channel ${row.id} has no credentials configured`);
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const sink = this.sink(tenantId);
    switch (row.code) {
      case CHANNEL_CODES.PRESTASHOP9: {
        if (!settings.baseUrl)
          throw new Error(`Channel ${row.id} settings.baseUrl is required`);
        const secrets = creds as Ps9Credentials;
        const merged = {
          ...settings,
          ...(secrets.adminApi && {
            adminApi: {
              ...((settings.adminApi as object) ?? {}),
              ...secrets.adminApi,
            },
          }),
          ...(secrets.webservice && {
            webservice: {
              ...((settings.webservice as object) ?? {}),
              ...secrets.webservice,
            },
          }),
        } as unknown as PrestaShop9Settings;
        return new PrestaShop9Connector({
          settings: merged,
          sink,
          knownSkus: async (skus) => {
            const rows = await this.db.product.findMany({
              where: { tenantId, sku: { in: skus }, deletedAt: null },
              select: { sku: true },
            });
            return rows.map((r) => r.sku);
          },
        });
      }
      case CHANNEL_CODES.TEMU_EU: {
        if (!settings.gatewayHost)
          throw new Error(`Channel ${row.id} settings.gatewayHost is required`);
        const t = creds as unknown as TemuCredentialsRecord;
        return new TemuEuConnector({
          gatewayHost: String(settings.gatewayHost),
          appKey: t.appKey,
          appSecret: t.appSecret,
          accessToken: t.accessToken,
          carrierTable: (settings.carrierTable ?? {}) as CarrierTable,
          sink,
        });
      }
      default:
        throw new Error(`Unsupported channel code: ${row.code}`);
    }
  }
}
