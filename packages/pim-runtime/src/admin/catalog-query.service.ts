import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateCategoryRequest,
  MapSupplierPathRequest,
  ProductDetail,
  ProductListItem,
  ProductListQuery,
  SupplierProductDto,
  SupplierProductListQuery,
} from '@repo/shared-types';
import {
  AssortmentItemStatus,
  DatabaseService,
  Prisma,
  SupplierProductStatus,
} from '@repo/database';
import {
  PIM_TOKENS,
  PRODUCT_ATTRIBUTE_KEYS,
  type ObjectStorage,
} from '@repo/pim-catalog';
import {
  dec,
  iso,
  isoOrNull,
  lower,
  orderBy,
  pathKey,
  upper,
} from '../util/mappers';

const SP_SORT = [
  'id',
  'name',
  'code',
  'costPrice',
  'stock',
  'department',
  'lastSeenAt',
  'createdAt',
] as const;
const PRODUCT_SORT = [
  'id',
  'sku',
  'titlePt',
  'status',
  'enrichmentStatus',
  'updatedAt',
  'createdAt',
] as const;

type Page<T> = { items: T[]; total: number };

interface EnrichmentAttributes {
  bulletPoints?: string[];
  seoTitle?: string;
  seoDescription?: string;
  suggestedAttributes?: Record<string, string>;
}

