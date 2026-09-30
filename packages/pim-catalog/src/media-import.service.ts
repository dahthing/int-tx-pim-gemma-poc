import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@repo/database';
import type { ISourceConnector } from '@repo/connector-contracts';
import { MEDIA_DEFAULT_EXTENSION, PIM_TOKENS } from './constants';
import type { MediaDownloader, ObjectStorage } from './ports';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface MediaImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class MediaImportService {
  private readonly logger = new Logger(MediaImportService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(PIM_TOKENS.SOURCE_CONNECTOR) private readonly connector: ISourceConnector,
    @Inject(PIM_TOKENS.OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PIM_TOKENS.MEDIA_DOWNLOADER) private readonly downloader: MediaDownloader,
  ) {}

  async importForProduct(tenantId: string, productId: string): Promise<MediaImportResult> {
    const product = await this.db.product.findFirst({ where: { id: productId, tenantId }, include: { supplierProduct: true } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    const out: MediaImportResult = { imported: 0, skipped: 0, failed: 0 };
    if (!product.supplierProduct) return out;

    const media = await this.connector.listMedia({ kind: 'product', id: product.supplierProduct.externalId });
    const existing = await this.db.productMedia.findMany({ where: { tenantId, productId }, select: { checksum: true } });
    const checksums = new Set(existing.map((m) => m.checksum).filter((c): c is string => !!c));

    for (const [position, m] of media.entries()) {
      try {
        const { data, mime } = await this.downloader.download(m.url);
        const checksum = createHash('sha256').update(data).digest('hex');
        if (checksums.has(checksum)) {
          out.skipped++;
          continue;
        }
        const key = `${tenantId}/${productId}/${checksum}.${EXTENSIONS[mime] ?? MEDIA_DEFAULT_EXTENSION}`;
        await this.storage.put(key, data, mime);
        const values = { storageKey: key, mime, position, checksum };
        await this.db.productMedia.upsert({
          where: { productId_sourceUrl: { productId, sourceUrl: m.url } },
          update: values,
          create: { tenantId, productId, sourceUrl: m.url, ...values },
        });
        checksums.add(checksum);
        out.imported++;
      } catch (e) {
        out.failed++;
        this.logger.warn(`media ${m.url} failed: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** URLs handed to channels: always our storage, never the supplier hotlink. */
  async channelUrls(tenantId: string, productId: string): Promise<string[]> {
    const media = await this.db.productMedia.findMany({ where: { tenantId, productId }, orderBy: { position: 'asc' } });
    return media.filter((m) => !!m.storageKey).map((m) => this.storage.publicUrl(m.storageKey as string));
  }
}
