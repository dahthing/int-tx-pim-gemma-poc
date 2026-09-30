import { TestBed } from '@angular/core/testing';
import { PimSettings } from './pim-settings';
import { settings } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

async function setUp() {
  const api = {
    settings: vi.fn().mockResolvedValue(settings()),
    updateSupplier: vi.fn().mockResolvedValue({}),
    updateChannel: vi.fn().mockResolvedValue({}),
    testSupplier: vi.fn().mockResolvedValue({ ok: true, accountName: 'Gemma' }),
    testChannel: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid_credentials', message: 'Bad key' }),
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(PimSettings);
  await waitUntil(fixture, () => els(fixture, 'supplier-card').length > 0);
  return { fixture, api };
}

const inCard = (card: HTMLElement, id: string) => card.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);

describe('PimSettings', () => {
  it('shows only whether credentials are configured and never prefills a credential field', async () => {
    const { fixture } = await setUp();
    const [supplier] = els(fixture, 'supplier-card');
    const [psCard, temuCard] = els(fixture, 'channel-card');

    expect(inCard(supplier, 'supplier-configured')?.textContent).toContain('Configured');
    expect(inCard(psCard, 'channel-configured')?.textContent).toContain('Not configured');

    const credentialInputs = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[data-testid$="-credential"]')];
    expect(credentialInputs.length).toBeGreaterThanOrEqual(5);
    for (const input of credentialInputs) {
      expect(input.value).toBe('');
      expect(input.type).toBe('password');
      expect(input.autocomplete).toBe('new-password');
    }
    expect(inCard(temuCard, 'channel-appkey-credential')).not.toBeNull();
    expect(inCard(psCard, 'channel-webservice-key-credential')).not.toBeNull();
  });

  it('omits credentials from the supplier update when the token field is left blank', async () => {
    const { fixture, api } = await setUp();
    const [supplier] = els(fixture, 'supplier-card');
    setValue(inCard(supplier, 'supplier-environment-select'), 'production');
    inCard(supplier, 'supplier-save-button')!.click();
    await waitUntil(fixture, () => api.updateSupplier.mock.calls.length > 0);

    expect(api.updateSupplier).toHaveBeenCalledWith('sup1', { name: 'AW Supplier', environment: 'production' });
  });

  it('sends a new token once and clears the field afterwards', async () => {
    const { fixture, api } = await setUp();
    const [supplier] = els(fixture, 'supplier-card');
    setValue(inCard(supplier, 'supplier-token-credential'), 'new-secret');
    inCard(supplier, 'supplier-save-button')!.click();
    await waitUntil(fixture, () => api.updateSupplier.mock.calls.length > 0);

    expect(api.updateSupplier).toHaveBeenCalledWith('sup1', {
      name: 'AW Supplier',
      environment: 'staging',
      credentials: { token: 'new-secret' },
    });
    await waitUntil(fixture, () => inCard(supplier, 'supplier-token-credential')!.value === '');
    expect(fixture.nativeElement.textContent).not.toContain('new-secret');
  });

  it('updates channel credentials, settings (carrier mapping) and name', async () => {
    const { fixture, api } = await setUp();
    const [psCard] = els(fixture, 'channel-card');
    setValue(inCard(psCard, 'channel-webservice-key-credential'), 'k');
    setValue(inCard(psCard, 'channel-settings-input'), '{"language":"pt","carrierMapping":{"ctt":"7"}}');
    inCard(psCard, 'channel-save-button')!.click();
    await waitUntil(fixture, () => api.updateChannel.mock.calls.length > 0);

    expect(api.updateChannel).toHaveBeenCalledWith('ch1', {
      name: 'Gemma shop',
      settings: { language: 'pt', carrierMapping: { ctt: '7' } },
      credentials: { webservice: { key: 'k' } },
    });
  });

  it('rejects invalid settings JSON without calling the API', async () => {
    const { fixture, api } = await setUp();
    const [psCard] = els(fixture, 'channel-card');
    setValue(inCard(psCard, 'channel-settings-input'), '{oops');
    inCard(psCard, 'channel-save-button')!.click();
    fixture.detectChanges();
    expect(api.updateChannel).not.toHaveBeenCalled();
    expect(inCard(psCard, 'channel-error')).not.toBeNull();
  });

  it('tests connections and shows tenant defaults read-only', async () => {
    const { fixture, api } = await setUp();
    const [supplier] = els(fixture, 'supplier-card');
    const [psCard] = els(fixture, 'channel-card');

    inCard(supplier, 'supplier-test-button')!.click();
    await waitUntil(fixture, () => inCard(supplier, 'supplier-test-result'));
    expect(api.testSupplier).toHaveBeenCalledWith('sup1');

    inCard(psCard, 'channel-test-button')!.click();
    await waitUntil(fixture, () => inCard(psCard, 'channel-test-result'));
    expect(inCard(psCard, 'channel-test-result')?.textContent).toContain('Bad key');

    expect(el(fixture, 'tenant-defaults')?.textContent).toContain('a@b.pt');
  });
});
