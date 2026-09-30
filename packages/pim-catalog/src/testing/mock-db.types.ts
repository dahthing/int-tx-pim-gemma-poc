import type { DatabaseService } from '@repo/database';

type Model =
  | 'syncRun' | 'supplierProduct' | 'supplierAssortmentItem' | 'product' | 'productMedia' | 'category'
  | 'categoryMapping' | 'channel' | 'channelListing' | 'priceRule' | 'auditEvent';
type Method = 'findUnique' | 'findFirst' | 'findMany' | 'create' | 'update' | 'updateMany' | 'upsert' | 'delete';
export type MockModel = Record<Method, jest.Mock>;
export type MockDb = Record<Model, MockModel>;

/** Auto-creating jest mock of DatabaseService: db.model.method is a jest.fn(). */
export function createMockDb(): { db: DatabaseService; mock: MockDb } {
  const models = {} as Record<string, MockModel>;
  const mock = new Proxy(models, {
    get(target, model: string) {
      return (target[model] ??= new Proxy({} as unknown as MockModel, {
        get(m, method: string) {
          const r = m as unknown as Record<string, jest.Mock>;
          return (r[method] ??= jest.fn());
        },
      }));
    },
  });
  return { db: mock as unknown as DatabaseService, mock: mock as unknown as MockDb };
}
