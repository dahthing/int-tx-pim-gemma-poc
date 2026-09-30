import { AwAikuConnector } from '@repo/connector-aw-aiku';
import { PrestaShop9Connector } from '@repo/connector-prestashop9';
import { TemuEuConnector } from '@repo/connector-temu-eu';
import { PrismaPendingPriceStore } from './prisma-pending-price.store';
import { CredentialVault } from './credential-vault';
import { ConnectorFactory } from './connector-factory';

const key = Buffer.alloc(32, 5);
const vault = new CredentialVault({ getKey: jest.fn().mockResolvedValue(key) });

const ps9Settings = {
  baseUrl: 'https://shop.example',
  taxRulesGroupId: 1,
  languageId: 1,
  paidStateIds: [2],
  shippedStateId: 4,
};

async function build(rows: { supplier?: unknown; channel?: unknown } = {}) {
  const db = {
    supplier: { findFirst: jest.fn().mockResolvedValue(rows.supplier ?? null) },
    channel: { findFirst: jest.fn().mockResolvedValue(rows.channel ?? null) },
    product: { findMany: jest.fn().mockResolvedValue([{ sku: 'A' }]) },
    integrationRequestLog: { create: jest.fn() },
  };
  return { db, factory: new ConnectorFactory(db as never, vault) };
}

