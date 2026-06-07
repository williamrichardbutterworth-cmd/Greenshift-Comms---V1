import { config } from '../../config';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import type { AIProvider } from './types';

let cached: AIProvider | null = null;

/**
 * Returns the configured AI engine (Claude or OpenAI).
 * Throws if the selected provider has no API key — callers should catch this
 * and degrade gracefully (show a "set up AI" hint rather than crash).
 */
export function getAI(): AIProvider {
  if (cached) return cached;
  cached = config.aiProvider === 'openai' ? new OpenAIProvider() : new ClaudeProvider();
  return cached;
}

export type { AIProvider, AIGenerateOptions } from './types';
