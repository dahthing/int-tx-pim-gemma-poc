import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';
import {
  acknowledgeAlertResponseSchema,
  alertPageSchema,
  bulkAddResponseSchema,
  categorySchema,
  categoryListSchema,
  channelAttributesResponseSchema,
  channelCategoryTreeSchema,
  channelSettingsSchema,
  connectionTestResponseSchema,
  dashboardSchema,
  enrichmentApproveResponseSchema,
  enrichmentGenerateResponseSchema,
  manualTrackingResponseSchema,
  mediaImportResponseSchema,
  orderDetailSchema,
  orderPageSchema,
  priceRuleListSchema,
  priceRuleSchema,
  pricingQuoteSchema,
  productDetailSchema,
  productPageSchema,
  productPricingSchema,
  publishListingResponseSchema,
  publishReadinessSchema,
  retryOrderResponseSchema,
  settingsResponseSchema,
  supplierPathMappingListSchema,
  supplierProductFacetsSchema,
  supplierProductPageSchema,
  supplierSettingsSchema,
  syncRunPageSchema,
  triggerSyncResponseSchema,
  unpublishListingResponseSchema,
  type CreateCategoryRequest,
  type CreateChannelRequest,
  type CreatePriceRuleRequest,
  type CreateSupplierRequest,
  type ManualTrackingRequest,
  type MapSupplierPathRequest,
  type PricingQuoteRequest,
  type UpdateChannelRequest,
  type UpdatePriceRuleRequest,
  type UpdateSupplierRequest,
} from '@repo/shared-types';
import { webConfig } from '../config/app-config';

export type ListParams = Record<string, string | number | boolean | undefined>;

/**
 * Typed client for the PIM REST API (`/api/v1`). Every response is re-parsed through its shared Zod schema
 * before it leaves this class, so an unvalidated payload never reaches a component signal.
 */
