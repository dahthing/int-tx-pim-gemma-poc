import { Routes } from '@angular/router';

/** The PIM back office, mounted at `/pim` inside the auth-guarded shell (see app.routes.ts). */
export const PIM_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'PIM dashboard',
    loadComponent: () => import('./dashboard/pim-dashboard').then((m) => m.PimDashboard),
  },
  {
    path: 'catalogue',
    title: 'Supplier catalogue',
    loadComponent: () => import('./catalogue/supplier-catalogue').then((m) => m.SupplierCatalogue),
  },
  {
    path: 'products',
    title: 'Products',
    loadComponent: () => import('./products/product-list').then((m) => m.ProductListPage),
  },
  {
    path: 'products/:id',
    title: 'Product',
    loadComponent: () => import('./products/product-detail').then((m) => m.ProductDetailPage),
  },
  {
    path: 'categories',
    title: 'Category mapping',
    loadComponent: () => import('./categories/category-mapping').then((m) => m.CategoryMapping),
  },
  {
    path: 'price-rules',
    title: 'Price rules',
    loadComponent: () => import('./price-rules/price-rules').then((m) => m.PriceRules),
  },
  {
    path: 'orders',
    title: 'Orders',
    loadComponent: () => import('./orders/order-list').then((m) => m.OrderList),
  },
  {
    path: 'orders/:id',
    title: 'Order',
    loadComponent: () => import('./orders/order-detail').then((m) => m.OrderDetailPage),
  },
  {
    path: 'settings',
    title: 'PIM settings',
    loadComponent: () => import('./settings/pim-settings').then((m) => m.PimSettings),
  },
];
