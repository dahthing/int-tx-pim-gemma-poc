-- CreateEnum
CREATE TYPE "SupplierEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "SupplierProductStatus" AS ENUM ('ACTIVE', 'MISSING');

-- CreateEnum
CREATE TYPE "AssortmentItemStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('NONE', 'AI_DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "PriceRounding" AS ENUM ('X99', 'X90', 'NONE');

-- CreateEnum
CREATE TYPE "ChannelListingStatus" AS ENUM ('PENDING', 'SUBMITTED', 'LIVE', 'REJECTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrderInternalStatus" AS ENUM ('IMPORTED', 'ROUTING', 'SUPPLIER_SUBMITTED', 'SUPPLIER_DISPATCHED', 'TRACKING_PUSHED', 'COMPLETED', 'MANUAL_REVIEW', 'SUPPLIER_FAILED', 'TRACKING_MISSING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierOrderState" AS ENUM ('CREATING', 'SUBMITTED', 'DISPATCHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentSource" AS ENUM ('SUPPLIER_API', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentialsEnc" TEXT,
    "environment" "SupplierEnvironment" NOT NULL DEFAULT 'STAGING',
    "baseUrl" TEXT,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_product" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT,
    "slug" TEXT,
    "ean" TEXT,
    "name" TEXT NOT NULL,
    "descriptionRaw" TEXT,
    "department" TEXT,
    "subDepartment" TEXT,
    "family" TEXT,
    "costPrice" DECIMAL(12,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "grossWeightG" INTEGER,
    "imageMainUrl" TEXT,
    "rawPayload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SupplierProductStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "supplier_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_assortment_item" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierProductId" TEXT NOT NULL,
    "externalPortfolioId" TEXT NOT NULL,
    "sellingPriceAtSupplier" DECIMAL(12,4),
    "quantityLeft" INTEGER,
    "status" "AssortmentItemStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "supplier_assortment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "ean" TEXT,
    "supplierProductId" TEXT,
    "categoryId" TEXT,
    "titlePt" TEXT,
    "descriptionPtHtml" TEXT,
    "shortDescriptionPt" TEXT,
    "brand" TEXT,
    "weightG" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'NONE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "compliance" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "mime" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_mapping" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "channelId" TEXT,
    "supplierDepartment" TEXT,
    "supplierSubDepartment" TEXT,
    "supplierFamily" TEXT,
    "normalizedKey" TEXT NOT NULL,
    "channelCategoryId" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "category_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_rule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "markupPct" DECIMAL(12,4),
    "fixedAdd" DECIMAL(12,4),
    "rounding" "PriceRounding" NOT NULL DEFAULT 'NONE',
    "minMarginPct" DECIMAL(12,4),
    "vatRate" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "price_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "credentialsEnc" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "scopeId" TEXT,

    CONSTRAINT "channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_listing" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT,
    "externalVariantId" TEXT,
    "status" "ChannelListingStatus" NOT NULL DEFAULT 'PENDING',
    "lastPrice" DECIMAL(12,4),
    "lastStock" INTEGER,
    "lastPayloadHash" TEXT,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "channel_listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_order" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalStatus" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "customer" JSONB NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totalGross" DECIMAL(12,4),
    "totalNet" DECIMAL(12,4),
    "totalShipping" DECIMAL(12,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "internalStatus" "OrderInternalStatus" NOT NULL DEFAULT 'IMPORTED',

    CONSTRAINT "channel_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "externalClientId" TEXT,
    "externalOrderId" TEXT,
    "externalReference" TEXT,
    "state" "SupplierOrderState" NOT NULL DEFAULT 'CREATING',
    "sagaProgress" JSONB NOT NULL DEFAULT '{}',
    "totalNet" DECIMAL(12,4),
    "totalGross" DECIMAL(12,4),
    "totalShipping" DECIMAL(12,4),
    "lastError" TEXT,

    CONSTRAINT "supplier_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelOrderId" TEXT NOT NULL,
    "carrierCode" TEXT,
    "carrierName" TEXT,
    "trackingNumber" TEXT NOT NULL,
    "source" "ShipmentSource" NOT NULL,
    "pushedToChannelAt" TIMESTAMP(3),
    "pushError" TEXT,

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "errorSummary" TEXT,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_request_log" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "correlationId" TEXT,
    "error" TEXT,

    CONSTRAINT "integration_request_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "supplier_tenantId_idx" ON "supplier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenantId_code_key" ON "supplier"("tenantId", "code");

-- CreateIndex
CREATE INDEX "supplier_product_tenantId_idx" ON "supplier_product"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_product_supplierId_idx" ON "supplier_product"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_product_ean_idx" ON "supplier_product"("ean");

-- CreateIndex
CREATE INDEX "supplier_product_status_idx" ON "supplier_product"("status");

-- CreateIndex
CREATE INDEX "supplier_product_department_subDepartment_family_idx" ON "supplier_product"("department", "subDepartment", "family");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_tenantId_supplierId_externalId_key" ON "supplier_product"("tenantId", "supplierId", "externalId");

-- CreateIndex
CREATE INDEX "supplier_assortment_item_tenantId_idx" ON "supplier_assortment_item"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_assortment_item_supplierId_idx" ON "supplier_assortment_item"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_assortment_item_supplierProductId_idx" ON "supplier_assortment_item"("supplierProductId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_assortment_item_tenantId_supplierId_externalPortfo_key" ON "supplier_assortment_item"("tenantId", "supplierId", "externalPortfolioId");

-- CreateIndex
CREATE INDEX "product_tenantId_idx" ON "product"("tenantId");

-- CreateIndex
CREATE INDEX "product_supplierProductId_idx" ON "product"("supplierProductId");

-- CreateIndex
CREATE INDEX "product_categoryId_idx" ON "product"("categoryId");

-- CreateIndex
CREATE INDEX "product_ean_idx" ON "product"("ean");

-- CreateIndex
CREATE INDEX "product_status_idx" ON "product"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenantId_sku_key" ON "product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "product_media_tenantId_idx" ON "product_media"("tenantId");

-- CreateIndex
CREATE INDEX "product_media_productId_idx" ON "product_media"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_productId_sourceUrl_key" ON "product_media"("productId", "sourceUrl");

-- CreateIndex
CREATE INDEX "category_tenantId_idx" ON "category"("tenantId");

-- CreateIndex
CREATE INDEX "category_parentId_idx" ON "category"("parentId");

-- CreateIndex
CREATE INDEX "category_normalizedName_idx" ON "category"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenantId_parentId_slug_key" ON "category"("tenantId", "parentId", "slug");

-- CreateIndex
CREATE INDEX "category_mapping_tenantId_idx" ON "category_mapping"("tenantId");

-- CreateIndex
CREATE INDEX "category_mapping_categoryId_idx" ON "category_mapping"("categoryId");

-- CreateIndex
CREATE INDEX "category_mapping_channelId_idx" ON "category_mapping"("channelId");

-- CreateIndex
CREATE INDEX "category_mapping_tenantId_normalizedKey_idx" ON "category_mapping"("tenantId", "normalizedKey");

-- CreateIndex
CREATE INDEX "price_rule_tenantId_idx" ON "price_rule"("tenantId");

-- CreateIndex
CREATE INDEX "price_rule_channelId_idx" ON "price_rule"("channelId");

-- CreateIndex
CREATE INDEX "price_rule_tenantId_channelId_priority_idx" ON "price_rule"("tenantId", "channelId", "priority");

-- CreateIndex
CREATE INDEX "channel_tenantId_idx" ON "channel"("tenantId");

-- CreateIndex
CREATE INDEX "channel_scopeId_idx" ON "channel"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_tenantId_code_key" ON "channel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "channel_listing_tenantId_idx" ON "channel_listing"("tenantId");

-- CreateIndex
CREATE INDEX "channel_listing_productId_idx" ON "channel_listing"("productId");

-- CreateIndex
CREATE INDEX "channel_listing_channelId_idx" ON "channel_listing"("channelId");

-- CreateIndex
CREATE INDEX "channel_listing_status_idx" ON "channel_listing"("status");

-- CreateIndex
CREATE INDEX "channel_listing_channelId_externalId_idx" ON "channel_listing"("channelId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listing_productId_channelId_key" ON "channel_listing"("productId", "channelId");

-- CreateIndex
CREATE INDEX "channel_order_tenantId_idx" ON "channel_order"("tenantId");

-- CreateIndex
CREATE INDEX "channel_order_channelId_idx" ON "channel_order"("channelId");

-- CreateIndex
CREATE INDEX "channel_order_internalStatus_idx" ON "channel_order"("internalStatus");

-- CreateIndex
CREATE INDEX "channel_order_placedAt_idx" ON "channel_order"("placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_order_channelId_externalId_key" ON "channel_order"("channelId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_order_channelOrderId_key" ON "supplier_order"("channelOrderId");

-- CreateIndex
CREATE INDEX "supplier_order_tenantId_idx" ON "supplier_order"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_order_supplierId_idx" ON "supplier_order"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_order_state_idx" ON "supplier_order"("state");

-- CreateIndex
CREATE INDEX "supplier_order_externalOrderId_idx" ON "supplier_order"("externalOrderId");

-- CreateIndex
CREATE INDEX "shipment_tenantId_idx" ON "shipment"("tenantId");

-- CreateIndex
CREATE INDEX "shipment_channelOrderId_idx" ON "shipment"("channelOrderId");

-- CreateIndex
CREATE INDEX "shipment_trackingNumber_idx" ON "shipment"("trackingNumber");

-- CreateIndex
CREATE INDEX "sync_run_tenantId_idx" ON "sync_run"("tenantId");

-- CreateIndex
CREATE INDEX "sync_run_kind_connector_idx" ON "sync_run"("kind", "connector");

-- CreateIndex
CREATE INDEX "sync_run_status_idx" ON "sync_run"("status");

-- CreateIndex
CREATE INDEX "sync_run_startedAt_idx" ON "sync_run"("startedAt");

-- CreateIndex
CREATE INDEX "integration_request_log_tenantId_idx" ON "integration_request_log"("tenantId");

-- CreateIndex
CREATE INDEX "integration_request_log_connector_idx" ON "integration_request_log"("connector");

-- CreateIndex
CREATE INDEX "integration_request_log_correlationId_idx" ON "integration_request_log"("correlationId");

-- CreateIndex
CREATE INDEX "integration_request_log_createdAt_idx" ON "integration_request_log"("createdAt");

-- CreateIndex
CREATE INDEX "audit_event_tenantId_idx" ON "audit_event"("tenantId");

-- CreateIndex
CREATE INDEX "audit_event_entity_entityId_idx" ON "audit_event"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_event_actor_idx" ON "audit_event"("actor");

-- CreateIndex
CREATE INDEX "audit_event_createdAt_idx" ON "audit_event"("createdAt");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_assortment_item" ADD CONSTRAINT "supplier_assortment_item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_assortment_item" ADD CONSTRAINT "supplier_assortment_item_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_assortment_item" ADD CONSTRAINT "supplier_assortment_item_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "supplier_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "supplier_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_mapping" ADD CONSTRAINT "category_mapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_mapping" ADD CONSTRAINT "category_mapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_mapping" ADD CONSTRAINT "category_mapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rule" ADD CONSTRAINT "price_rule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rule" ADD CONSTRAINT "price_rule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel" ADD CONSTRAINT "channel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listing" ADD CONSTRAINT "channel_listing_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_order" ADD CONSTRAINT "channel_order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_order" ADD CONSTRAINT "channel_order_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order" ADD CONSTRAINT "supplier_order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order" ADD CONSTRAINT "supplier_order_channelOrderId_fkey" FOREIGN KEY ("channelOrderId") REFERENCES "channel_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order" ADD CONSTRAINT "supplier_order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_channelOrderId_fkey" FOREIGN KEY ("channelOrderId") REFERENCES "channel_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_request_log" ADD CONSTRAINT "integration_request_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

