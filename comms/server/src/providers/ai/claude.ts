import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import type { AIProvider, AIGenerateOptions } from './types';
import { extractJSON } from './json';

// Anthropic accepts only these image media types; anything else (e.g. a generic
// octet-stream) is normalised to PNG, which the API tolerates for screenshots.
type ClaudeMedia = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
function claudeMediaType(mime: string): ClaudeMedia {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'image/jpeg';
  if (m.includes('gif')) return 'image/gif';
  if (m.includes('webp')) return 'image/webp';
  return 'image/png';
}

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
    // Note: Claude Fable 5 / Opus 4.7+ removed the sampling params (temperature/
    // top_p/top_k) — sending them returns a 400. Fable 5 also rejects an explicit
    // thinking:{type:'disabled'}, so the thinking param must stay omitted entirely.
    // Steer via the prompt instead; older models fall back to default sampling.
    const images = opts.images ?? [];
    const content = images.length
      ? [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: claudeMediaType(img.mime), data: img.base64 },
          })),
          { type: 'text' as const, text: opts.prompt },
        ]
      : opts.prompt;
    const msg = await this.client.messages.create({
      model: config.claudeModel,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content }],
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
