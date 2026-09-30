import { NotFoundException, type INestApplication } from '@nestjs/common';
import { ROLES_KEY } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { SyncTriggerService } from '@repo/pim-runtime';
import request from 'supertest';
import { createTestApp, TENANT_ID } from './testing';
import { TriggersController } from './triggers.controller';

describe('TriggersController (admin manual triggers for the scheduled polls)', () => {
  let app: INestApplication;
  const sync = {
    triggerOrderImport: jest.fn(),
    triggerSupplierOrderStatusPoll: jest.fn(),
    triggerListingReviewPoll: jest.fn(),
  };

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [TriggersController],
      providers: [{ provide: SyncTriggerService, useValue: sync }],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => Object.values(sync).forEach((m) => m.mockReset()));

  it('is admin only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TriggersController)).toEqual([
      RoleEnum.ADMIN,
    ]);
  });

  it('POST /orders/import queues an order import, optionally for one channel (202)', async () => {
    sync.triggerOrderImport.mockResolvedValue({
      enqueued: true,
      kind: 'order-import',
      channelIds: ['c1'],
    });
    const res = await request(app.getHttpServer())
      .post('/orders/import')
      .send({ channelId: 'c1' })
      .expect(202);
    expect(res.body).toEqual({
      enqueued: true,
      kind: 'order-import',
      channelIds: ['c1'],
    });
    expect(sync.triggerOrderImport).toHaveBeenCalledWith(TENANT_ID, 'c1');

    await request(app.getHttpServer())
      .post('/orders/import')
      .send({})
      .expect(202);
    expect(sync.triggerOrderImport).toHaveBeenLastCalledWith(
      TENANT_ID,
      undefined,
    );
  });

  it('POST /orders/supplier-status/poll queues the supplier order status poll (202)', async () => {
    sync.triggerSupplierOrderStatusPoll.mockResolvedValue({
      enqueued: true,
      kind: 'supplier-order-status',
    });
    const res = await request(app.getHttpServer())
      .post('/orders/supplier-status/poll')
      .send({})
      .expect(202);
    expect(res.body).toEqual({ enqueued: true, kind: 'supplier-order-status' });
    expect(sync.triggerSupplierOrderStatusPoll).toHaveBeenCalledWith(TENANT_ID);
  });

  it('POST /listings/reviews/poll queues Temu listing review polls (202)', async () => {
    sync.triggerListingReviewPoll.mockResolvedValue({
      enqueued: true,
      kind: 'listing-review',
      channelIds: ['t1'],
    });
    const res = await request(app.getHttpServer())
      .post('/listings/reviews/poll')
      .send({ channelId: 't1' })
      .expect(202);
    expect(res.body.channelIds).toEqual(['t1']);
    expect(sync.triggerListingReviewPoll).toHaveBeenCalledWith(TENANT_ID, 't1');
  });

  it('rejects an empty channelId (validation) and surfaces an unknown channel as 404', async () => {
    await request(app.getHttpServer())
      .post('/orders/import')
      .send({ channelId: '' })
      .expect(400);
    sync.triggerOrderImport.mockRejectedValue(
      new NotFoundException('Channel zz not found'),
    );
    await request(app.getHttpServer())
      .post('/orders/import')
      .send({ channelId: 'zz' })
      .expect(404);
  });
});
