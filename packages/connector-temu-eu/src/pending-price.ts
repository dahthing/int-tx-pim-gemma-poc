export interface PendingPrice {
  externalId: string;
  priceNet: string;
  since: Date;
}

type MaybePromise<T> = T | Promise<T>;

/** Persistence seam: the default is in-memory; the runtime backs it with a table (FR-TEMU-002 AC3). */
export interface PendingPriceStore {
  isPending(externalId: string): MaybePromise<boolean>;
  markPending(externalId: string, priceNet: string, since: Date): MaybePromise<void>;
  resolve(externalId: string): MaybePromise<void>;
  get(externalId: string): MaybePromise<PendingPrice | undefined>;
  pendingIds(): MaybePromise<string[]>;
}

export class PendingPriceTracker implements PendingPriceStore {
  private readonly items = new Map<string, PendingPrice>();
  isPending(id: string): boolean {
    return this.items.has(id);
  }
  markPending(externalId: string, priceNet: string, since: Date): void {
    this.items.set(externalId, { externalId, priceNet, since });
  }
  resolve(id: string): void {
    this.items.delete(id);
  }
  get(id: string): PendingPrice | undefined {
    return this.items.get(id);
  }
  pendingIds(): string[] {
    return [...this.items.keys()];
  }
}
