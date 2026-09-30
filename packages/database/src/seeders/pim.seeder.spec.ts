import { PimSeeder, SEED_TENANT_SLUG, SEED_SUPPLIER_CODE } from './pim.seeder';

describe('PimSeeder', () => {
  const build = () => {
    const db = {
      tenant: { upsert: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
      supplier: { upsert: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
    };
    return { db, seeder: new PimSeeder(db as never) };
  };

  it('upserts the gemma tenant by slug', async () => {
    const { db, seeder } = build();
    await seeder.seed();
    expect(db.tenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: SEED_TENANT_SLUG },
        create: expect.objectContaining({ slug: 'gemma' }),
      }),
    );
  });

  it('upserts aw-aiku as a staging supplier without credentials, scoped to the tenant', async () => {
    const { db, seeder } = build();
    await seeder.seed();
    const arg = db.supplier.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      tenantId_code: { tenantId: 'tenant-1', code: SEED_SUPPLIER_CODE },
    });
    expect(arg.create).toMatchObject({
      tenantId: 'tenant-1',
      code: 'aw-aiku',
      environment: 'STAGING',
    });
    expect(arg.create.credentialsEnc).toBeUndefined();
    expect(arg.update.credentialsEnc).toBeUndefined();
  });

  it('is idempotent: running twice only upserts', async () => {
    const { db, seeder } = build();
    await seeder.seed();
    await seeder.seed();
    expect(db.tenant.upsert).toHaveBeenCalledTimes(2);
  });
});
