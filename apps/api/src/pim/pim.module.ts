import { Module } from '@nestjs/common';
import { PimRuntimeModule } from '@repo/pim-runtime';
import { CategoriesController } from './categories.controller';
import { OperationsController } from './operations.controller';
import { OrdersController } from './orders.controller';
import { PriceRulesController } from './price-rules.controller';
import { ProductsController } from './products.controller';
import { SettingsController } from './settings.controller';
import { SupplierProductsController } from './supplier-products.controller';

export const PIM_CONTROLLERS = [
  SupplierProductsController,
  ProductsController,
  CategoriesController,
  PriceRulesController,
  OrdersController,
  OperationsController,
  SettingsController,
];

/** Back office REST API. Controllers are thin: the logic lives in pim-catalog, pim-orders and pim-runtime services. */
@Module({
  imports: [PimRuntimeModule.register()],
  controllers: PIM_CONTROLLERS,
})
export class PimModule {}
