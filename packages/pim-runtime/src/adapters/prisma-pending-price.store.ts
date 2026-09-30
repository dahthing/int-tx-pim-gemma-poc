import type { PendingPrice, PendingPriceStore } from '@repo/connector-temu-eu';
import type { DatabaseService } from '@repo/database';

/** FR-TEMU-002 AC3: price changes Temu is still reviewing, persisted so a restart or a new connector cannot re-send them. */
export class PrismaPendingPriceStore implements PendingPriceStore {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenantId: string,
    private readonly channelId: string,
  ) {}

  private key(externalId: string) {
    return { channelId_externalId: { channelId: this.channelId, externalId } };
  }

  async isPending(externalId: string): Promise<boolean> {
    return (await this.db.channelPendingPrice.findUnique({ where: this.key(externalId) })) !== null;
  }

  async markPending(externalId: string, priceNet: string, since: Date): Promise<void> {
    await this.db.channelPendingPrice.upsert({
      where: this.key(externalId),
      create: { tenantId: this.tenantId, channelId: this.channelId, externalId, priceNet, since },
      update: { priceNet, since },
    });
  }

  async resolve(externalId: string): Promise<void> {
    await this.db.channelPendingPrice.deleteMany({
      where: { tenantId: this.tenantId, channelId: this.channelId, externalId },
    });
  }

  async get(externalId: string): Promise<PendingPrice | undefined> {
    const row = await this.db.channelPendingPrice.findUnique({ where: this.key(externalId) });
    return row ? { externalId: row.externalId, priceNet: row.priceNet.toString(), since: row.since } : undefined;
  }

  async pendingIds(): Promise<string[]> {
    const rows = await this.db.channelPendingPrice.findMany({
      where: { tenantId: this.tenantId, channelId: this.channelId },
      select: { externalId: true },
      orderBy: { since: 'asc' },
    });
    return rows.map((r) => r.externalId);
  }
}
