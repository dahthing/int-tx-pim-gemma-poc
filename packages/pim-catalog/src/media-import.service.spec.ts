import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { MediaImportService } from './media-import.service';
import { createMockDb, MockDb } from './testing/mock-db.types';
import type { ISourceConnector } from '@repo/connector-contracts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('MediaImportService', () => {
  let mock: MockDb;
  let service: MediaImportService;
  let connector: { listMedia: jest.Mock };
  let downloader: { download: jest.Mock };
  let storage: InMemoryObjectStorage;
  const files: Record<string, Buffer> = { 'http://aw/1.jpg': Buffer.from('one'), 'http://aw/2.png': Buffer.from('two'), 'http://aw/3.jpg': Buffer.from('one') };

  beforeEach(() => {
    const m = createMockDb();
    mock = m.mock;
    storage = new InMemoryObjectStorage('https://cdn.test');
    connector = {
      listMedia: jest.fn().mockResolvedValue([
        { uuid: 'u1', name: '1', mimeType: 'image/jpeg', url: 'http://aw/1.jpg' },
        { uuid: 'u2', name: '2', mimeType: 'image/png', url: 'http://aw/2.png' },
        { uuid: 'u3', name: '3', mimeType: 'image/jpeg', url: 'http://aw/3.jpg' },
      ]),
    };
    downloader = { download: jest.fn(async (url: string) => ({ data: files[url]!, mime: url.endsWith('png') ? 'image/png' : 'image/jpeg' })) };
    mock.product.findFirst.mockResolvedValue({ id: 'p1', supplierProduct: { externalId: 'E1' } });
    mock.productMedia.findMany.mockResolvedValue([]);
    mock.productMedia.upsert.mockResolvedValue({});
    service = new MediaImportService(m.db, connector as unknown as ISourceConnector, storage, downloader);
  });

  it('downloads, stores, checksums, dedupes and keeps API order', async () => {
    const res = await service.importForProduct('t1', 'p1');
    expect(mock.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: 't1' });
    expect(connector.listMedia).toHaveBeenCalledWith({ kind: 'product', id: 'E1' });
    expect(res).toEqual({ imported: 2, skipped: 1, failed: 0 });
    const calls = mock.productMedia.upsert.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({
      where: { productId_sourceUrl: { productId: 'p1', sourceUrl: 'http://aw/1.jpg' } },
      create: { tenantId: 't1', productId: 'p1', sourceUrl: 'http://aw/1.jpg', position: 0, checksum: sha(files['http://aw/1.jpg']!), mime: 'image/jpeg', storageKey: `t1/p1/${sha(files['http://aw/1.jpg']!)}.jpg` },
    });
    expect(calls[1].create.position).toBe(1);
    expect(calls[1].create.storageKey.endsWith('.png')).toBe(true);
    expect(storage.objects.size).toBe(2);
  });

  it('skips files already stored for the product (checksum dedupe across runs)', async () => {
    mock.productMedia.findMany.mockResolvedValue([{ checksum: sha(files['http://aw/1.jpg']!) }]);
    const res = await service.importForProduct('t1', 'p1');
    expect(res).toEqual({ imported: 1, skipped: 2, failed: 0 });
  });

  it('counts download failures and continues', async () => {
    downloader.download.mockRejectedValueOnce(new Error('404'));
    const res = await service.importForProduct('t1', 'p1');
    expect(res.failed).toBe(1);
    expect(res.imported).toBe(2);
  });

  it('uses a default extension for unknown mime types', async () => {
    connector.listMedia.mockResolvedValue([{ uuid: 'u', name: 'x', mimeType: 'x/y', url: 'http://aw/1.jpg' }]);
    downloader.download.mockResolvedValue({ data: Buffer.from('z'), mime: 'application/x-unknown' });
    await service.importForProduct('t1', 'p1');
    expect(mock.productMedia.upsert.mock.calls[0][0].create.storageKey.endsWith('.bin')).toBe(true);
  });

  it('falls back to the product id when it has no supplier product', async () => {
    mock.product.findFirst.mockResolvedValue({ id: 'p1', supplierProduct: null });
    const res = await service.importForProduct('t1', 'p1');
    expect(res).toEqual({ imported: 0, skipped: 0, failed: 0 });
    expect(connector.listMedia).not.toHaveBeenCalled();
  });

  it('throws when the product is unknown', async () => {
    mock.product.findFirst.mockResolvedValue(null);
    await expect(service.importForProduct('t1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('channelUrls returns our storage urls in position order, never AW urls', async () => {
    mock.productMedia.findMany.mockResolvedValue([
      { storageKey: 'k1', sourceUrl: 'http://aw/1.jpg' },
      { storageKey: null, sourceUrl: 'http://aw/x.jpg' },
      { storageKey: 'k2', sourceUrl: 'http://aw/2.jpg' },
    ]);
    const urls = await service.channelUrls('t1', 'p1');
    expect(mock.productMedia.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', productId: 'p1' }, orderBy: { position: 'asc' } });
    expect(urls).toEqual(['https://cdn.test/k1', 'https://cdn.test/k2']);
  });

  it('in-memory storage default base url', () => {
    expect(new InMemoryObjectStorage().publicUrl('a/b')).toBe('https://storage.local/a/b');
  });
});
