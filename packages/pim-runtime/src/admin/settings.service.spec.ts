import { CredentialVault } from '../adapters/credential-vault';
import { createMockDb } from '../testing/mock-db';
import { SettingsService } from './settings.service';

const d = new Date('2026-04-01T00:00:00Z');
const key = Buffer.alloc(32, 4);
const vault = new CredentialVault({ getKey: jest.fn().mockResolvedValue(key) });

function setup(config: Record<string, string> = {}) {
  const { db, mock } = createMockDb();
  const factory = { source: jest.fn(), channel: jest.fn() };
  const cfg = { get: jest.fn((k: string) => config[k]) };
  return {
    mock,
    factory,
    svc: new SettingsService(db, vault, factory as never, cfg as never),
  };
}
const supplierRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  tenantId: 't',
  code: 'aw-aiku',
  name: 'AW',
  environment: 'STAGING',
  baseUrl: null,
  credentialsEnc: 'CIPHER',
  createdAt: d,
  updatedAt: d,
  deletedAt: null,
  ...over,
});
const channelRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  tenantId: 't',
  code: 'temu-eu',
  name: 'Temu',
  settings: { gatewayHost: 'https://gw' },
  credentialsEnc: 'CIPHER',
  scopeId: null,
  createdAt: d,
  updatedAt: d,
  deletedAt: null,
  ...over,
});
const auditDiffs = (mock: { auditEvent: { create: jest.Mock } }) =>
  mock.auditEvent.create.mock.calls.map((c) => c[0].data);

describe('SettingsService.get', () => {
  it('lists configuration without any credential material', async () => {
    const { svc, mock } = setup({
      PIM_ORDER_DEFAULT_EMAIL: 'a@b.pt',
      PIM_ORDER_DEFAULT_PHONE: '+351',
    });
    mock.supplier.findMany.mockResolvedValue([
      supplierRow(),
      supplierRow({ id: 's2', credentialsEnc: null }),
    ]);
    mock.channel.findMany.mockResolvedValue([
      channelRow({
        settings: {
          gatewayHost: 'x',
          adminApi: { clientSecret: 'leaked-secret' },
        },
      }),
    ]);
    const r = await svc.get('t');
    const json = JSON.stringify(r);
    expect(json).not.toContain('CIPHER');
    expect(json).not.toContain('credentialsEnc');
    expect(json).not.toContain('leaked-secret');
    expect(r.suppliers.map((s) => s.credentialsConfigured)).toEqual([
      true,
      false,
    ]);
    expect(r.channels[0]).toMatchObject({
      credentialsConfigured: true,
      settings: { gatewayHost: 'x', adminApi: { clientSecret: '[REDACTED]' } },
    });
    expect(r.tenantDefaults).toEqual({
      defaultEmail: 'a@b.pt',
      defaultPhone: '+351',
      minMargin: '0.15',
      vatRate: '0.23',
    });
  });

  it('reports unset defaults as null and honours configured margin/vat', async () => {
    const { svc, mock } = setup({
      PIM_ORDER_MIN_MARGIN: '0.2',
      PIM_ORDER_VAT_RATE: '0.21',
    });
    mock.supplier.findMany.mockResolvedValue([]);
    mock.channel.findMany.mockResolvedValue([]);
    expect((await svc.get('t')).tenantDefaults).toEqual({
      defaultEmail: null,
      defaultPhone: null,
      minMargin: '0.2',
      vatRate: '0.21',
    });
  });
});

