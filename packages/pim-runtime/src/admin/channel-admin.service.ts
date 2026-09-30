import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, Prisma, ProductStatus } from '@repo/database';
import { CategoryMappingService } from '@repo/pim-catalog';
import {
  ListingSyncService,
  PIM_ORDERS_TOKENS,
  type ChannelConnectorResolver,
  type ChannelRef,
} from '@repo/pim-orders';

const ACTIVE_LISTING_STATES = ['PENDING', 'SUBMITTED', 'LIVE'] as const;

/** Channel-facing back office operations: publish / unpublish a product, channel category tree and attributes. */
@Injectable()
export class ChannelAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly listings: ListingSyncService,
    private readonly categoryMapping: CategoryMappingService,
    @Inject(PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER)
    private readonly connectors: ChannelConnectorResolver,
  ) {}

  /**
   * Publishes (or updates) a product on a channel. The product must be PUBLISHED for stock to be offered, so it is moved
   * first and restored when the publish fails and the product has no other live listing.
   */
  async publish(tenantId: string, productId: string, channelId: string) {
    const product = await this.db.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    if (product.status === ProductStatus.ARCHIVED)
      throw new BadRequestException('An archived product cannot be published');
    const previous = product.status;
    if (previous !== ProductStatus.PUBLISHED) {
      await this.db.product.update({
        where: { id: productId },
        data: { status: ProductStatus.PUBLISHED },
      });
    }
    try {
      const r = await this.listings.publishListing(
        tenantId,
        productId,
        channelId,
      );
      return {
        status: r.status.toLowerCase() as Lowercase<typeof r.status>,
        externalId: r.externalId,
        skipped: r.skipped,
      };
    } catch (e) {
      if (previous !== ProductStatus.PUBLISHED)
        await this.db.product.update({
          where: { id: productId },
          data: { status: previous },
        });
      throw e;
    }
  }

  async unpublish(tenantId: string, productId: string, channelId: string) {
    const listing = await this.db.channelListing.findFirst({
      where: { tenantId, productId, channelId, deletedAt: null },
      include: { channel: true },
    });
    if (!listing)
      throw new NotFoundException(
        `Product ${productId} has no listing on channel ${channelId}`,
      );
    if (listing.externalId) {
      const connector = await this.connectors.resolve(
        this.ref(tenantId, listing.channel),
      );
      await connector.deactivateListing(listing.externalId);
    }
    await this.db.channelListing.update({
      where: { id: listing.id },
      data: {
        status: 'INACTIVE',
        lastStock: 0,
        lastError: null,
        lastSyncedAt: new Date(),
      },
    });
    const stillActive = await this.db.channelListing.count({
      where: {
        tenantId,
        productId,
        deletedAt: null,
        status: { in: [...ACTIVE_LISTING_STATES] },
      },
    });
    if (stillActive === 0) {
      await this.db.product.updateMany({
        where: { id: productId, tenantId, status: ProductStatus.PUBLISHED },
        data: { status: ProductStatus.READY },
      });
    }
    return { status: 'inactive' as const };
  }

  async categoryTree(tenantId: string, channelId: string) {
    const connector = await this.connector(tenantId, channelId);
    if (!connector.getCategoryTree)
      throw new BadRequestException(
        'This channel does not expose a category tree',
      );
    return (await connector.getCategoryTree()).map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      leaf: c.leaf,
    }));
  }

  /** FR-CAT-001 AC2: loads the category's attributes and stores which are mandatory for the publish validation. */
  async loadAttributes(
    tenantId: string,
    channelId: string,
    channelCategoryId: string,
  ) {
    const connector = await this.connector(tenantId, channelId);
    if (!connector.getCategoryAttributes)
      throw new BadRequestException(
        'This channel does not expose category attributes',
      );
    const specs = await connector.getCategoryAttributes(channelCategoryId);
    const mandatory = specs.filter((s) => s.mandatory).map((s) => s.name);
    await this.categoryMapping.setMandatoryAttributes(
      tenantId,
      channelId,
      channelCategoryId,
      mandatory,
    );
    return { items: specs, mandatory };
  }

  private async connector(tenantId: string, channelId: string) {
    const channel = await this.db.channel.findFirst({
      where: { id: channelId, tenantId, deletedAt: null },
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} not found`);
    return this.connectors.resolve(this.ref(tenantId, channel));
  }

  private ref(
    tenantId: string,
    channel: { id: string; code: string; settings: Prisma.JsonValue },
  ): ChannelRef {
    return {
      id: channel.id,
      tenantId,
      code: channel.code,
      settings: channel.settings,
    };
  }
}
