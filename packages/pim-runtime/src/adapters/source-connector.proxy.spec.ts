import { SupplierScope } from '../supplier-scope';
import { SourceConnectorProxy } from './source-connector.proxy';

function build() {
  const connector = {
    testConnection: jest.fn().mockResolvedValue({ ok: true }),
    listCatalog: jest.fn().mockResolvedValue('catalog'),
    listAssortment: jest.fn().mockResolvedValue('assortment'),
    addToAssortment: jest.fn().mockResolvedValue('added'),
    removeFromAssortment: jest.fn().mockResolvedValue(undefined),
    listMedia: jest.fn().mockResolvedValue('media'),
    placeDropshipOrder: jest.fn().mockResolvedValue('placed'),
    getSupplierOrder: jest.fn().mockResolvedValue('order'),
  };
  const factory = { source: jest.fn().mockResolvedValue(connector) };
  const scope = new SupplierScope();
  return {
    connector,
    factory,
    scope,
    proxy: new SourceConnectorProxy(factory as never, scope),
  };
}

describe('SourceConnectorProxy', () => {
  it('delegates every call to the connector of the current supplier scope', async () => {
    const { proxy, connector, factory, scope } = build();
    await scope.run('t', 's', async () => {
      expect(await proxy.listCatalog({ page: 2, perPage: 10 })).toBe('catalog');
      expect(await proxy.listAssortment()).toBe('assortment');
      expect(await proxy.addToAssortment('x', { sellingPrice: '1' })).toBe(
        'added',
      );
      await proxy.removeFromAssortment('p');
      expect(await proxy.listMedia({ kind: 'product', id: '1' })).toBe('media');
      expect(await proxy.placeDropshipOrder({} as never)).toBe('placed');
      expect(await proxy.getSupplierOrder('o')).toBe('order');
      expect(await proxy.testConnection()).toEqual({ ok: true });
    });
    expect(factory.source).toHaveBeenCalledWith('t', 's');
    expect(connector.listCatalog).toHaveBeenCalledWith({
      page: 2,
      perPage: 10,
    });
    expect(connector.addToAssortment).toHaveBeenCalledWith('x', {
      sellingPrice: '1',
    });
    expect(connector.removeFromAssortment).toHaveBeenCalledWith('p');
  });

  it('fails fast outside of a supplier scope', async () => {
    const { proxy } = build();
    await expect(proxy.listCatalog()).rejects.toThrow(/supplier scope/i);
  });

  it('reports the AW code and static capabilities', () => {
    const { proxy } = build();
    expect(proxy.code).toBe('aw-aiku');
    expect(proxy.capabilities()).toMatchObject({
      catalogRead: true,
      assortmentWrite: true,
      dropshipOrderWrite: true,
    });
  });
});
