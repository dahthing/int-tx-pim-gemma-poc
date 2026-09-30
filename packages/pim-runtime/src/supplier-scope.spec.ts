import { SupplierScope } from './supplier-scope';

describe('SupplierScope', () => {
  it('exposes the active supplier inside run() and across awaits', async () => {
    const scope = new SupplierScope();
    const seen = await scope.run('t1', 's1', async () => {
      await Promise.resolve();
      return scope.current();
    });
    expect(seen).toEqual({ tenantId: 't1', supplierId: 's1' });
  });

  it('keeps nested scopes isolated', async () => {
    const scope = new SupplierScope();
    const out = await scope.run('t1', 's1', async () => {
      const inner = await scope.run('t2', 's2', async () => scope.current());
      return [inner, scope.current()];
    });
    expect(out).toEqual([
      { tenantId: 't2', supplierId: 's2' },
      { tenantId: 't1', supplierId: 's1' },
    ]);
  });

  it('throws outside of a scope', () => {
    expect(() => new SupplierScope().current()).toThrow(/supplier scope/i);
  });

  it('runForTenant defers supplier selection', async () => {
    const scope = new SupplierScope();
    const seen = await scope.runForTenant('t1', async () =>
      scope.currentTenant(),
    );
    expect(seen).toBe('t1');
    expect(() => scope.current()).toThrow();
  });

  it('currentTenant throws outside of a scope', () => {
    expect(() => new SupplierScope().currentTenant()).toThrow();
  });
});
