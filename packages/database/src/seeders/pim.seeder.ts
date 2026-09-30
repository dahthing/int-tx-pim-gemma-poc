import { DatabaseSeeder } from './database-seeder.interface';
import type { DatabaseService } from '../database.service';

export const SEED_TENANT_SLUG = 'gemma';
export const SEED_SUPPLIER_CODE = 'aw-aiku';

/** Idempotent bootstrap: tenant #1 (Gemma) and the AW/Aiku supplier (staging, no credentials). */
export class PimSeeder implements DatabaseSeeder {
  constructor(private readonly db: DatabaseService) {}

  async seed(): Promise<void> {
    const tenant = await this.db.tenant.upsert({
      where: { slug: SEED_TENANT_SLUG },
      create: { slug: SEED_TENANT_SLUG, name: 'Gemma' },
      update: {},
    });

    await this.db.supplier.upsert({
      where: {
        tenantId_code: { tenantId: tenant.id, code: SEED_SUPPLIER_CODE },
      },
      create: {
        tenantId: tenant.id,
        code: SEED_SUPPLIER_CODE,
        name: 'AW / Aiku',
        environment: 'STAGING',
      },
      update: {},
    });
  }
}
