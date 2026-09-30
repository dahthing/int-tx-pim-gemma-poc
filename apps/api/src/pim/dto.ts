import {
  acknowledgeAlertResponseSchema,
  alertListQuerySchema,
  alertPageSchema,
  alertSchema,
  bulkAddRequestSchema,
  bulkAddResponseSchema,
  categoryListSchema,
  categorySchema,
  channelAttributesResponseSchema,
  channelCategoryTreeSchema,
  channelSettingsSchema,
  connectionTestResponseSchema,
  createCategoryRequestSchema,
  createChannelRequestSchema,
  createPriceRuleRequestSchema,
  createSupplierRequestSchema,
  dashboardSchema,
  enrichmentApproveResponseSchema,
  enrichmentGenerateResponseSchema,
  manualTrackingRequestSchema,
  manualTrackingResponseSchema,
  mapSupplierPathRequestSchema,
  mediaImportResponseSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderPageSchema,
  priceRuleListSchema,
  priceRuleSchema,
  pricingQuoteRequestSchema,
  pricingQuoteSchema,
  productDetailSchema,
  productListQuerySchema,
  productPageSchema,
  productPricingSchema,
  publishListingResponseSchema,
  publishReadinessSchema,
  retryOrderResponseSchema,
  settingsResponseSchema,
  supplierPathMappingListSchema,
  supplierProductFacetsQuerySchema,
  supplierProductFacetsSchema,
  supplierProductListQuerySchema,
  supplierProductPageSchema,
  supplierSettingsSchema,
  syncRunListQuerySchema,
  syncRunPageSchema,
  triggerSyncRequestSchema,
  triggerSyncResponseSchema,
  unpublishListingResponseSchema,
  updateChannelRequestSchema,
  updatePriceRuleRequestSchema,
  updateSupplierRequestSchema,
} from '@repo/shared-types';
import { createZodDto } from 'nestjs-zod';

// Supplier catalogue
export class SupplierProductListQueryDto extends createZodDto(
  supplierProductListQuerySchema,
) {}
export class SupplierProductPageDto extends createZodDto(
  supplierProductPageSchema,
) {}
export class SupplierProductFacetsQueryDto extends createZodDto(
  supplierProductFacetsQuerySchema,
) {}
export class SupplierProductFacetsDto extends createZodDto(
  supplierProductFacetsSchema,
) {}
export class BulkAddRequestDto extends createZodDto(bulkAddRequestSchema) {}
export class BulkAddResponseDto extends createZodDto(bulkAddResponseSchema) {}

// Products
export class ProductListQueryDto extends createZodDto(productListQuerySchema) {}
export class ProductPageDto extends createZodDto(productPageSchema) {}
export class ProductDetailDto extends createZodDto(productDetailSchema) {}
export class EnrichmentGenerateResponseDto extends createZodDto(
  enrichmentGenerateResponseSchema,
) {}
export class EnrichmentApproveResponseDto extends createZodDto(
  enrichmentApproveResponseSchema,
) {}
export class MediaImportResponseDto extends createZodDto(
  mediaImportResponseSchema,
) {}
export class PricingQuoteRequestDto extends createZodDto(
  pricingQuoteRequestSchema,
) {}
export class PricingQuoteDto extends createZodDto(pricingQuoteSchema) {}
export class ProductPricingDto extends createZodDto(productPricingSchema) {}
export class PublishReadinessDto extends createZodDto(publishReadinessSchema) {}
export class PublishListingResponseDto extends createZodDto(
  publishListingResponseSchema,
) {}
export class UnpublishListingResponseDto extends createZodDto(
  unpublishListingResponseSchema,
) {}

// Categories
export class CategoryDto extends createZodDto(categorySchema) {}
export class CategoryListDto extends createZodDto(categoryListSchema) {}
export class CreateCategoryRequestDto extends createZodDto(
  createCategoryRequestSchema,
) {}
export class SupplierPathMappingListDto extends createZodDto(
  supplierPathMappingListSchema,
) {}
export class MapSupplierPathRequestDto extends createZodDto(
  mapSupplierPathRequestSchema,
) {}
export class ChannelCategoryTreeDto extends createZodDto(
  channelCategoryTreeSchema,
) {}
export class ChannelAttributesResponseDto extends createZodDto(
  channelAttributesResponseSchema,
) {}

// Price rules
export class PriceRuleDto extends createZodDto(priceRuleSchema) {}
export class PriceRuleListDto extends createZodDto(priceRuleListSchema) {}
export class CreatePriceRuleRequestDto extends createZodDto(
  createPriceRuleRequestSchema,
) {}
export class UpdatePriceRuleRequestDto extends createZodDto(
  updatePriceRuleRequestSchema,
) {}

// Orders
export class OrderListQueryDto extends createZodDto(orderListQuerySchema) {}
export class OrderPageDto extends createZodDto(orderPageSchema) {}
export class OrderDetailDto extends createZodDto(orderDetailSchema) {}
export class RetryOrderResponseDto extends createZodDto(
  retryOrderResponseSchema,
) {}
export class ManualTrackingRequestDto extends createZodDto(
  manualTrackingRequestSchema,
) {}
export class ManualTrackingResponseDto extends createZodDto(
  manualTrackingResponseSchema,
) {}

// Operations
export class SyncRunListQueryDto extends createZodDto(syncRunListQuerySchema) {}
export class SyncRunPageDto extends createZodDto(syncRunPageSchema) {}
export class AlertListQueryDto extends createZodDto(alertListQuerySchema) {}
export class AlertPageDto extends createZodDto(alertPageSchema) {}
export class AlertDto extends createZodDto(alertSchema) {}
export class AcknowledgeAlertResponseDto extends createZodDto(
  acknowledgeAlertResponseSchema,
) {}
export class DashboardDto extends createZodDto(dashboardSchema) {}
export class TriggerSyncRequestDto extends createZodDto(
  triggerSyncRequestSchema,
) {}
export class TriggerSyncResponseDto extends createZodDto(
  triggerSyncResponseSchema,
) {}

// Settings (credentials are write-only: they exist in request DTOs only)
export class SettingsResponseDto extends createZodDto(settingsResponseSchema) {}
export class SupplierSettingsDto extends createZodDto(supplierSettingsSchema) {}
export class ChannelSettingsDto extends createZodDto(channelSettingsSchema) {}
export class CreateSupplierRequestDto extends createZodDto(
  createSupplierRequestSchema,
) {}
export class UpdateSupplierRequestDto extends createZodDto(
  updateSupplierRequestSchema,
) {}
export class CreateChannelRequestDto extends createZodDto(
  createChannelRequestSchema,
) {}
export class UpdateChannelRequestDto extends createZodDto(
  updateChannelRequestSchema,
) {}
export class ConnectionTestResponseDto extends createZodDto(
  connectionTestResponseSchema,
) {}