describe('SettingsService suppliers', () => {
  it('creates a supplier storing the credentials encrypted and auditing field names only', async () => {
    const { svc, mock } = setup();
    mock.supplier.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        supplierRow({ ...data, id: 'new' }),
    );
    const r = await svc.createSupplier(
      't',
      {
        code: 'aw-aiku',
        name: 'AW',
        environment: 'production',
        baseUrl: null,
        credentials: { token: 'super-secret-token' },
      },
      'admin@x',
    );
    const data = mock.supplier.create.mock.calls[0][0].data;
    expect(data.environment).toBe('PRODUCTION');
    expect(data.credentialsEnc).not.toContain('super-secret-token');
    await expect(vault.decrypt('t', data.credentialsEnc)).resolves.toEqual({
      token: 'super-secret-token',
    });
    expect(JSON.stringify(r)).not.toContain('super-secret-token');
    expect(JSON.stringify(r)).not.toContain(data.credentialsEnc);
    expect(auditDiffs(mock)).toEqual([
      {
        tenantId: 't',
        actor: 'admin@x',
        entity: 'Settings',
        entityId: 'new',
        action: 'credentials.updated',
        diff: { target: 'supplier', fields: ['token'] },
      },
    ]);
    expect(JSON.stringify(auditDiffs(mock))).not.toContain(
      'super-secret-token',
    );
  });

  it('rejects a duplicate supplier code', async () => {
    const { svc, mock } = setup();
    mock.supplier.findFirst.mockResolvedValue({ id: 'x' });
    await expect(
      svc.createSupplier(
        't',
        {
          code: 'aw-aiku',
          name: 'AW',
          environment: 'staging',
          credentials: { token: 't' },
        },
        'a',
      ),
    ).rejects.toThrow(/already exists/);
  });

  it('updates fields and re-encrypts credentials only when provided', async () => {
    const { svc, mock } = setup();
    mock.supplier.findFirst.mockResolvedValue(supplierRow());
    mock.supplier.update.mockResolvedValue(supplierRow({ name: 'New' }));
    await svc.updateSupplier(
      't',
      's1',
      { name: 'New', environment: 'production', baseUrl: 'https://x.test' },
      'a',
    );
    expect(mock.supplier.update).toHaveBeenLastCalledWith({
      where: { id: 's1' },
      data: {
        name: 'New',
        environment: 'PRODUCTION',
        baseUrl: 'https://x.test',
      },
    });
    expect(mock.auditEvent.create).not.toHaveBeenCalled();
    await svc.updateSupplier(
      't',
      's1',
      { credentials: { token: 'rotated' } },
      'a',
    );
    const data = mock.supplier.update.mock.calls[1][0].data;
    await expect(vault.decrypt('t', data.credentialsEnc)).resolves.toEqual({
      token: 'rotated',
    });
    expect(auditDiffs(mock)[0].diff).toEqual({
      target: 'supplier',
      fields: ['token'],
    });
  });

  it('404s an unknown supplier', async () => {
    const { svc, mock } = setup();
    mock.supplier.findFirst.mockResolvedValue(null);
    await expect(
      svc.updateSupplier('t', 'x', { name: 'n' }, 'a'),
    ).rejects.toThrow(/Supplier x/);
    await expect(svc.testSupplier('t', 'x')).rejects.toThrow(/Supplier x/);
  });

  it('tests the connection and never throws the raw error', async () => {
    const { svc, mock, factory } = setup();
    mock.supplier.findFirst.mockResolvedValue(supplierRow());
    factory.source.mockResolvedValue({
      testConnection: jest
        .fn()
        .mockResolvedValue({ ok: true, accountName: 'Gemma', currency: 'EUR' }),
    });
    expect(await svc.testSupplier('t', 's1')).toEqual({
      ok: true,
      accountName: 'Gemma',
      currency: 'EUR',
    });
    factory.source.mockResolvedValue({
      testConnection: jest
        .fn()
        .mockResolvedValue({
          ok: false,
          reason: 'invalid_credentials',
          message: 'nope',
        }),
    });
    expect(await svc.testSupplier('t', 's1')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
      message: 'nope',
    });
    factory.source.mockRejectedValue(
      new Error('Supplier s1 has no credentials configured token=abc123'),
    );
    const r = await svc.testSupplier('t', 's1');
    expect(r).toMatchObject({ ok: false, reason: 'unknown' });
    expect(JSON.stringify(r)).not.toContain('abc123');
  });
});

