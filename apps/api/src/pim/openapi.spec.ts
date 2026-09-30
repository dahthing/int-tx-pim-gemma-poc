import type { Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { CategoryMappingService, EnrichmentService } from '@repo/pim-catalog';
import { ShipmentService } from '@repo/pim-orders';
import {
  CatalogOpsService,
  CatalogQueryService,
  ChannelAdminService,
  DashboardService,
  OrdersQueryService,
  PriceRuleService,
  SettingsService,
  SyncTriggerService,
  TenantContext,
} from '@repo/pim-runtime';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { CategoriesController } from './categories.controller';
import { OperationsController } from './operations.controller';
import { OrdersController } from './orders.controller';
import { PriceRulesController } from './price-rules.controller';
import { ProductsController } from './products.controller';
import { SettingsController } from './settings.controller';
import { SupplierProductsController } from './supplier-products.controller';
import { TriggersController } from './triggers.controller';

const stub = (token: Type) => ({ provide: token, useValue: {} });

describe('OpenAPI document of the PIM API', () => {
  it('generates without errors and never documents credentials in a response', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        SupplierProductsController,
        ProductsController,
        CategoriesController,
        PriceRulesController,
        OrdersController,
        OperationsController,
        SettingsController,
        TriggersController,
      ],
      providers: [
        TenantContext,
        CatalogQueryService,
        CatalogOpsService,
        ChannelAdminService,
        PriceRuleService,
        OrdersQueryService,
        DashboardService,
        SettingsService,
        SyncTriggerService,
        EnrichmentService,
        CategoryMappingService,
        ShipmentService,
      ].map(stub),
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const doc = cleanupOpenApiDoc(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('t').build(),
      ),
    );
    // nestjs-zod warns about root schemas that carry a `.meta({ id })` (the document is still correct: first shape wins).
    warn.mockRestore();
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/supplier-products',
        '/supplier-products/facets',
        '/supplier-products/bulk-add',
        '/products',
        '/products/{id}',
        '/products/{id}/enrichment/generate',
        '/products/{id}/enrichment/approve',
        '/products/{id}/pricing',
        '/products/{id}/pricing/quote',
        '/products/{id}/channels/{channelId}/publish',
        '/products/{id}/channels/{channelId}/unpublish',
        '/categories',
        '/category-mappings',
        '/category-mappings/supplier-paths',
        '/price-rules',
        '/price-rules/{id}',
        '/orders',
        '/orders/{id}',
        '/orders/{id}/retry',
        '/orders/{id}/tracking',
        '/sync-runs',
        '/alerts',
        '/dashboard',
        '/sync/catalog',
        '/settings',
        '/settings/suppliers',
        '/settings/channels',
      ]),
    );
    const schemas = (doc.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    const supplier = schemas['SupplierSettings_Output'];
    const channel = schemas['ChannelSettings_Output'];
    expect(Object.keys(supplier?.properties ?? {}).sort()).toEqual([
      'baseUrl',
      'code',
      'credentialsConfigured',
      'environment',
      'id',
      'name',
      'updatedAt',
    ]);
    expect(Object.keys(channel?.properties ?? {}).sort()).toEqual([
      'code',
      'credentialsConfigured',
      'id',
      'name',
      'settings',
      'updatedAt',
    ]);
    for (const name of [
      'SupplierSettings_Output',
      'ChannelSettings_Output',
      'SettingsResponse_Output',
    ]) {
      expect(JSON.stringify(schemas[name])).not.toMatch(
        /credentialsEnc|"token"|appSecret|clientSecret|"credentials"/,
      );
    }
    // credentials exist only in request schemas
    expect(JSON.stringify(schemas['CreateSupplierRequest'])).toContain(
      'credentials',
    );
    await app.close();
  });
});
