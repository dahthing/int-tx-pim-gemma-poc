import { channelStatusSets, classifyChannelStatus } from './channel-status';

describe('classifyChannelStatus', () => {
  it('uses PrestaShop state ids by default (6 cancelled, 5 delivered)', () => {
    expect(classifyChannelStatus('prestashop9', {}, '6')).toBe('cancelled');
    expect(classifyChannelStatus('prestashop9', {}, '5')).toBe('delivered');
    expect(classifyChannelStatus('prestashop9', {}, '2')).toBe('open');
  });

  it('uses Temu statuses by default, case-insensitively', () => {
    expect(classifyChannelStatus('temu-eu', {}, 'CANCELLED')).toBe('cancelled');
    expect(classifyChannelStatus('temu-eu', {}, 'delivered')).toBe('delivered');
    expect(classifyChannelStatus('temu-eu', {}, 'AWAITING_SHIPMENT')).toBe('open');
  });

  it('lets channel settings override the defaults (numbers or strings)', () => {
    const settings = { cancelledStatuses: [7, '8'], deliveredStatuses: ['9'] };
    expect(classifyChannelStatus('prestashop9', settings, '7')).toBe('cancelled');
    expect(classifyChannelStatus('prestashop9', settings, '8')).toBe('cancelled');
    expect(classifyChannelStatus('prestashop9', settings, '9')).toBe('delivered');
    expect(classifyChannelStatus('prestashop9', settings, '6')).toBe('open');
  });

  it('is open for null, unknown channels and malformed settings', () => {
    expect(classifyChannelStatus('prestashop9', {}, null)).toBe('open');
    expect(classifyChannelStatus('other', {}, '6')).toBe('open');
    expect(classifyChannelStatus('prestashop9', { cancelledStatuses: 'x' }, '6')).toBe('cancelled');
  });

  it('exposes the effective sets', () => {
    const s = channelStatusSets('prestashop9', { deliveredStatuses: [11] });
    expect([...s.cancelled]).toEqual(['6']);
    expect([...s.delivered]).toEqual(['11']);
  });
});