describe('ConnectorFactory', () => {
  it('builds the AW connector from the decrypted supplier token and environment', async () => {
    const credentialsEnc = await vault.encrypt('t', { token: 'aw-token' });
    const { factory, db } = await build({
      supplier: {
        id: 's',
        tenantId: 't',
        environment: 'PRODUCTION',
        credentialsEnc,
      },
    });
    const c = await factory.source('t', 's');
    expect(c).toBeInstanceOf(AwAikuConnector);
    expect(db.supplier.findFirst).toHaveBeenCalledWith({
      where: { id: 's', tenantId: 't', deletedAt: null },
    });
  });

  it('caches the connector per supplier until the credentials change', async () => {
    const credentialsEnc = await vault.encrypt('t', { token: 'aw-token' });
    const { factory, db } = await build({
      supplier: {
        id: 's',
        tenantId: 't',
        environment: 'STAGING',
        credentialsEnc,
      },
    });
    const a = await factory.source('t', 's');
    expect(await factory.source('t', 's')).toBe(a);
    db.supplier.findFirst.mockResolvedValue({
      id: 's',
      tenantId: 't',
      environment: 'STAGING',
      credentialsEnc: await vault.encrypt('t', { token: 'new' }),
    });
    expect(await factory.source('t', 's')).not.toBe(a);
  });

  it('exposes supplier credentials for the gateway', async () => {
    const credentialsEnc = await vault.encrypt('t', { token: 'aw-token' });
    const { factory } = await build({
      supplier: {
        id: 's',
        tenantId: 't',
        environment: 'STAGING',
        credentialsEnc,
      },
    });
    await expect(factory.supplierAccess('t', 's')).resolves.toEqual({
      token: 'aw-token',
      environment: 'staging',
    });
  });

  it('rejects unknown suppliers and suppliers without credentials', async () => {
    await expect((await build()).factory.source('t', 'x')).rejects.toThrow(
      /not found/,
    );
    const { factory } = await build({
      supplier: {
        id: 's',
        tenantId: 't',
        environment: 'STAGING',
        credentialsEnc: null,
      },
    });
    await expect(factory.source('t', 's')).rejects.toThrow(/credentials/);
  });

  it('builds a PrestaShop9 connector merging secrets into the public settings', async () => {
    const credentialsEnc = await vault.encrypt('t', {
      adminApi: { clientId: 'id', clientSecret: 'sec' },
      webservice: { key: 'k' },
    });
    const { factory, db } = await build({
      channel: {
        id: 'c',
        code: 'prestashop9',
        credentialsEnc,
        settings: ps9Settings,
      },
    });
    const c = await factory.channel({
      id: 'c',
      tenantId: 't',
      code: 'prestashop9',
      settings: ps9Settings,
    });
    expect(c).toBeInstanceOf(PrestaShop9Connector);
    expect(db.channel.findFirst).toHaveBeenCalledWith({
      where: { id: 'c', tenantId: 't', deletedAt: null },
    });
  });

  it('wires the known-sku lookup of the PrestaShop connector to the product table', async () => {
    const credentialsEnc = await vault.encrypt('t', {
      adminApi: { clientId: 'id', clientSecret: 'sec' },
      webservice: { key: 'k' },
    });
    const { factory, db } = await build({
      channel: {
        id: 'c',
        code: 'prestashop9',
        credentialsEnc,
        settings: ps9Settings,
      },
    });
    const c = (await factory.channel({
      id: 'c',
      tenantId: 't',
      code: 'prestashop9',
      settings: ps9Settings,
    })) as unknown as {
      o: { knownSkus: (s: string[]) => Promise<Iterable<string>> };
    };
    expect([...(await c.o.knownSkus(['A', 'B']))]).toEqual(['A']);
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't', sku: { in: ['A', 'B'] }, deletedAt: null },
      select: { sku: true },
    });
  });

  it('builds a Temu connector from credentials and gateway settings', async () => {
    const settings = {
      gatewayHost: 'https://gw.example',
      carrierTable: { DHL: { id: 1, name: 'DHL' } },
    };
    const credentialsEnc = await vault.encrypt('t', {
      appKey: 'k',
      appSecret: 's',
      accessToken: 'a',
    });
    const { factory } = await build({
      channel: { id: 'c', code: 'temu-eu', credentialsEnc, settings },
    });
    expect(
      await factory.channel({
        id: 'c',
        tenantId: 't',
        code: 'temu-eu',
        settings,
      }),
    ).toBeInstanceOf(TemuEuConnector);
  });

  it('backs the Temu connector with the database pending-price store (FR-TEMU-002 AC3)', async () => {
    const settings = { gatewayHost: 'https://gw.example', carrierTable: {} };
    const credentialsEnc = await vault.encrypt('t', { appKey: 'k', appSecret: 's', accessToken: 'a' });
    const { factory } = await build({ channel: { id: 'c', code: 'temu-eu', credentialsEnc, settings } });
    const c = (await factory.channel({ id: 'c', tenantId: 't', code: 'temu-eu', settings })) as unknown as {
      cfg: { pendingPrices: unknown };
    };
    expect(c.cfg.pendingPrices).toBeInstanceOf(PrismaPendingPriceStore);
  });

  it('makes the PrestaShop poll also return cancelled and delivered orders so status changes are seen', async () => {
    const credentialsEnc = await vault.encrypt('t', { adminApi: { clientId: 'id', clientSecret: 'sec' }, webservice: { key: 'k' } });
    const read = async (settings: Record<string, unknown>) => {
      const { factory } = await build({ channel: { id: 'c', code: 'prestashop9', credentialsEnc, settings } });
      const c = (await factory.channel({ id: 'c', tenantId: 't', code: 'prestashop9', settings })) as unknown as {
        o: { settings: { paidStateIds: number[] } };
      };
      return c.o.settings.paidStateIds;
    };
    expect(await read(ps9Settings)).toEqual([2, 6, 5]);
    expect(await read({ ...ps9Settings, cancelledStatuses: [7], deliveredStatuses: ['8', 2] })).toEqual([2, 7, 8]);
  });

  it('rejects incomplete channel configuration and unsupported codes', async () => {
    const enc = await vault.encrypt('t', {
      appKey: 'k',
      appSecret: 's',
      accessToken: 'a',
    });
    let { factory } = await build({
      channel: { id: 'c', code: 'temu-eu', credentialsEnc: enc, settings: {} },
    });
    await expect(
      factory.channel({
        id: 'c',
        tenantId: 't',
        code: 'temu-eu',
        settings: {},
      }),
    ).rejects.toThrow(/gatewayHost/);
    ({ factory } = await build({
      channel: {
        id: 'c',
        code: 'prestashop9',
        credentialsEnc: enc,
        settings: {},
      },
    }));
    await expect(
      factory.channel({
        id: 'c',
        tenantId: 't',
        code: 'prestashop9',
        settings: {},
      }),
    ).rejects.toThrow(/baseUrl/);
    ({ factory } = await build({
      channel: { id: 'c', code: 'nope', credentialsEnc: enc, settings: {} },
    }));
    await expect(
      factory.channel({ id: 'c', tenantId: 't', code: 'nope', settings: {} }),
    ).rejects.toThrow(/Unsupported channel/);
    ({ factory } = await build({
      channel: { id: 'c', code: 'temu-eu', credentialsEnc: null, settings: {} },
    }));
    await expect(
      factory.channel({
        id: 'c',
        tenantId: 't',
        code: 'temu-eu',
        settings: {},
      }),
    ).rejects.toThrow(/credentials/);
    ({ factory } = await build());
    await expect(
      factory.channel({
        id: 'c',
        tenantId: 't',
        code: 'temu-eu',
        settings: {},
      }),
    ).rejects.toThrow(/not found/);
  });
});
