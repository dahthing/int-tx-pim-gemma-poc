export interface FakeStep {
  status?: number;
  /** Objects are JSON-serialised, strings sent as is. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Reject with this error (simulates a network failure). */
  error?: unknown;
  /** Never resolve; reject with AbortError when the signal aborts. */
  hang?: boolean;
}

export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FakeFetch = ((input: string | URL, init?: RequestInit) => Promise<Response>) & {
  calls: FakeCall[];
};

export type FakeHandler = (call: FakeCall, index: number) => FakeStep;

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

/**
 * Builds a fetch replacement. An array is served in order (the last step repeats);
 * a function decides per call. Every call is recorded in `.calls`.
 */
export function createFakeFetch(script: FakeStep[] | FakeHandler): FakeFetch {
  const calls: FakeCall[] = [];
  const fake = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: FakeCall = {
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
      signal: init.signal ?? undefined,
    };
    const index = calls.push(call) - 1;
    let step: FakeStep;
    if (typeof script === 'function') step = script(call, index);
    else if (script.length === 0) throw new Error('createFakeFetch: no more scripted responses');
    else step = script[Math.min(index, script.length - 1)]!;

    if (step.error !== undefined) throw step.error;
    if (step.hang) {
      await new Promise<never>((_, reject) => {
        if (call.signal?.aborted) return reject(abortError());
        call.signal?.addEventListener('abort', () => reject(abortError()));
      });
    }
    const body =
      step.body === undefined
        ? null
        : typeof step.body === 'string'
          ? step.body
          : JSON.stringify(step.body);
    return new Response(body, { status: step.status ?? 200, headers: step.headers });
  };
  return Object.assign(fake, { calls });
}
