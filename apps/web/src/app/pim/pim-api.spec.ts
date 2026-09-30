import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PimApi } from './pim-api';
import { order, page, supplierProduct } from './testing/fixtures';

function setUp() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { api: TestBed.inject(PimApi), http: TestBed.inject(HttpTestingController) };
}

describe('PimApi', () => {
  it('sends list filters as query params and drops blank ones', async () => {
    const { api, http } = setUp();
    const result = api.supplierProducts({ skip: 20, take: 20, search: 'ame', department: undefined, family: '' });

    const req = http.expectOne((r) => r.url === '/api/v1/supplier-products');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('skip')).toBe('20');
    expect(req.request.params.get('search')).toBe('ame');
    expect(req.request.params.has('department')).toBe(false);
    expect(req.request.params.has('family')).toBe(false);
    req.flush(page([supplierProduct()]));

    expect((await result).items[0].name).toBe('Amethyst cluster');
  });

  it('re-parses the response through the shared schema and rejects a malformed payload', async () => {
    const { api, http } = setUp();
    const result = api.supplierProducts({});
    http.expectOne((r) => r.url === '/api/v1/supplier-products').flush({ items: [{ id: 1 }], meta: {} });

    await expect(result).rejects.toThrow();
  });

  it('posts the manual tracking body to the order tracking route', async () => {
    const { api, http } = setUp();
    const result = api.submitTracking('o1', { carrierCode: 'ctt', trackingNumber: 'T1' });

    const req = http.expectOne('/api/v1/orders/o1/tracking');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ carrierCode: 'ctt', trackingNumber: 'T1' });
    req.flush({ shipmentId: 's1', pushed: true, idempotent: false });

    expect((await result).shipmentId).toBe('s1');
  });

  it('parses an order list page', async () => {
    const { api, http } = setUp();
    const result = api.orders({ status: 'supplier_submitted' });
    const req = http.expectOne((r) => r.url === '/api/v1/orders');
    expect(req.request.params.get('status')).toBe('supplier_submitted');
    req.flush(page([order()]));
    expect((await result).items[0].id).toBe('o1');
  });
});
