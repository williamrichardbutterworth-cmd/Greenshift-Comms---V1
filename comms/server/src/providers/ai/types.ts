// One small interface every AI engine implements. Nothing else in the app
// talks to Anthropic/OpenAI directly — it all goes through this. That is how
// we stay vendor-neutral and can switch engines from a single env var.
export interface AIGenerateOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  readonly name: string;
  generateText(opts: AIGenerateOptions): Promise<string>;
  generateJSON<T = unknown>(opts: AIGenerateOptions): Promise<T>;
}
