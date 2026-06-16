import OpenAI from 'openai';
import { config } from '../../config';
import type { AIProvider, AIGenerateOptions } from './types';
import { extractJSON } from './json';

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set (AI_PROVIDER=openai).');
    }
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async generateText(opts: AIGenerateOptions): Promise<string> {
    const images = opts.images ?? [];
    const userContent = images.length
      ? [
          { type: 'text' as const, text: opts.prompt },
          ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mime || 'image/png'};base64,${img.base64}` } })),
        ]
      : opts.prompt;
    const res = await this.client.chat.completions.create({
      model: config.openaiModel,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: userContent },
      ],
    });
    return (res.choices[0]?.message?.content ?? '').trim();
  }

  async generateJSON<T>(opts: AIGenerateOptions): Promise<T> {
    const images = opts.images ?? [];
    const userContent = images.length
      ? [
          { type: 'text' as const, text: opts.prompt },
          ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mime || 'image/png'};base64,${img.base64}` } })),
        ]
      : opts.prompt;
    const res = await this.client.chat.completions.create({
      model: config.openaiModel,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      response_format: { type: 'json_object' },
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: userContent },
      ],
    });
    return extractJSON<T>(res.choices[0]?.message?.content ?? '');
  }
}
