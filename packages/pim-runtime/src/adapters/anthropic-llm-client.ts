import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redactText } from '@repo/http-client';
import type { LlmClient, LlmRequest, LlmResponse } from '@repo/pim-catalog';
import { RUNTIME_CONFIG, RUNTIME_DEFAULTS } from '../runtime.constants';

export type LlmFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

interface MessagesResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic Messages API behind the `LlmClient` port. Key and model come from ConfigService; the key is never logged or thrown. */
@Injectable()
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: LlmFetch = (u, i) => globalThis.fetch(u, i),
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = this.config.getOrThrow<string>(RUNTIME_CONFIG.LLM_API_KEY);
    const model = this.config.getOrThrow<string>(RUNTIME_CONFIG.LLM_MODEL);
    const base = (
      this.config.get<string>(RUNTIME_CONFIG.LLM_BASE_URL) ??
      RUNTIME_DEFAULTS.LLM_BASE_URL
    ).replace(/\/+$/, '');
    const maxTokens = Number(
      this.config.get<string>(RUNTIME_CONFIG.LLM_MAX_TOKENS) ??
        RUNTIME_DEFAULTS.LLM_MAX_TOKENS,
    );
    const scrub = (text: string): string =>
      redactText(text.split(apiKey).join('[REDACTED]'));

    let res: Awaited<ReturnType<LlmFetch>>;
    try {
      res = await this.fetchImpl(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': RUNTIME_DEFAULTS.ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
        signal: AbortSignal.timeout(RUNTIME_DEFAULTS.LLM_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(
        `LLM request failed: ${scrub(e instanceof Error ? e.message : String(e))}`,
      );
    }
    const raw = await res.text();
    if (!res.ok)
      throw new Error(
        `LLM request failed with HTTP ${res.status}: ${scrub(raw).slice(0, 300)}`,
      );
    const body = JSON.parse(raw) as MessagesResponse;
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    if (!text) throw new Error('LLM returned an empty response');
    return {
      text,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        model: body.model ?? model,
      },
    };
  }
}
