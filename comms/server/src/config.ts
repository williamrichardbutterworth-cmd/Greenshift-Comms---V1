import 'dotenv/config';

function bool(v: string | undefined, fallback = false): boolean {
  if (v == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 8080),

  // AI
  aiProvider: (process.env.AI_PROVIDER ?? 'claude').toLowerCase(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-fable-5',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',

  // Market data
  useLiveMarketData: bool(process.env.USE_LIVE_MARKET_DATA, false),
  elexonBaseUrl: process.env.ELEXON_BASE_URL ?? 'https://data.elexon.co.uk/bmrs/api/v1',
  nationalGasBaseUrl: process.env.NATIONAL_GAS_BASE_URL ?? 'https://data.nationalgas.com',
  oilPriceApiKey: process.env.OILPRICE_API_KEY ?? '',
  oilPriceGasCode: process.env.OILPRICE_GAS_CODE ?? 'NATURAL_GAS_UK',

  // News
  useLiveNews: bool(process.env.USE_LIVE_NEWS, true),
  marketauxApiKey: process.env.MARKETAUX_API_KEY ?? '',
  newsdataApiKey: process.env.NEWSDATA_API_KEY ?? '',
} as const;

export function aiConfigured(): boolean {
  return config.aiProvider === 'openai'
    ? Boolean(config.openaiApiKey)
    : Boolean(config.anthropicApiKey);
}
