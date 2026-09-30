import { AnthropicLlmClient } from './anthropic-llm-client';

const config = (over: Record<string, string> = {}) => {
  const all: Record<string, string> = {
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    PIM_LLM_MODEL: 'claude-x',
    ...over,
  };
  return {
    get: jest.fn((k: string) => all[k]),
    getOrThrow: jest.fn((k: string) => {
      if (all[k] === undefined) throw new Error(`missing ${k}`);
      return all[k];
    }),
  };
};
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

describe('AnthropicLlmClient', () => {
  it('calls the Messages API and maps text and usage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      ok({
        model: 'claude-x-2026',
        content: [
          { type: 'text', text: '{"a":' },
          { type: 'text', text: '1}' },
        ],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    );
    const c = new AnthropicLlmClient(config() as never, fetchImpl);
    const r = await c.complete({ system: 'sys', user: 'usr' });
    expect(r).toEqual({
      text: '{"a":1}',
      usage: { inputTokens: 11, outputTokens: 7, model: 'claude-x-2026' },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-secret');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'claude-x',
      system: 'sys',
      max_tokens: 2048,
      messages: [{ role: 'user', content: 'usr' }],
    });
  });

  it('honours a configured base url and max tokens, and falls back to the configured model', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        ok({ content: [{ type: 'text', text: 'x' }], usage: {} }),
      );
    const c = new AnthropicLlmClient(
      config({
        PIM_LLM_BASE_URL: 'https://proxy.local/',
        PIM_LLM_MAX_TOKENS: '100',
      }) as never,
      fetchImpl,
    );
    const r = await c.complete({ system: 's', user: 'u' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://proxy.local/v1/messages');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).max_tokens).toBe(100);
    expect(r.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      model: 'claude-x',
    });
  });

  it('never leaks the API key in errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'bad key sk-ant-secret',
      });
    const c = new AnthropicLlmClient(config() as never, fetchImpl);
    const err = (await c
      .complete({ system: 's', user: 'u' })
      .catch((e: Error) => e)) as Error;
    expect(err.message).toContain('401');
    expect(err.message).not.toContain('sk-ant-secret');
  });

  it('scrubs the key from transport errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new Error('connect sk-ant-secret failed'));
    const err = (await new AnthropicLlmClient(config() as never, fetchImpl)
      .complete({ system: 's', user: 'u' })
      .catch((e: Error) => e)) as Error;
    expect(err.message).not.toContain('sk-ant-secret');
  });

  it('fails when the response has no text', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(ok({ content: [], usage: {} }));
    await expect(
      new AnthropicLlmClient(config() as never, fetchImpl).complete({
        system: 's',
        user: 'u',
      }),
    ).rejects.toThrow(/empty/i);
  });

  it('requires configuration lazily', async () => {
    await expect(
      new AnthropicLlmClient(
        config({ ANTHROPIC_API_KEY: undefined as never }) as never,
        jest.fn(),
      ).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow();
  });
});
