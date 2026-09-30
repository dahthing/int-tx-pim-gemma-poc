import { TestBed } from '@angular/core/testing';
import { OrderDetailPage } from './order-detail';
import { orderDetail } from '../testing/fixtures';
import { el, els, providePimTesting, waitUntil } from '../testing/pim-test-utils';

async function setUp(detail: unknown) {
  const api = {
    order: vi.fn().mockResolvedValue(detail),
    retryOrder: vi.fn().mockResolvedValue({ enqueued: true, previousStatus: 'supplier_failed' }),
    submitTracking: vi.fn(),
  };
  TestBed.configureTestingModule({ providers: providePimTesting(api) });
  const fixture = TestBed.createComponent(OrderDetailPage);
  fixture.componentRef.setInput('id', 'o1');
  await waitUntil(fixture, () => el(fixture, 'order-external-id'));
  return { fixture, api };
}

describe('OrderDetailPage', () => {
  it('shows the order lines and the manual tracking form while the supplier order is submitted', async () => {
    const { fixture } = await setUp(orderDetail());
    expect(el(fixture, 'order-external-id')?.textContent).toContain('PS-1001');
    expect(els(fixture, 'order-line')).toHaveLength(1);
    expect(el(fixture, 'carrier-input')).not.toBeNull();
  });

  it('hides the tracking form for a completed order', async () => {
    const { fixture } = await setUp(orderDetail({ status: 'completed' }));
    expect(el(fixture, 'carrier-input')).toBeNull();
  });

  it('retries a failed order', async () => {
    const { fixture, api } = await setUp(orderDetail({ status: 'supplier_failed' }));
    el<HTMLButtonElement>(fixture, 'retry-button')!.click();
    await waitUntil(fixture, () => api.retryOrder.mock.calls.length > 0);
    expect(api.retryOrder).toHaveBeenCalledWith('o1');
  });

  it('does not offer retry for a completed order', async () => {
    const { fixture } = await setUp(orderDetail({ status: 'completed' }));
    expect(el<HTMLButtonElement>(fixture, 'retry-button')!.disabled).toBe(true);
  });
});
