import { routes } from '../app.routes';
import { authGuard } from '../auth/auth.guard';
import { PIM_ROUTES } from './pim.routes';

describe('PIM routes', () => {
  it('mounts the pim area under the auth-guarded shell', () => {
    const shell = routes.find((r) => r.canActivate?.includes(authGuard) && r.children);
    const pim = shell?.children?.find((r) => r.path === 'pim');
    expect(pim).toBeDefined();
    expect(pim?.loadChildren).toBeTypeOf('function');
  });

  it('declares every back-office screen', () => {
    const paths = PIM_ROUTES.map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'dashboard',
        'catalogue',
        'products',
        'products/:id',
        'categories',
        'price-rules',
        'orders',
        'orders/:id',
        'settings',
      ]),
    );
  });
});
