import type { DatabaseService } from '@repo/database';

type Method =
  | 'findUnique'
  | 'findFirst'
  | 'findMany'
  | 'create'
  | 'createMany'
  | 'update'
  | 'updateMany'
  | 'upsert'
  | 'delete'
  | 'deleteMany'
  | 'count'
  | 'groupBy';
export type MockModel = Record<Method, jest.Mock>;
export type ModelName =
  | 'tenant'
  | 'supplier'
  | 'supplierProduct'
  | 'supplierAssortmentItem'
  | 'product'
  | 'productMedia'
  | 'category'
  | 'categoryMapping'
  | 'channel'
  | 'channelListing'
  | 'channelOrder'
  | 'supplierOrder'
  | 'shipment'
  | 'syncRun'
  | 'priceRule'
  | 'auditEvent'
  | 'integrationRequestLog';
export type MockDb = Record<ModelName, MockModel> & { $transaction: jest.Mock };

/** Auto-creating jest mock of DatabaseService: db.model.method is a jest.fn(). */
export function createMockDb(): { db: DatabaseService; mock: MockDb } {
  const models: Record<string, MockModel | jest.Mock> = {
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(mock)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const mock = new Proxy(models, {
    get(target, model: string) {
      return (target[model] ??= new Proxy({} as unknown as MockModel, {
        get(m, method: string) {
          const r = m as unknown as Record<string, jest.Mock>;
          return (r[method] ??= jest.fn());
        },
      }));
    },
  }) as unknown as MockDb;
  return { db: mock as unknown as DatabaseService, mock };
}