describe('SettingsService channels', () => {
  const temu = { appKey: 'k', appSecret: 'super-secret', accessToken: 'tok' };

  it('creates a channel validating credentials per channel code and encrypting them', async () => {
    const { svc, mock } = setup();
    mock.channel.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        channelRow({ ...data, id: 'new' }),
    );
    const r = await svc.createChannel(
      't',
      {
        code: 'temu-eu',
        name: 'Temu',
        settings: { gatewayHost: 'https://gw' },
        credentials: temu,
      },
      'admin',
    );
    const data = mock.channel.create.mock.calls[0][0].data;
    expect(data.credentialsEnc).not.toContain('super-secret');
    await expect(vault.decrypt('t', data.credentialsEnc)).resolves.toEqual(
      temu,
    );
    expect(JSON.stringify(r)).not.toContain('super-secret');
    expect(auditDiffs(mock)[0].diff).toEqual({
      target: 'channel',
      fields: ['appKey', 'appSecret', 'accessToken'],
    });
  });

  it('rejects credentials of the wrong shape for the channel', async () => {
    const { svc } = setup();
    await expect(
      svc.createChannel(
        't',
        {
          code: 'temu-eu',
          settings: {},
          credentials: { webservice: { key: 'k' } },
        },
        'a',
      ),
    ).rejects.toThrow(/Invalid temu-eu credentials/);
    await expect(
      svc.createChannel(
        't',
        { code: 'prestashop9', settings: {}, credentials: temu },
        'a',
      ),
    ).rejects.toThrow(/Invalid prestashop9 credentials/);
  });

  it('rejects unsupported codes defensively', async () => {
    const { svc } = setup();
    await expect(
      svc.createChannel(
        't',
        { code: 'shopify' as never, settings: {}, credentials: temu },
        'a',
      ),
    ).rejects.toThrow(/Unsupported channel/);
  });

  it('rejects a duplicate channel and secrets smuggled into settings', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue({ id: 'x' });
    await expect(
      svc.createChannel(
        't',
        { code: 'temu-eu', settings: {}, credentials: temu },
        'a',
      ),
    ).rejects.toThrow(/already exists/);
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(
      svc.createChannel(
        't',
        {
          code: 'temu-eu',
          settings: { adminApi: { clientSecret: 'x' } },
          credentials: temu,
        },
        'a',
      ),
    ).rejects.toThrow(/settings.adminApi.clientSecret looks like a secret/);
  });

  it('allows token endpoint URLs and plain configuration in settings', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(null);
    mock.channel.create.mockResolvedValue(channelRow());
    await expect(
      svc.createChannel(
        't',
        {
          code: 'temu-eu',
          settings: {
            tokenUrl: 'https://x/oauth',
            carrierTable: { DHL: { id: 1 } },
            stockBuffer: 5,
            list: [1, { a: 'b' }],
          },
          credentials: temu,
        },
        'a',
      ),
    ).resolves.toBeDefined();
  });

  it('updates name / settings / credentials independently', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(channelRow());
    mock.channel.update.mockResolvedValue(channelRow());
    await svc.updateChannel(
      't',
      'c1',
      { name: 'N', settings: { stockBuffer: 3 } },
      'a',
    );
    expect(mock.channel.update).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { name: 'N', settings: { stockBuffer: 3 } },
    });
    expect(mock.auditEvent.create).not.toHaveBeenCalled();
    await svc.updateChannel('t', 'c1', { credentials: temu }, 'a');
    const data = mock.channel.update.mock.calls[1][0].data;
    await expect(vault.decrypt('t', data.credentialsEnc)).resolves.toEqual(
      temu,
    );
    await expect(
      svc.updateChannel('t', 'c1', { settings: { appSecret: 'x' } }, 'a'),
    ).rejects.toThrow(/secret/);
    await expect(
      svc.updateChannel(
        't',
        'c1',
        { credentials: { webservice: { key: 'k' } } },
        'a',
      ),
    ).rejects.toThrow(/Invalid temu-eu/);
  });

  it('404s an unknown channel', async () => {
    const { svc, mock } = setup();
    mock.channel.findFirst.mockResolvedValue(null);
    await expect(
      svc.updateChannel('t', 'x', { name: 'n' }, 'a'),
    ).rejects.toThrow(/Channel x/);
    await expect(svc.testChannel('t', 'x')).rejects.toThrow(/Channel x/);
  });

  it('tests a channel connection', async () => {
    const { svc, mock, factory } = setup();
    mock.channel.findFirst.mockResolvedValue(channelRow());
    factory.channel.mockResolvedValue({
      testConnection: jest
        .fn()
        .mockResolvedValue({
          ok: false,
          reason: 'unreachable',
          message: 'down',
        }),
    });
    expect(await svc.testChannel('t', 'c1')).toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'down',
    });
    expect(factory.channel).toHaveBeenCalledWith({
      id: 'c1',
      tenantId: 't',
      code: 'temu-eu',
      settings: { gatewayHost: 'https://gw' },
    });
    factory.channel.mockRejectedValue(new Error('boom'));
    expect(await svc.testChannel('t', 'c1')).toMatchObject({
      ok: false,
      reason: 'unknown',
    });
  });
});
