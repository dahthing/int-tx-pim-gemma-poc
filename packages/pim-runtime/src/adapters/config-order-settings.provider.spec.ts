import { ConfigOrderSettingsProvider } from './config-order-settings.provider';

const config = (all: Record<string, string>) => ({
  get: jest.fn((k: string) => all[k]),
  getOrThrow: jest.fn((k: string) => {
    if (all[k] === undefined) throw new Error(`missing ${k}`);
    return all[k];
  }),
});

describe('ConfigOrderSettingsProvider', () => {
  it('reads the tenant defaults from configuration with documented fallbacks', async () => {
    const p = new ConfigOrderSettingsProvider(
      config({
        PIM_ORDER_DEFAULT_EMAIL: 'a@b.pt',
        PIM_ORDER_DEFAULT_PHONE: '+351',
      }) as never,
    );
    await expect(p.get('t')).resolves.toEqual({
      defaultEmail: 'a@b.pt',
      defaultPhone: '+351',
      minMargin: '0.15',
      vatRate: '0.23',
    });
  });

  it('honours overrides and the absorbed shipping cost', async () => {
    const p = new ConfigOrderSettingsProvider(
      config({
        PIM_ORDER_DEFAULT_EMAIL: 'a@b.pt',
        PIM_ORDER_DEFAULT_PHONE: '1',
        PIM_ORDER_MIN_MARGIN: '0.2',
        PIM_ORDER_VAT_RATE: '0.21',
        PIM_ORDER_SHIPPING_ABSORBED: '3.5',
      }) as never,
    );
    await expect(p.get('t')).resolves.toEqual({
      defaultEmail: 'a@b.pt',
      defaultPhone: '1',
      minMargin: '0.2',
      vatRate: '0.21',
      shippingAbsorbed: '3.5',
    });
  });

  it('requires the default contact details', async () => {
    await expect(
      new ConfigOrderSettingsProvider(config({}) as never).get('t'),
    ).rejects.toThrow('missing');
  });
});