const slugify = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Read models for the back office (supplier catalogue, products, categories, category mapping). Never returns cost data of other tenants. */
@Injectable()
export class CatalogQueryService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---- supplier catalogue ------------------------------------------------------------------------------------

  async listSupplierProducts(
    tenantId: string,
    q: SupplierProductListQuery,
  ): Promise<Page<SupplierProductDto>> {
    const where: Prisma.SupplierProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.department && { department: q.department }),
      ...(q.subDepartment && { subDepartment: q.subDepartment }),
      ...(q.family && { family: q.family }),
      ...(q.status && { status: upper(q.status) as SupplierProductStatus }),
      ...(q.inAssortment !== undefined && {
        assortmentItems: q.inAssortment
          ? { some: { status: AssortmentItemStatus.ACTIVE } }
          : { none: { status: AssortmentItemStatus.ACTIVE } },
      }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { code: { contains: q.search, mode: 'insensitive' } },
          { ean: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.supplierProduct.findMany({
        where,
        skip: q.skip,
        take: q.take,
        orderBy: orderBy(q.sortBy, q.sortOrder, SP_SORT, 'id'),
        include: {
          assortmentItems: {
            where: { status: AssortmentItemStatus.ACTIVE },
            select: { id: true },
          },
          products: { where: { deletedAt: null }, select: { id: true } },
        },
      }),
      this.db.supplierProduct.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        supplierId: r.supplierId,
        externalId: r.externalId,
        code: r.code,
        ean: r.ean,
        name: r.name,
        department: r.department,
        subDepartment: r.subDepartment,
        family: r.family,
        costPrice: dec(r.costPrice),
        currency: r.currency,
        stock: r.stock,
        imageMainUrl: r.imageMainUrl,
        status: lower(r.status),
        inAssortment: r.assortmentItems.length > 0,
        productId: r.products[0]?.id ?? null,
        lastSeenAt: iso(r.lastSeenAt),
      })),
    };
  }

  async supplierFacets(
    tenantId: string,
    q: { supplierId?: string; department?: string; subDepartment?: string },
  ) {
    const base: Prisma.SupplierProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.supplierId && { supplierId: q.supplierId }),
    };
    const distinct = async (
      field: 'department' | 'subDepartment' | 'family',
      where: Prisma.SupplierProductWhereInput,
    ): Promise<string[]> => {
      const rows = await this.db.supplierProduct.findMany({
        where: { ...where, [field]: { not: null } },
        distinct: [field],
        select: { [field]: true },
        orderBy: { [field]: 'asc' },
      });
      return rows
        .map((r) => (r as unknown as Record<string, string | null>)[field])
        .filter((v): v is string => !!v);
    };
    const withDepartment = {
      ...base,
      ...(q.department && { department: q.department }),
    };
    const withSub = {
      ...withDepartment,
      ...(q.subDepartment && { subDepartment: q.subDepartment }),
    };
    const [departments, subDepartments, families] = await Promise.all([
      distinct('department', base),
      distinct('subDepartment', withDepartment),
      distinct('family', withSub),
    ]);
    return { departments, subDepartments, families };
  }

  // ---- products ----------------------------------------------------------------------------------------------

  async listProducts(
    tenantId: string,
    q: ProductListQuery,
  ): Promise<Page<ProductListItem>> {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.status && {
        status: upper(q.status) as Prisma.ProductWhereInput['status'],
      }),
      ...(q.enrichmentStatus && {
        enrichmentStatus: upper(
          q.enrichmentStatus,
        ) as Prisma.ProductWhereInput['enrichmentStatus'],
      }),
      ...(q.channelId && {
        listings: { some: { channelId: q.channelId, deletedAt: null } },
      }),
      ...(q.search && {
        OR: [
          { sku: { contains: q.search, mode: 'insensitive' } },
          { titlePt: { contains: q.search, mode: 'insensitive' } },
          { ean: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.product.findMany({
        where,
        skip: q.skip,
        take: q.take,
        orderBy: orderBy(q.sortBy, q.sortOrder, PRODUCT_SORT, 'id'),
        include: {
          listings: {
            where: { deletedAt: null },
            include: { channel: { select: { code: true } } },
          },
        },
      }),
      this.db.product.count({ where }),
    ]);
    return {
      total,
      items: rows.map((p) => ({
        id: p.id,
        sku: p.sku,
        ean: p.ean,
        titlePt: p.titlePt,
        status: lower(p.status),
        enrichmentStatus: lower(p.enrichmentStatus),
        categoryId: p.categoryId,
        listings: p.listings.map((l) => this.listingSummary(l)),
        updatedAt: iso(p.updatedAt),
      })),
    };
  }

  async productDetail(tenantId: string, id: string): Promise<ProductDetail> {
    const p = await this.db.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        supplierProduct: true,
        media: { orderBy: { position: 'asc' } },
        listings: {
          where: { deletedAt: null },
          include: { channel: { select: { code: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException(`Product ${id} not found`);
    const attributes = (p.attributes ?? {}) as Record<string, unknown>;
    const enrichment = attributes[PRODUCT_ATTRIBUTE_KEYS.ENRICHMENT] as
      EnrichmentAttributes | undefined;
    const sp = p.supplierProduct;
    return {
      id: p.id,
      sku: p.sku,
      ean: p.ean,
      titlePt: p.titlePt,
      shortDescriptionPt: p.shortDescriptionPt,
      descriptionPtHtml: p.descriptionPtHtml,
      brand: p.brand,
      weightG: p.weightG,
      status: lower(p.status),
      enrichmentStatus: lower(p.enrichmentStatus),
      categoryId: p.categoryId,
      attributes,
      compliance: (p.compliance ?? {}) as Record<string, unknown>,
      enrichment: enrichment
        ? {
            bulletPoints: enrichment.bulletPoints ?? [],
            seoTitle: enrichment.seoTitle ?? null,
            seoDescription: enrichment.seoDescription ?? null,
            suggestedAttributes: enrichment.suggestedAttributes ?? {},
          }
        : null,
      supplier: sp
        ? {
            supplierProductId: sp.id,
            name: sp.name,
            department: sp.department,
            subDepartment: sp.subDepartment,
            family: sp.family,
            costPrice: dec(sp.costPrice),
            stock: sp.stock,
            status: lower(sp.status),
          }
        : null,
      media: p.media.map((m) => ({
        id: m.id,
        sourceUrl: m.sourceUrl,
        url: m.storageKey ? this.storage.publicUrl(m.storageKey) : null,
        mime: m.mime,
        position: m.position,
        checksum: m.checksum,
      })),
      listings: p.listings.map((l) => this.listingSummary(l)),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  private listingSummary(l: {
    channelId: string;
    channel: { code: string };
    status: string;
    externalId: string | null;
    lastPrice: { toString(): string } | null;
    lastStock: number | null;
    lastError: string | null;
    lastSyncedAt: Date | null;
  }) {
    return {
      channelId: l.channelId,
      channelCode: l.channel.code,
      status: lower(l.status) as
        'pending' | 'submitted' | 'live' | 'rejected' | 'inactive',
      externalId: l.externalId,
      lastPrice: dec(l.lastPrice),
      lastStock: l.lastStock,
      lastError: l.lastError,
      lastSyncedAt: isoOrNull(l.lastSyncedAt),
    };
  }

  // ---- categories and mapping --------------------------------------------------------------------------------

  async listCategories(tenantId: string) {
    const rows = await this.db.category.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId,
    }));
  }

  async createCategory(tenantId: string, input: CreateCategoryRequest) {
    const slug = slugify(input.name);
    if (!slug)
      throw new ConflictException(
        'Category name must contain letters or digits',
      );
    if (input.parentId) {
      const parent = await this.db.category.findFirst({
        where: { id: input.parentId, tenantId, deletedAt: null },
      });
      if (!parent)
        throw new NotFoundException(
          `Parent category ${input.parentId} not found`,
        );
    }
    // A composite unique with a NULL parent does not enforce root uniqueness in Postgres (see CORNER_CASES).
    const clash = await this.db.category.findFirst({
      where: {
        tenantId,
        parentId: input.parentId ?? null,
        slug,
        deletedAt: null,
      },
    });
    if (clash)
      throw new ConflictException(
        `Category "${input.name}" already exists here`,
      );
    const c = await this.db.category.create({
      data: {
        tenantId,
        name: input.name,
        normalizedName: slug.replace(/-/g, ' '),
        slug,
        parentId: input.parentId ?? null,
      },
    });
    return { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId };
  }

  /** Every distinct supplier path with its current internal category and channel category ids. */
  async supplierPathMappings(tenantId: string) {
    const paths = await this.db.supplierProduct.groupBy({
      by: ['department', 'subDepartment', 'family'],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
      orderBy: [
        { department: 'asc' },
        { subDepartment: 'asc' },
        { family: 'asc' },
      ],
    });
    const mappings = await this.db.categoryMapping.findMany({
      where: { tenantId, supersededAt: null },
    });
    const byKey = new Map<string, typeof mappings>();
    for (const m of mappings)
      byKey.set(m.normalizedKey, [...(byKey.get(m.normalizedKey) ?? []), m]);
    return paths.map((p) => {
      const rows =
        byKey.get(pathKey(p.department, p.subDepartment, p.family)) ?? [];
      return {
        department: p.department,
        subDepartment: p.subDepartment,
        family: p.family,
        productCount: p._count._all,
        categoryId: rows.find((r) => r.channelId === null)?.categoryId ?? null,
        channels: rows
          .filter((r) => r.channelId !== null)
          .map((r) => ({
            channelId: r.channelId as string,
            channelCategoryId: r.channelCategoryId,
          })),
      };
    });
  }

  /** Normalises the request for CategoryMappingService.mapSupplierPath (validates the targets exist). */
  async prepareMapping(tenantId: string, input: MapSupplierPathRequest) {
    const category = await this.db.category.findFirst({
      where: { id: input.categoryId, tenantId, deletedAt: null },
    });
    if (!category)
      throw new NotFoundException(`Category ${input.categoryId} not found`);
    const channelIds = input.channels.map((c) => c.channelId);
    if (channelIds.length) {
      const found = await this.db.channel.findMany({
        where: { id: { in: channelIds }, tenantId, deletedAt: null },
        select: { id: true },
      });
      const missing = channelIds.filter(
        (id) => !found.some((f) => f.id === id),
      );
      if (missing.length)
        throw new NotFoundException(`Channel ${missing[0]} not found`);
    }
    return {
      department: input.department ?? null,
      subDepartment: input.subDepartment ?? null,
      family: input.family ?? null,
      categoryId: input.categoryId,
      channels: input.channels,
    };
  }
}
