import { RateLimiter } from './rate-limiter';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => (t += ms),
  };
}

describe('RateLimiter (injected clock)', () => {
  it('rejects invalid rates', () => {
    expect(() => new RateLimiter({ requestsPerSecond: 0 })).toThrow();
    expect(() => new RateLimiter({ requestsPerSecond: 1, burst: 0 })).toThrow();
  });

  it('lets the first call through and spaces the next at 1/rate', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ requestsPerSecond: 2, now: c.now, sleep: c.sleep });
    const stamps: number[] = [];
    for (let i = 0; i < 4; i++) {
      await rl.acquire();
      stamps.push(c.now());
    }
    expect(stamps).toEqual([0, 500, 1000, 1500]);
  });

  it('allows a burst up to capacity then throttles', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ requestsPerSecond: 1, burst: 3, now: c.now, sleep: c.sleep });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(c.sleeps).toEqual([]);
    await rl.acquire();
    expect(c.sleeps).toEqual([1000]);
  });

  it('refills over idle time but never above capacity', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ requestsPerSecond: 1, burst: 2, now: c.now, sleep: c.sleep });
    await rl.acquire();
    await rl.acquire();
    c.advance(60_000);
    await rl.acquire();
    await rl.acquire();
    expect(c.sleeps).toEqual([]);
    await rl.acquire();
    expect(c.sleeps).toEqual([1000]);
  });

  it('serialises concurrent callers', async () => {
    const c = fakeClock();
    const rl = new RateLimiter({ requestsPerSecond: 5, now: c.now, sleep: c.sleep });
    const stamps: number[] = [];
    await Promise.all(
      [1, 2, 3].map(async () => {
        await rl.acquire();
        stamps.push(c.now());
      }),
    );
    expect(stamps).toEqual([0, 200, 400]);
  });
});

describe('RateLimiter (jest fake timers)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('spaces calls using real timers under fake time', async () => {
    const rl = new RateLimiter({ requestsPerSecond: 2 });
    const done: number[] = [];
    const start = Date.now();
    const p = (async () => {
      for (let i = 0; i < 3; i++) {
        await rl.acquire();
        done.push(Date.now() - start);
      }
    })();
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    expect(done).toEqual([0, 500, 1000]);
  });
});
