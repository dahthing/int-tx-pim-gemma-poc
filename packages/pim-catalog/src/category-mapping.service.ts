import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, Prisma } from '@repo/database';
import { CHANNEL_SETTING_KEYS, MISSING_TYPES } from './constants';
import { normalizedKey } from './util/text';

export interface ChannelCategoryTarget {
  channelId: string;
  channelCategoryId: string;
}

export interface MapSupplierPathInput {
  department?: string | null;
  subDepartment?: string | null;
  family?: string | null;
  categoryId: string;
  channels?: ChannelCategoryTarget[];
}

export interface MissingItem {
  type: (typeof MISSING_TYPES)[keyof typeof MISSING_TYPES];
  name: string;
}

export interface PublishReadiness {
  ready: boolean;
  missing: MissingItem[];
}

type Settings = Record<string, unknown>;

@Injectable()
export class CategoryMappingService {
  constructor(private readonly db: DatabaseService) {}

  async mapSupplierPath(tenantId: string, input: MapSupplierPathInput): Promise<void> {
    const key = normalizedKey(input.department, input.subDepartment, input.family);
    await this.db.categoryMapping.updateMany({
      where: { tenantId, normalizedKey: key, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const base = {
      tenantId,
      categoryId: input.categoryId,
      normalizedKey: key,
      supplierDepartment: input.department ?? null,
      supplierSubDepartment: input.subDepartment ?? null,
      supplierFamily: input.family ?? null,
    };
    await this.db.categoryMapping.create({ data: { ...base, channelId: null } });
    for (const ch of input.channels ?? []) {
      await this.db.categoryMapping.create({ data: { ...base, channelId: ch.channelId, channelCategoryId: ch.channelCategoryId } });
    }
  }

  async resolveCategoryId(tenantId: string, department?: string | null, sub?: string | null, family?: string | null): Promise<string | null> {
    const m = await this.db.categoryMapping.findFirst({
      where: { tenantId, normalizedKey: normalizedKey(department, sub, family), channelId: null, supersededAt: null },
    });
    return m?.categoryId ?? null;
  }

  /** Stores which attributes are mandatory for a channel category (e.g. loaded from Temu getCategoryAttributes). */
  async setMandatoryAttributes(tenantId: string, channelId: string, channelCategoryId: string, names: string[]): Promise<void> {
    const channel = await this.db.channel.findFirst({ where: { id: channelId, tenantId, deletedAt: null } });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);
    const settings = (channel.settings ?? {}) as Settings;
    const existing = (settings[CHANNEL_SETTING_KEYS.CATEGORY_ATTRIBUTES] ?? {}) as Record<string, string[]>;
    const next: Settings = { ...settings, [CHANNEL_SETTING_KEYS.CATEGORY_ATTRIBUTES]: { ...existing, [channelCategoryId]: names } };
    await this.db.channel.update({ where: { id: channelId }, data: { settings: next as Prisma.InputJsonValue } });
  }

  /** FR-CAT-001 AC3: lists everything that prevents publishing the product to the channel. */
  async validatePublishReadiness(tenantId: string, productId: string, channelId: string): Promise<PublishReadiness> {
    const product = await this.db.product.findFirst({ where: { id: productId, tenantId, deletedAt: null } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const channel = await this.db.channel.findFirst({ where: { id: channelId, tenantId, deletedAt: null } });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);

    const missing: MissingItem[] = [];
    if (!product.categoryId) {
      missing.push({ type: MISSING_TYPES.CATEGORY, name: MISSING_TYPES.CATEGORY });
    } else {
      const mapping = await this.db.categoryMapping.findFirst({
        where: { tenantId, categoryId: product.categoryId, channelId, supersededAt: null, channelCategoryId: { not: null } },
      });
      if (!mapping?.channelCategoryId) {
        missing.push({ type: MISSING_TYPES.CATEGORY_MAPPING, name: channel.code });
      } else {
        const all = ((channel.settings ?? {}) as Settings)[CHANNEL_SETTING_KEYS.CATEGORY_ATTRIBUTES] as Record<string, string[]> | undefined;
        const attrs = (product.attributes ?? {}) as Record<string, unknown>;
        for (const name of all?.[mapping.channelCategoryId] ?? []) {
          const v = attrs[name];
          if (v === undefined || v === null || v === '') missing.push({ type: MISSING_TYPES.MANDATORY_ATTRIBUTE, name });
        }
      }
    }
    return { ready: missing.length === 0, missing };
  }

  async assertPublishable(tenantId: string, productId: string, channelId: string): Promise<void> {
    const r = await this.validatePublishReadiness(tenantId, productId, channelId);
    if (!r.ready) {
      throw new BadRequestException({ message: 'Product is not ready to publish', missing: r.missing });
    }
  }
}
