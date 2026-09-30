import { HttpStatusError, type HttpResponse, type ResilientHttpClient } from '@repo/http-client';
import {
  DEFAULT_ADMIN_PREFIX, DEFAULT_ROUTING, DEFAULT_TOKEN_PATH, DEFAULT_WS_PREFIX, DIALECTS,
  type Dialect, type ListQuery, type Raw, type Resource, type TransportKind,
} from './endpoints';
import type { PrestaShop9Settings } from './settings';
import { TokenProvider } from './token-provider';

/** What the connector sees; it never knows whether Admin API or Webservice answers. */
export interface ResourceTransport {
  readonly kind: TransportKind;
  list(resource: Resource, q?: ListQuery): Promise<Raw[]>;
  get(resource: Resource, id: string): Promise<Raw>;
  create(resource: Resource, data: Raw): Promise<Raw>;
  update(resource: Resource, id: string, data: Raw): Promise<Raw>;
  remove(resource: Resource, id: string): Promise<void>;
  listImages(productId: string): Promise<string[]>;
  addImage(productId: string, url: string): Promise<void>;
  removeImage(productId: string, imageId: string): Promise<void>;
}

class HttpResourceTransport implements ResourceTransport {
  constructor(
    private readonly dialect: Dialect,
    private readonly http: ResilientHttpClient,
    private readonly auth: () => Promise<string>,
    private readonly onUnauthorized?: () => void,
  ) {}

  get kind(): TransportKind {
    return this.dialect.kind;
  }

  private async call(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<HttpResponse> {
    const send = async () =>
      this.http.request(method, path, { query, body, headers: { authorization: await this.auth(), accept: 'application/json' } });
    try {
      return await send();
    } catch (e) {
      if (this.onUnauthorized && e instanceof HttpStatusError && e.status === 401) {
        this.onUnauthorized();
        return send();
      }
      throw e;
    }
  }

  private parse(res: HttpResponse): unknown {
    return res.text.trim() ? res.json() : {};
  }

  async list(resource: Resource, q: ListQuery = {}): Promise<Raw[]> {
    const res = await this.call('GET', this.dialect.path(resource), this.dialect.query(q));
    return this.dialect.unwrapList(resource, this.parse(res));
  }
  async get(resource: Resource, id: string): Promise<Raw> {
    const res = await this.call('GET', this.dialect.path(resource, id), this.dialect.query({}));
    return this.dialect.unwrapOne(resource, this.parse(res));
  }
  async create(resource: Resource, data: Raw): Promise<Raw> {
    const res = await this.call('POST', this.dialect.path(resource), this.dialect.query({}), this.dialect.wrapBody(resource, data));
    return this.dialect.unwrapOne(resource, this.parse(res));
  }
  async update(resource: Resource, id: string, data: Raw): Promise<Raw> {
    const merged = this.dialect.mergeOnUpdate ? { ...(await this.get(resource, id)), ...data } : data;
    const res = await this.call(this.dialect.updateMethod, this.dialect.path(resource, id), this.dialect.query({}), this.dialect.wrapBody(resource, merged));
    return this.dialect.unwrapOne(resource, this.parse(res));
  }
  async remove(resource: Resource, id: string): Promise<void> {
    await this.call('DELETE', this.dialect.path(resource, id), this.dialect.query({}));
  }
  async listImages(productId: string): Promise<string[]> {
    const res = await this.call('GET', this.dialect.imagesPath(productId), this.dialect.query({}));
    return this.dialect.imageIds(this.parse(res));
  }
  async addImage(productId: string, url: string): Promise<void> {
    await this.call('POST', this.dialect.imagesPath(productId), this.dialect.query({}), this.dialect.imageBody(url));
  }
  async removeImage(productId: string, imageId: string): Promise<void> {
    await this.call('DELETE', this.dialect.imagesPath(productId, imageId), this.dialect.query({}));
  }
}

export class TransportRouter {
  readonly routing: Record<Resource, TransportKind>;
  private readonly transports = new Map<TransportKind, ResourceTransport>();

  constructor(settings: PrestaShop9Settings, http: ResilientHttpClient, now?: () => number) {
    this.routing = { ...DEFAULT_ROUTING, ...settings.routing };
    const kinds = new Set(Object.values(this.routing));
    const dialects = DIALECTS({
      admin: settings.adminApi?.basePath ?? DEFAULT_ADMIN_PREFIX,
      ws: settings.webservice?.basePath ?? DEFAULT_WS_PREFIX,
    });
    if (kinds.has('admin-api')) {
      const a = settings.adminApi;
      if (!a) throw new Error('Routing requires the admin-api transport but settings.adminApi is missing');
      const tokens = new TokenProvider({
        http,
        tokenUrl: a.tokenUrl ?? `${settings.baseUrl.replace(/\/+$/, '')}${a.basePath ?? DEFAULT_ADMIN_PREFIX}${DEFAULT_TOKEN_PATH}`,
        clientId: a.clientId, clientSecret: a.clientSecret, scopes: a.scopes, now,
      });
      this.transports.set('admin-api', new HttpResourceTransport(dialects.get('admin-api'), http, async () => `Bearer ${await tokens.getToken()}`, () => tokens.invalidate()));
    }
    if (kinds.has('webservice')) {
      const w = settings.webservice;
      if (!w) throw new Error('Routing requires the webservice transport but settings.webservice is missing');
      const basic = `Basic ${Buffer.from(`${w.key}:`).toString('base64')}`;
      this.transports.set('webservice', new HttpResourceTransport(dialects.get('webservice'), http, async () => basic));
    }
  }

  for(resource: Resource): ResourceTransport {
    return this.transports.get(this.routing[resource])!;
  }
}
