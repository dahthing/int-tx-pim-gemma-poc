import type { INestApplication } from '@nestjs/common';
import { ROLES_KEY } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { SettingsService } from '@repo/pim-runtime';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { createTestApp, TENANT_ID } from './testing';

const iso = '2026-09-30T10:00:00.000Z';
const SECRETS = [
  'tok-super-secret',
  'app-secret-value',
  'CIPHERTEXT-ENVELOPE',
  'ps-client-secret',
];

/** A deliberately leaky service: returns the raw rows, credential columns included. */
const leakySupplier = {
  id: 's1',
  code: 'aw-aiku',
  name: 'AW',
  environment: 'staging',
  baseUrl: null,
  credentialsConfigured: true,
  updatedAt: iso,
  credentialsEnc: 'CIPHERTEXT-ENVELOPE',
  credentials: { token: 'tok-super-secret' },
  token: 'tok-super-secret',
};
const leakyChannel = {
  id: 'c1',
  code: 'temu-eu',
  name: 'Temu',
  settings: { gatewayHost: 'https://gw' },
  credentialsConfigured: true,
  updatedAt: iso,
  credentialsEnc: 'CIPHERTEXT-ENVELOPE',
  credentials: { appSecret: 'app-secret-value' },
  appSecret: 'app-secret-value',
  clientSecret: 'ps-client-secret',
};

describe('SettingsController (HTTP): credentials are write-only (NFR-03)', () => {
  let app: INestApplication;
  const settings = {
    get: jest.fn(),
    createSupplier: jest.fn(),
    updateSupplier: jest.fn(),
    testSupplier: jest.fn(),
    createChannel: jest.fn(),
    updateChannel: jest.fn(),
    testChannel: jest.fn(),
  };

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: settings }],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const expectNoSecrets = (body: unknown) => {
    const json = JSON.stringify(body);
    for (const s of SECRETS) expect(json).not.toContain(s);
    expect(json).not.toMatch(
      /credentialsEnc|"credentials"|"token"|appSecret|clientSecret/,
    );
  };

  it('GET /settings never serializes credential fields, even from a leaky service', async () => {
    settings.get.mockResolvedValue({
      suppliers: [leakySupplier],
      channels: [leakyChannel],
      tenantDefaults: {
        defaultEmail: null,
        defaultPhone: null,
        minMargin: '0.15',
        vatRate: '0.23',
      },
      credentialsEnc: 'CIPHERTEXT-ENVELOPE',
    });
    const res = await request(app.getHttpServer()).get('/settings').expect(200);
    expectNoSecrets(res.body);
    expect(res.body.suppliers[0]).toEqual({
      id: 's1',
      code: 'aw-aiku',
      name: 'AW',
      environment: 'staging',
      baseUrl: null,
      credentialsConfigured: true,
      updatedAt: iso,
    });
    expect(res.body.channels[0].credentialsConfigured).toBe(true);
  });

  it('accepts credentials on create/update but the response never echoes them', async () => {
    settings.createSupplier.mockResolvedValue(leakySupplier);
    const created = await request(app.getHttpServer())
      .post('/settings/suppliers')
      .send({
        code: 'aw-aiku',
        name: 'AW',
        credentials: { token: 'tok-super-secret' },
      })
      .expect(201);
    expectNoSecrets(created.body);
    expect(settings.createSupplier).toHaveBeenCalledWith(
      TENANT_ID,
      {
        code: 'aw-aiku',
        name: 'AW',
        environment: 'staging',
        credentials: { token: 'tok-super-secret' },
      },
      'admin@gemma.pt',
    );

    settings.updateSupplier.mockResolvedValue(leakySupplier);
    expectNoSecrets(
      (
        await request(app.getHttpServer())
          .patch('/settings/suppliers/s1')
          .send({ credentials: { token: 'tok-super-secret' } })
          .expect(200)
      ).body,
    );

    settings.createChannel.mockResolvedValue(leakyChannel);
    const ch = await request(app.getHttpServer())
      .post('/settings/channels')
      .send({
        code: 'temu-eu',
        credentials: {
          appKey: 'k',
          appSecret: 'app-secret-value',
          accessToken: 't',
        },
      })
      .expect(201);
    expectNoSecrets(ch.body);
    expect(settings.createChannel).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ code: 'temu-eu', settings: {} }),
      'admin@gemma.pt',
    );

    settings.updateChannel.mockResolvedValue(leakyChannel);
    expectNoSecrets(
      (
        await request(app.getHttpServer())
          .patch('/settings/channels/c1')
          .send({ settings: { stockBuffer: 3 } })
          .expect(200)
      ).body,
    );
  });

  it('validates credential shapes on the way in', async () => {
    await request(app.getHttpServer())
      .post('/settings/suppliers')
      .send({ code: 'aw', name: 'AW', credentials: {} })
      .expect(400);
    await request(app.getHttpServer())
      .post('/settings/channels')
      .send({ code: 'prestashop9', credentials: {} })
      .expect(400);
    await request(app.getHttpServer())
      .post('/settings/channels')
      .send({ code: 'nope', credentials: { webservice: { key: 'k' } } })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/settings/suppliers/s1')
      .send({})
      .expect(400);
    expect(settings.createSupplier).not.toHaveBeenCalled();
    expect(settings.createChannel).not.toHaveBeenCalled();
  });

  it('test endpoints return only the connection result', async () => {
    settings.testSupplier.mockResolvedValue({
      ok: false,
      reason: 'invalid_credentials',
      message: 'nope',
      token: 'tok-super-secret',
    });
    const res = await request(app.getHttpServer())
      .post('/settings/suppliers/s1/test')
      .expect(200);
    expect(res.body).toEqual({
      ok: false,
      reason: 'invalid_credentials',
      message: 'nope',
    });
    settings.testChannel.mockResolvedValue({
      ok: true,
      accountName: 'Gemma',
      currency: 'EUR',
    });
    expect(
      (
        await request(app.getHttpServer())
          .post('/settings/channels/c1/test')
          .expect(200)
      ).body,
    ).toEqual({ ok: true, accountName: 'Gemma', currency: 'EUR' });
  });

  it('is restricted to admins', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SettingsController)).toEqual([
      RoleEnum.ADMIN,
    ]);
  });
});
