import { TestBed } from '@angular/core/testing';
import { PimDashboard } from './pim-dashboard';
import { dashboard, syncRun } from '../testing/fixtures';
import { el, els, providePimTesting, waitUntil } from '../testing/pim-test-utils';

async function setUp(api: Record<string, unknown>) {
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(PimDashboard);
  await waitUntil(fixture, () => el(fixture, 'sync-run') || el(fixture, 'dashboard-error'));
  return fixture;
}

describe('PimDashboard', () => {
  it('lists the latest sync runs and the open alerts', async () => {
    const data = dashboard({
      lastSyncRuns: [syncRun(), syncRun({ id: 'run2', kind: 'stock-cost', status: 'failed', errorSummary: 'timeout' })],
    });
    const fixture = await setUp({ dashboard: vi.fn().mockResolvedValue(data) });

    expect(els(fixture, 'sync-run')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('timeout');
    expect(els(fixture, 'alert')).toHaveLength(1);
    expect(el(fixture, 'alert')?.textContent).toContain('Margin below minimum');
  });

  it('acknowledges an alert and reloads the dashboard', async () => {
    const dashboardFn = vi
      .fn()
      .mockResolvedValueOnce(dashboard())
      .mockResolvedValue(dashboard({ alerts: [] }));
    const acknowledgeAlert = vi.fn().mockResolvedValue({ id: 'a1', status: 'acknowledged' });
    const fixture = await setUp({ dashboard: dashboardFn, acknowledgeAlert });

    el<HTMLButtonElement>(fixture, 'ack-button')!.click();
    await waitUntil(fixture, () => !el(fixture, 'alert'));

    expect(acknowledgeAlert).toHaveBeenCalledWith('a1');
    expect(dashboardFn).toHaveBeenCalledTimes(2);
  });

  it('shows an error when the dashboard cannot be loaded or fails validation', async () => {
    const fixture = await setUp({ dashboard: vi.fn().mockRejectedValue(new Error('Invalid input')) });
    expect(el(fixture, 'dashboard-error')?.textContent).toContain('Invalid input');
  });
});
