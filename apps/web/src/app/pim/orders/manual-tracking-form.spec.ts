import { TestBed } from '@angular/core/testing';
import { ManualTrackingForm } from './manual-tracking-form';
import { el, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

function setUp(submitTracking: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({ providers: providePimTesting({ submitTracking }) });
  const fixture = TestBed.createComponent(ManualTrackingForm);
  fixture.componentRef.setInput('orderId', 'o1');
  fixture.detectChanges();
  return fixture;
}

describe('ManualTrackingForm', () => {
  it('requires a carrier and a tracking number', () => {
    const submitTracking = vi.fn();
    const fixture = setUp(submitTracking);

    el<HTMLButtonElement>(fixture, 'tracking-submit')!.click();
    fixture.detectChanges();
    expect(submitTracking).not.toHaveBeenCalled();
    expect(el(fixture, 'tracking-form-error')).not.toBeNull();

    setValue(el(fixture, 'carrier-input'), 'ctt');
    el<HTMLButtonElement>(fixture, 'tracking-submit')!.click();
    fixture.detectChanges();
    expect(submitTracking).not.toHaveBeenCalled();
  });

  it('submits once even when the button is pressed twice', async () => {
    let release!: (value: unknown) => void;
    const submitTracking = vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve)));
    const fixture = setUp(submitTracking);

    setValue(el(fixture, 'carrier-input'), 'ctt');
    setValue(el(fixture, 'tracking-input'), '  T123 ');
    const button = el<HTMLButtonElement>(fixture, 'tracking-submit')!;
    button.click();
    button.click();
    await waitUntil(fixture, () => submitTracking.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(submitTracking).toHaveBeenCalledTimes(1);
    expect(submitTracking).toHaveBeenCalledWith('o1', { carrierCode: 'ctt', trackingNumber: 'T123' });
    expect(button.disabled).toBe(true);

    release({ shipmentId: 's1', pushed: true, idempotent: false });
    await waitUntil(fixture, () => el(fixture, 'tracking-result'));
    expect(el(fixture, 'tracking-result')?.textContent).toContain('pushed');
  });

  it('includes the optional carrier name only when filled in and reports a push error', async () => {
    const submitTracking = vi.fn().mockResolvedValue({ shipmentId: 's1', pushed: false, idempotent: false, error: 'Channel down' });
    const fixture = setUp(submitTracking);

    setValue(el(fixture, 'carrier-input'), 'ctt');
    setValue(el(fixture, 'carrier-name-input'), 'CTT Expresso');
    setValue(el(fixture, 'tracking-input'), 'T1');
    el<HTMLButtonElement>(fixture, 'tracking-submit')!.click();
    await waitUntil(fixture, () => el(fixture, 'tracking-result'));

    expect(submitTracking).toHaveBeenCalledWith('o1', { carrierCode: 'ctt', carrierName: 'CTT Expresso', trackingNumber: 'T1' });
    expect(el(fixture, 'tracking-result')?.textContent).toContain('Channel down');
  });
});
