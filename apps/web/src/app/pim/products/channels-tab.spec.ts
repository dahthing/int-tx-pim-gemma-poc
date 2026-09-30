import { TestBed } from '@angular/core/testing';
import { ChannelsTab } from './channels-tab';
import { listing, productDetail, settings } from '../testing/fixtures';
import { els, providePimTesting, waitUntil } from '../testing/pim-test-utils';

async function setUp() {
  const api = {
    settings: vi.fn().mockResolvedValue(settings()),
    readiness: vi.fn().mockImplementation(async (_id: string, channelId: string) =>
      channelId === 'ch1'
        ? { ready: true, missing: [] }
        : { ready: false, missing: [{ type: 'category_mapping', name: 'Temu category' }, { type: 'mandatory_attribute', name: 'Material' }] },
    ),
    publish: vi.fn().mockResolvedValue({ status: 'submitted', externalId: '1', skipped: false }),
    unpublish: vi.fn().mockResolvedValue({ status: 'inactive' }),
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(ChannelsTab);
  fixture.componentRef.setInput('product', productDetail({ listings: [listing()] }));
  await waitUntil(fixture, () => els(fixture, 'readiness-status').length === 2);
  return { fixture, api };
}

const inPanel = (panel: HTMLElement, id: string) => panel.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

describe('ChannelsTab', () => {
  it('lists what is missing for a channel that is not ready and disables publish', async () => {
    const { fixture } = await setUp();
    const [ready, notReady] = els(fixture, 'channel-panel');

    expect(inPanel(ready, 'publish-button')!.disabled).toBe(false);
    expect(inPanel(notReady, 'publish-button')!.disabled).toBe(true);
    const missing = [...notReady.querySelectorAll('[data-testid="missing-item"]')].map((m) => m.textContent?.trim());
    expect(missing).toEqual(['category_mapping: Temu category', 'mandatory_attribute: Material']);
  });

  it('publishes to the ready channel and offers unpublish for a live listing', async () => {
    const { fixture, api } = await setUp();
    const [ready, notReady] = els(fixture, 'channel-panel');

    inPanel(ready, 'publish-button')!.click();
    await waitUntil(fixture, () => api.publish.mock.calls.length > 0);
    expect(api.publish).toHaveBeenCalledWith('p1', 'ch1');

    expect(inPanel(notReady, 'unpublish-button')).toBeNull();
    inPanel(ready, 'unpublish-button')!.click();
    await waitUntil(fixture, () => api.unpublish.mock.calls.length > 0);
    expect(api.unpublish).toHaveBeenCalledWith('p1', 'ch1');
  });
});
