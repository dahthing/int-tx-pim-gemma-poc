import { DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';
import { ChannelOrderImportService } from './channel-order-import.service';
import { ListingSyncService } from './listing-sync.service';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderStateService } from './order-state.service';
import { ShipmentService } from './shipment.service';
import { SupplierOrderSagaService } from './supplier-order-saga.service';
import { SupplierOrderStatusService } from './supplier-order-status.service';

const SERVICES = [
  OrderStateService,
  ChannelOrderImportService,
  SupplierOrderSagaService,
  SupplierOrderStatusService,
  ShipmentService,
  OrderCancellationService,
  ListingSyncService,
];

export interface PimOrdersModuleOptions {
  /** Implementations of the ports listed under PIM_ORDERS_TOKENS (see ports.ts). */
  providers: Provider[];
  imports?: ModuleMetadata['imports'];
}

/** DatabaseService must be available (SharedModule registers DatabaseModule globally). */
@Module({})
export class PimOrdersModule {
  static register(options: PimOrdersModuleOptions): DynamicModule {
    return {
      module: PimOrdersModule,
      imports: options.imports ?? [],
      providers: [...options.providers, ...SERVICES],
      exports: [...SERVICES, ...options.providers],
    };
  }
}
