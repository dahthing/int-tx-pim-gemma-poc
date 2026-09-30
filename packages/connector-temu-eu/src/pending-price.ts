export interface PendingPrice {
  externalId: string;
  priceNet: string;
  since: Date;
}

/** Persistence seam: the default is in-memory; the app can back it with a table. */
export interface PendingPriceStore {
  isPending(externalId: string): boolean;
  markPending(externalId: string, priceNet: string, since: Date): void;
  resolve(externalId: string): void;
  get(externalId: string): PendingPrice | undefined;
  pendingIds(): string[];
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
