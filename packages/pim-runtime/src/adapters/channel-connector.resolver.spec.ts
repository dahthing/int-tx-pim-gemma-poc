import { ConnectorChannelResolver } from './channel-connector.resolver';

describe('ConnectorChannelResolver', () => {
  it('delegates to the connector factory', async () => {
    const connector = {};
    const factory = { channel: jest.fn().mockResolvedValue(connector) };
    const ref = { id: 'c', tenantId: 't', code: 'temu-eu', settings: {} };
    await expect(
      new ConnectorChannelResolver(factory as never).resolve(ref),
    ).resolves.toBe(connector);
    expect(factory.channel).toHaveBeenCalledWith(ref);
  });
});
