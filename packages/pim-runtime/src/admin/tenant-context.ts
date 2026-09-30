import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';

export const TENANT_SLUG_CONFIG = 'PIM_TENANT_SLUG';

/**
 * The POC is single tenant (Gemma): every authenticated admin acts on one tenant. It is `PIM_TENANT_SLUG` when set,
 * otherwise the oldest tenant. Multi-tenant resolution (user -> tenant) replaces this class later.
 */
@Injectable()
export class TenantContext {
  private cached?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async resolve(): Promise<string> {
    if (this.cached) return this.cached;
    const slug = this.config.get<string>(TENANT_SLUG_CONFIG);
    const tenant = await this.db.tenant.findFirst({
      where: { deletedAt: null, ...(slug ? { slug } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant)
      throw new NotFoundException(
        slug ? `Tenant "${slug}" not found` : 'No tenant exists',
      );
    this.cached = tenant.id;
    return tenant.id;
  }
}
