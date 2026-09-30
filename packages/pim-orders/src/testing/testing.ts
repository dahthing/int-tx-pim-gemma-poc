import { encryptSecret } from '@repo/core-domain';
import type { DatabaseService } from '@repo/database';

export const TEST_KEY = Buffer.alloc(32, 7);
export const TENANT = 'tenant-1';

type Fn = jest.Mock;
const model = <K extends string>(...names: K[]): Record<K, Fn> =>
  Object.fromEntries(names.map((n) => [n, jest.fn()])) as Record<K, Fn>;

export function createDbMock() {
  return {
    channel: model('findFirst', 'update'),
    channelOrder: model('findFirst', 'findMany', 'findUnique', 'create', 'update', 'updateMany'),
    product: model('findMany'),
    supplierOrder: model('upsert', 'findFirst', 'findMany', 'update'),
    supplierAssortmentItem: model('findMany'),
    shipment: model('findFirst', 'findMany', 'create', 'update'),
    channelListing: model('findMany', 'findFirst', 'upsert', 'update', 'updateMany'),
  };
}
export type DbMock = ReturnType<typeof createDbMock>;
export const asDb = (m: DbMock): DatabaseService => m as unknown as DatabaseService;

export const keyProvider = { getKey: jest.fn().mockResolvedValue(TEST_KEY) };

export const PII = {
  customer: { name: 'Maria Silva', email: 'maria@example.com', phone: '+351900000000' },
  shippingAddress: { fullName: 'Maria Silva', line1: 'Rua A 1', postalCode: '1000-001', city: 'Lisboa', countryCode: 'PT' },
};

export const encPii = (v: unknown): string => encryptSecret(JSON.stringify(v), TEST_KEY);
