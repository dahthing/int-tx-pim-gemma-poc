import { DynamicModule, Module, Provider } from '@nestjs/common';
import { CatalogIngestionService } from './catalog-ingestion.service';
import { CategoryMappingService } from './category-mapping.service';
import { CurationService } from './curation.service';
import { EnrichmentService } from './enrichment.service';
import { MediaImportService } from './media-import.service';
import { PricingService } from './pricing.service';
import { StockCostSyncService } from './stock-cost-sync.service';

const SERVICES = [
  CatalogIngestionService,
  StockCostSyncService,
  CurationService,
  MediaImportService,
  EnrichmentService,
  CategoryMappingService,
  PricingService,
];

export interface PimCatalogModuleOptions {
  /** Providers implementing the PIM_TOKENS ports (connector, storage, LLM, ...). */
  ports: Provider[];
}

@Module({ providers: SERVICES, exports: SERVICES })
export class PimCatalogModule {
  static register(options: PimCatalogModuleOptions): DynamicModule {
    return {
      module: PimCatalogModule,
      providers: [...SERVICES, ...options.ports],
      exports: SERVICES,
    };
  }
}
