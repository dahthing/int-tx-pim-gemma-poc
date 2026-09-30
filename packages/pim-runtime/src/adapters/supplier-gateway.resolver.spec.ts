import { createFakeFetch } from '@repo/http-client';
import { SupplierGatewayResolverImpl } from './supplier-gateway.resolver';

function build(fetchImpl = createFakeFetch([{ status: 200, body: {} }])) {
  const source = { getSupplierOrder: jest.fn().mockResolvedValue('status') };
  const saga = {
    placeDropshipOrder: jest.fn().mockImplementation(async () => 'result'),
  };
  const factory = {
    source: jest.fn().mockResolvedValue(source),
    sourceWithProgress: jest.fn().mockResolvedValue(saga),
    supplierAccess: jest
      .fn()
      .mockResolvedValue({ token: 'tok-123', environment: 'staging' }),
    sink: jest.fn().mockReturnValue({ log: jest.fn() }),
  };
  return {
    source,
    saga,
    factory,
    fetchImpl,
    resolver: new SupplierGatewayResolverImpl(factory as never, fetchImpl),
  };
}

describe('SupplierGatewayResolverImpl', () => {
  it('places an order through a connector bound to the per-call progress callback', async () => {
    const { resolver, factory, saga } = build();
    const gw = await resolver.resolve('t', 's');
    const onProgress = jest.fn();
    await expect(
      gw.placeDropshipOrder({ channelOrderId: 'o' } as never, onProgress),
    ).resolves.toBe('result');
    expect(factory.sourceWithProgress).toHaveBeenCalledWith(
      't',
      's',
      onProgress,
    );
    expect(saga.placeDropshipOrder).toHaveBeenCalledWith({
      channelOrderId: 'o',
    });
  });

  it('reads supplier order status from the cached connector', async () => {
    const { resolver, factory } = build();
    const gw = await resolver.resolve('t', 's');
    await expect(gw.getSupplierOrder('ext')).resolves.toBe('status');
    expect(factory.source).toHaveBeenCalledWith('t', 's');
  });

  it('deletes a draft order on AW with the bearer token against the environment host', async () => {
    const { resolver, fetchImpl } = build();
    const gw = await resolver.resolve('t', 's');
    await gw.deleteSupplierDraft('a/b');
    const call = fetchImpl.calls[0]!;
    expect(call.method).toBe('DELETE');
    expect(call.url).toBe(
      'https://api.aiku-sandbox.uk/dropshipping/order/a%2Fb/delete',
    );
    expect(call.headers.authorization).toBe('Bearer tok-123');
  });

  it('scrubs the token from delete failures', async () => {
    const { resolver } = build(
      createFakeFetch([{ status: 422, body: 'invalid tok-123' }]),
    );
    const gw = await resolver.resolve('t', 's');
    const err = (await gw
      .deleteSupplierDraft('9')
      .catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain('tok-123');
  });
});
