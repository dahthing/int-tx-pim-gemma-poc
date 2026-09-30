import type { ChannelListingPayload } from '@repo/connector-contracts';
import { buildProductBody, gramsToKg, parsePsDate, formatPsDate, activeFlag, slugify, normalizeOrder, parseToken } from './mapper';
import { makeSettings } from './__fixtures__/support';

const listing: ChannelListingPayload = {
  sku: 'AAL-07', ean: '5601234567890', title: 'Quartzo', shortDescription: 'curto', descriptionHtml: '<p>d</p>',
  weightG: 19, priceNet: '12.5', vatRate: '0.23', stock: 5, categoryId: '12', attributes: {}, imageUrls: [],
  seoTitle: 'seo t', seoDescription: 'seo d', active: true,
};
const s = makeSettings();

describe('mapper', () => {
  it('converts g to kg', () => {
    expect(gramsToKg(19)).toBe('0.019');
    expect(gramsToKg(1500)).toBe('1.500');
    expect(gramsToKg(0)).toBe('0.000');
  });
  it('webservice body: kg weight, tax excluded price, tax rule group, languages, categories', () => {
    const b: any = buildProductBody('webservice', listing, s);
    expect(b).toMatchObject({ reference: 'AAL-07', ean13: '5601234567890', weight: '0.019', price: '12.5', id_tax_rules_group: '3', id_category_default: '12', active: '1' });
    expect(b.name).toEqual([{ id: '1', value: 'Quartzo' }]);
    expect(b.meta_title).toEqual([{ id: '1', value: 'seo t' }]);
    expect(b.link_rewrite).toEqual([{ id: '1', value: 'quartzo' }]);
    expect(b.associations.categories).toEqual([{ id: '12' }]);
  });
  it('admin body uses native types and localized maps', () => {
    const b: any = buildProductBody('admin-api', { ...listing, active: false, ean: null }, s);
    expect(b).toMatchObject({ reference: 'AAL-07', weight: 0.019, price: 12.5, taxRulesGroupId: 3, defaultCategoryId: 12, active: false, categoryIds: [12] });
    expect(b.localizedNames).toEqual({ 1: 'Quartzo' });
    expect('ean13' in b).toBe(false);
  });
  it('omits optional descriptions when absent', () => {
    const b: any = buildProductBody('webservice', { ...listing, shortDescription: undefined, seoTitle: undefined, seoDescription: undefined }, s);
    expect('description_short' in b).toBe(false);
    expect('meta_title' in b).toBe(false);
  });
  it('rejects a non numeric price', () => {
    expect(() => buildProductBody('webservice', { ...listing, priceNet: 'abc' }, s)).toThrow(/price/i);
  });
  it('slugify and active flag', () => {
    expect(slugify('Pedra Ágata & Co!')).toBe('pedra-agata-co');
    expect(slugify('***')).toBe('product');
    expect(activeFlag('webservice', true)).toBe('1');
    expect(activeFlag('admin-api', false)).toBe(false);
  });
  it('date helpers treat PrestaShop dates as UTC', () => {
    expect(parsePsDate('2026-09-01 10:15:00').toISOString()).toBe('2026-09-01T10:15:00.000Z');
    expect(formatPsDate(new Date('2026-09-01T10:15:00Z'))).toBe('2026-09-01 10:15:00');
    expect(parsePsDate('0000-00-00 00:00:00').getTime()).toBe(0);
  });
  it('normalizeOrder tolerates missing rows', () => {
    expect(normalizeOrder('webservice', { id: 1, current_state: 2, date_add: '2026-09-01 10:15:00', associations: {} }).lines).toEqual([]);
    expect(normalizeOrder('admin-api', { orderId: 1, currentState: 2, dateAdd: '2026-09-01 10:15:00' }).lines).toEqual([]);
  });
  it('parseToken rejects a body without access_token', () => {
    expect(() => parseToken({ error: 'x' })).toThrow(/access_token/);
    expect(parseToken({ access_token: 'a' }).expiresInSec).toBe(3600);
  });
});
