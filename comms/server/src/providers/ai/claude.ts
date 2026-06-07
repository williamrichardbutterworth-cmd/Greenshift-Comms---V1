import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import type { AIProvider, AIGenerateOptions } from './types';
import { extractJSON } from './json';

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  private client: Anthropic;

  constructor() {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (AI_PROVIDER=claude).');
    }
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async generateText(opts: AIGenerateOptions): Promise<string> {
    // Note: Claude Opus 4.7/4.8 removed the sampling params (temperature/top_p/
    // top_k) — sending them returns a 400. Steer via the prompt instead. Older
    // models simply fall back to their default sampling, so omitting it is safe
    // across every supported model.
    const msg = await this.client.messages.create({
      model: config.claudeModel,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
    });
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .trim();
  }

  async generateJSON<T>(opts: AIGenerateOptions): Promise<T> {
    const system =
      (opts.system ? opts.system + '\n\n' : '') +
      'Respond with ONLY valid JSON. No markdown, no code fences, no commentary.';
    const text = await this.generateText({ ...opts, system });
    return extractJSON<T>(text);
  }
}
