import type { ChannelOrderRaw } from '@repo/connector-contracts';
import { decryptCredentials, encryptCredentials } from './credentials';
import { buildOrderImport } from './order-import';
import { decryptStoredPii, encryptOrderForStorage } from './pii';

const key = Buffer.alloc(32, 7);
const order = (over: Partial<ChannelOrderRaw> = {}): ChannelOrderRaw => ({
  externalId: 'PO-1',
  externalStatus: 'AWAITING_SHIPMENT',
  placedAt: new Date('2026-05-01T10:00:00Z'),
  currency: 'EUR',
  total: '20.00',
  shipByAt: new Date('2026-05-04T10:00:00Z'),
  customer: { name: 'Ana Silva', email: 'ana@x.com', phone: '+351900000000' },
  shippingAddress: {
    fullName: 'Ana Silva',
    line1: 'Rua das Flores 12',
    postalCode: '1000-001',
    city: 'Lisboa',
    countryCode: 'PT',
  },
  lines: [{ sku: 'AAL-07', quantity: 2, unitPrice: '10.00' }],
  ...over,
});

describe('PII encryption before persistence', () => {
  it('stored form carries no plaintext PII and round-trips', () => {
    const stored = encryptOrderForStorage(order(), key);
    const json = JSON.stringify(stored);
    for (const pii of ['Ana', 'ana@x.com', '900000000', 'Flores', '1000-001', 'Lisboa']) {
      expect(json).not.toContain(pii);
    }
    expect(stored.externalId).toBe('PO-1');
    expect(stored.lines).toHaveLength(1);
    expect(decryptStoredPii(stored.piiCiphertext, key)).toEqual({
      customer: order().customer,
      shippingAddress: order().shippingAddress,
    });
  });
  it('wrong key fails', () => {
    const stored = encryptOrderForStorage(order(), key);
    expect(() => decryptStoredPii(stored.piiCiphertext, Buffer.alloc(32, 1))).toThrow();
  });
});

describe('credentials at rest', () => {
  it('round-trips and is not plaintext', () => {
    const creds = { appKey: 'k', appSecret: 'super-secret', accessToken: 'tok' };
    const enc = encryptCredentials(creds, key);
    expect(JSON.stringify(enc)).not.toContain('super-secret');
    expect(decryptCredentials(enc, key)).toEqual(creds);
  });
});

describe('buildOrderImport', () => {
  const opts = { minMargin: '0.15', seenExternalIds: new Set<string>() };
  it('imports a new order with max supplier cost and idempotency key', () => {
    const r = buildOrderImport(order(), opts);
    expect(r.action).toBe('import');
    if (r.action !== 'import') throw new Error();
    expect(r.idempotencyKey).toBe('temu-eu:PO-1');
    expect(r.command.channelCode).toBe('TEMU');
    expect(r.command.channelOrderId).toBe('PO-1');
    expect(r.command.maxSupplierCost).toBe('17.00');
    expect(r.command.recipient.fullName).toBe('Ana Silva');
    expect(r.command.recipient.email).toBe('ana@x.com');
    expect(r.command.recipient.phone).toBe('+351900000000');
    expect(r.command.lines).toEqual([{ externalPortfolioId: 'AAL-07', quantity: 2 }]);
    expect(r.shipByAt).toEqual(new Date('2026-05-04T10:00:00Z'));
  });
  it('skips already-seen orders (idempotent)', () => {
    expect(buildOrderImport(order(), { ...opts, seenExternalIds: new Set(['PO-1']) })).toEqual({
      action: 'skip',
      reason: 'already_imported',
      idempotencyKey: 'temu-eu:PO-1',
    });
  });
  it('skips orders not awaiting shipment', () => {
    expect(buildOrderImport(order({ externalStatus: 'SHIPPED' }), opts).action).toBe('skip');
  });
  it('uses tenant defaults for missing contact data and null shipBy', () => {
    const r = buildOrderImport(order({ customer: { name: 'A' }, shipByAt: null }), {
      ...opts,
      tenantDefaults: { email: 'd@t.com', phone: '1' },
    });
    if (r.action !== 'import') throw new Error();
    expect(r.command.recipient.email).toBe('d@t.com');
    expect(r.command.tenantDefaults).toEqual({ email: 'd@t.com', phone: '1' });
    expect(r.shipByAt).toBeNull();
  });
  it('honours shipping and fee', () => {
    const r = buildOrderImport(order(), { ...opts, shippingAbsorbed: '2', channelFee: '1' });
    if (r.action !== 'import') throw new Error();
    expect(r.command.maxSupplierCost).toBe('14.00');
  });
});
