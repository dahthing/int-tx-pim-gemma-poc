export interface RateLimiterOptions {
  requestsPerSecond: number;
  /** Bucket capacity; defaults to 1 (strict spacing). */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Token bucket: refills at `requestsPerSecond`, holds at most `burst` tokens. */
export class RateLimiter {
  private readonly rate: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private tokens: number;
  private last: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: RateLimiterOptions) {
    const { requestsPerSecond, burst = 1 } = opts;
    if (!(requestsPerSecond > 0)) throw new Error('requestsPerSecond must be > 0');
    if (!(burst >= 1)) throw new Error('burst must be >= 1');
    this.rate = requestsPerSecond;
    this.capacity = burst;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.tokens = burst;
    this.last = this.now();
  }

  /** Resolves when a token is available; callers are served in order. */
  acquire(): Promise<void> {
    const run = this.chain.then(() => this.take());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.rate) / 1000);
    this.last = t;
  }

  private async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1 - 1e-9) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000 - 1e-9));
    }
  }
}
