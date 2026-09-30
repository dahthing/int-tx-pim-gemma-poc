/**
 * Every endpoint path, query convention and response envelope of PrestaShop 9 lives here.
 * All of it is ASSUMED (see docs/spikes/prestashop9-assumptions.md) until spike S0.10 confirms it.
 */
export type Resource =
  | 'products' | 'stock_availables' | 'orders' | 'order_carriers' | 'order_histories'
  | 'customers' | 'addresses' | 'countries' | 'images' | 'shops';
export type TransportKind = 'admin-api' | 'webservice';

/** Resource -> transport. Default until S0.10 says which resources the Admin API covers. */
export const DEFAULT_ROUTING: Record<Resource, TransportKind> = {
  products: 'admin-api',
  orders: 'admin-api',
  customers: 'admin-api',
  addresses: 'admin-api',
  countries: 'admin-api',
  shops: 'admin-api',
  stock_availables: 'webservice',
  order_carriers: 'webservice',
  order_histories: 'webservice',
  images: 'webservice',
};

export interface ListQuery {
  /** field -> value, or several values (OR). */
  filter?: Record<string, string | string[]>;
  /** date_upd >= value. */
  since?: { field: string; value: string };
  limit?: number;
  offset?: number;
  sort?: string;
}

export type Raw = Record<string, any>;

export interface Dialect {
  readonly kind: TransportKind;
  path(resource: Resource, id?: string): string;
  unwrapList(resource: Resource, body: any): Raw[];
  unwrapOne(resource: Resource, body: any): Raw;
  wrapBody(resource: Resource, data: Raw): unknown;
  query(q: ListQuery): Record<string, string>;
  readonly updateMethod: 'PATCH' | 'PUT';
  /** PUT replaces the whole resource, so the current state is fetched and merged first. */
  readonly mergeOnUpdate: boolean;
  imagesPath(productId: string, imageId?: string): string;
  imageIds(body: any): string[];
  imageBody(url: string): unknown;
}

const SINGULAR: Record<Resource, string> = {
  products: 'product', stock_availables: 'stock_available', orders: 'order', order_carriers: 'order_carrier',
  order_histories: 'order_history', customers: 'customer', addresses: 'address', countries: 'country',
  images: 'image', shops: 'shop',
};
const ADMIN_PATH: Record<Resource, string> = {
  products: 'products', stock_availables: 'stock-availables', orders: 'orders', order_carriers: 'order-carriers',
  order_histories: 'order-histories', customers: 'customers', addresses: 'addresses', countries: 'countries',
  images: 'images', shops: 'shops',
};

export const singular = (r: Resource): string => SINGULAR[r];
export const camelId = (r: Resource): string =>
  SINGULAR[r].replace(/_(\w)/g, (_m, c: string) => c.toUpperCase()) + 'Id';

function filterQuery(q: ListQuery, since: (field: string, value: string) => Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q.filter ?? {})) out[`filter[${k}]`] = `[${Array.isArray(v) ? v.join('|') : v}]`;
  if (q.since) Object.assign(out, since(q.since.field, q.since.value));
  if (q.sort) out.sort = `[${q.sort}]`;
  return out;
}

const adminDialect = (prefix: string): Dialect => ({
  kind: 'admin-api',
  path: (r, id) => `${prefix}/${ADMIN_PATH[r]}${id ? `/${id}` : ''}`,
  unwrapList: (_r, body) => (Array.isArray(body?.items) ? body.items : []),
  unwrapOne: (_r, body) => body,
  wrapBody: (_r, data) => data,
  query: (q) => {
    const out = filterQuery(q, (f, v) => ({ [`filter[${f}]`]: `[${v},2999-12-31 23:59:59]` }));
    if (q.limit !== undefined) out.limit = String(q.limit);
    if (q.offset !== undefined) out.offset = String(q.offset);
    return out;
  },
  updateMethod: 'PATCH',
  mergeOnUpdate: false,
  imagesPath: (p, i) => `${prefix}/products/${p}/images${i ? `/${i}` : ''}`,
  imageIds: (body) => (Array.isArray(body?.items) ? body.items : []).map((x: Raw) => String(x.imageId ?? x.id)),
  imageBody: (url) => ({ url }),
});

const wsDialect = (prefix: string): Dialect => ({
  kind: 'webservice',
  path: (r, id) => `${prefix}/${r}${id ? `/${id}` : ''}`,
  // An empty Webservice collection comes back as [] instead of { <resource>: [] }.
  unwrapList: (r, body) => (Array.isArray(body?.[r]) ? body[r] : []),
  unwrapOne: (r, body) => body?.[SINGULAR[r]] ?? body,
  wrapBody: (r, data) => ({ [SINGULAR[r]]: data }),
  query: (q) => {
    const out: Record<string, string> = { output_format: 'JSON', display: 'full' };
    Object.assign(out, filterQuery(q, (f, v) => ({ [`filter[${f}]`]: `[${v},2999-12-31 23:59:59]`, date: '1' })));
    if (q.limit !== undefined) out.limit = `${q.offset ?? 0},${q.limit}`;
    return out;
  },
  updateMethod: 'PUT',
  mergeOnUpdate: true,
  imagesPath: (p, i) => `${prefix}/images/products/${p}${i ? `/${i}` : ''}`,
  imageIds: (body) => (Array.isArray(body?.image) ? body.image : []).map((x: Raw) => String(x.id)),
  imageBody: (url) => ({ url }),
});

export function DIALECTS(prefixes: { admin: string; ws: string }): { get(kind: TransportKind): Dialect } {
  const admin = adminDialect(prefixes.admin);
  const ws = wsDialect(prefixes.ws);
  return { get: (kind) => (kind === 'admin-api' ? admin : ws) };
}

export const DEFAULT_ADMIN_PREFIX = '/admin-api';
export const DEFAULT_WS_PREFIX = '/api';
export const DEFAULT_TOKEN_PATH = '/access_token';
