import { TestBed } from '@angular/core/testing';
import { OrderList } from './order-list';
import { order, page } from '../testing/fixtures';
import { el, els, providePimTesting, setValue, waitUntil } from '../testing/pim-test-utils';

describe('OrderList', () => {
  async function setUp() {
    const api = { orders: vi.fn().mockResolvedValue(page([order(), order({ id: 'o2', status: 'supplier_failed' })])) };
    TestBed.configureTestingModule({ providers: providePimTesting(api) });
    const fixture = TestBed.createComponent(OrderList);
    await waitUntil(fixture, () => els(fixture, 'order-row').length > 0);
    return { fixture, api };
  }

  it('shows each order with its state machine status', async () => {
    const { fixture } = await setUp();
    expect(els(fixture, 'order-row')).toHaveLength(2);
    expect(els(fixture, 'order-status').map((s) => s.textContent?.trim())).toEqual(['supplier_submitted', 'supplier_failed']);
  });

  it('filters by status and search', async () => {
    const { fixture, api } = await setUp();
    expect(api.orders).toHaveBeenLastCalledWith({ skip: 0, take: 20 });

    setValue(el(fixture, 'status-select'), 'supplier_failed');
    await waitUntil(fixture, () => api.orders.mock.lastCall?.[0].status === 'supplier_failed');
    setValue(el(fixture, 'search-input'), 'PS-1');
    el<HTMLButtonElement>(fixture, 'search-button')!.click();
    await waitUntil(fixture, () => api.orders.mock.lastCall?.[0].search === 'PS-1');

    expect(api.orders).toHaveBeenLastCalledWith({ skip: 0, take: 20, status: 'supplier_failed', search: 'PS-1' });
  });
});
