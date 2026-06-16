// One small interface every AI engine implements. Nothing else in the app
// talks to Anthropic/OpenAI directly — it all goes through this. That is how
// we stay vendor-neutral and can switch engines from a single env var.
/** An image to send alongside the prompt (for vision extraction). */
export interface AIImage {
  /** Base64-encoded bytes (no data: prefix). */
  base64: string;
  /** MIME type, e.g. image/png, image/jpeg, image/webp, image/gif. */
  mime: string;
}

export interface AIGenerateOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional images for multimodal prompts (screenshot extraction). */
  images?: AIImage[];
}

export interface AIProvider {
  readonly name: string;
  generateText(opts: AIGenerateOptions): Promise<string>;
  generateJSON<T = unknown>(opts: AIGenerateOptions): Promise<T>;
}