@Injectable({ providedIn: 'root' })
export class PimApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${webConfig.apiUrl}/v1`;

  // ---- supplier catalogue
  supplierProducts(query: ListParams) {
    return this.get('/supplier-products', supplierProductPageSchema, query);
  }
  supplierProductFacets(query: ListParams = {}) {
    return this.get('/supplier-products/facets', supplierProductFacetsSchema, query);
  }
  bulkAdd(body: { supplierProductIds: string[]; supplierId?: string }) {
    return this.send('post', '/supplier-products/bulk-add', bulkAddResponseSchema, body);
  }

  // ---- products
  products(query: ListParams) {
    return this.get('/products', productPageSchema, query);
  }
  product(id: string) {
    return this.get(`/products/${id}`, productDetailSchema);
  }
  deleteProduct(id: string) {
    return this.send('delete', `/products/${id}`, z.unknown());
  }
  importMedia(id: string) {
    return this.send('post', `/products/${id}/media/import`, mediaImportResponseSchema, {});
  }
  generateEnrichment(id: string) {
    return this.send('post', `/products/${id}/enrichment/generate`, enrichmentGenerateResponseSchema, {});
  }
  approveEnrichment(id: string) {
    return this.send('post', `/products/${id}/enrichment/approve`, enrichmentApproveResponseSchema, {});
  }
  pricing(id: string) {
    return this.get(`/products/${id}/pricing`, productPricingSchema);
  }
  quotePrice(id: string, body: PricingQuoteRequest) {
    return this.send('post', `/products/${id}/pricing/quote`, pricingQuoteSchema, body);
  }
  readiness(id: string, channelId: string) {
    return this.get(`/products/${id}/channels/${channelId}/readiness`, publishReadinessSchema);
  }
  publish(id: string, channelId: string) {
    return this.send('post', `/products/${id}/channels/${channelId}/publish`, publishListingResponseSchema, {});
  }
  unpublish(id: string, channelId: string) {
    return this.send('post', `/products/${id}/channels/${channelId}/unpublish`, unpublishListingResponseSchema, {});
  }

  // ---- categories
  categories() {
    return this.get('/categories', categoryListSchema);
  }
  createCategory(body: CreateCategoryRequest) {
    return this.send('post', '/categories', categorySchema, body);
  }
  supplierPaths() {
    return this.get('/category-mappings/supplier-paths', supplierPathMappingListSchema);
  }
  mapSupplierPath(body: MapSupplierPathRequest) {
    return this.send('put', '/category-mappings', z.unknown(), body);
  }
  channelCategories(channelId: string) {
    return this.get(`/channels/${channelId}/categories`, channelCategoryTreeSchema);
  }
  channelAttributes(channelId: string, channelCategoryId: string) {
    return this.send(
      'post',
      `/channels/${channelId}/categories/${channelCategoryId}/attributes`,
      channelAttributesResponseSchema,
      {},
    );
  }

  // ---- price rules
  priceRules() {
    return this.get('/price-rules', priceRuleListSchema);
  }
  createPriceRule(body: CreatePriceRuleRequest) {
    return this.send('post', '/price-rules', priceRuleSchema, body);
  }
  updatePriceRule(id: string, body: UpdatePriceRuleRequest) {
    return this.send('patch', `/price-rules/${id}`, priceRuleSchema, body);
  }
  deletePriceRule(id: string) {
    return this.send('delete', `/price-rules/${id}`, z.unknown());
  }

  // ---- orders
  orders(query: ListParams) {
    return this.get('/orders', orderPageSchema, query);
  }
  order(id: string) {
    return this.get(`/orders/${id}`, orderDetailSchema);
  }
  retryOrder(id: string) {
    return this.send('post', `/orders/${id}/retry`, retryOrderResponseSchema, {});
  }
  submitTracking(id: string, body: ManualTrackingRequest) {
    return this.send('post', `/orders/${id}/tracking`, manualTrackingResponseSchema, body);
  }

  // ---- dashboard and sync
  dashboard() {
    return this.get('/dashboard', dashboardSchema);
  }
  syncRuns(query: ListParams = {}) {
    return this.get('/sync-runs', syncRunPageSchema, query);
  }
  alerts(query: ListParams = {}) {
    return this.get('/alerts', alertPageSchema, query);
  }
  acknowledgeAlert(id: string) {
    return this.send('post', `/alerts/${id}/acknowledge`, acknowledgeAlertResponseSchema, {});
  }
  triggerSync(kind: 'catalog' | 'stock-cost') {
    return this.send('post', `/sync/${kind}`, triggerSyncResponseSchema, {});
  }

  // ---- settings
  settings() {
    return this.get('/settings', settingsResponseSchema);
  }
  createSupplier(body: CreateSupplierRequest) {
    return this.send('post', '/settings/suppliers', supplierSettingsSchema, body);
  }
  updateSupplier(id: string, body: UpdateSupplierRequest) {
    return this.send('patch', `/settings/suppliers/${id}`, supplierSettingsSchema, body);
  }
  testSupplier(id: string) {
    return this.send('post', `/settings/suppliers/${id}/test`, connectionTestResponseSchema, {});
  }
  createChannel(body: CreateChannelRequest) {
    return this.send('post', '/settings/channels', channelSettingsSchema, body);
  }
  updateChannel(id: string, body: UpdateChannelRequest) {
    return this.send('patch', `/settings/channels/${id}`, channelSettingsSchema, body);
  }
  testChannel(id: string) {
    return this.send('post', `/settings/channels/${id}/test`, connectionTestResponseSchema, {});
  }

  // ---- plumbing
  private async get<S extends z.ZodType>(path: string, schema: S, query: ListParams = {}): Promise<z.output<S>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      params = params.set(key, String(value));
    }
    const body = await firstValueFrom(this.http.get<unknown>(`${this.base}${path}`, { params }));
    return schema.parse(body);
  }

  private async send<S extends z.ZodType>(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const url = `${this.base}${path}`;
    const request =
      method === 'delete' ? this.http.delete<unknown>(url) : this.http[method]<unknown>(url, body ?? {});
    return schema.parse(await firstValueFrom(request));
  }
}

