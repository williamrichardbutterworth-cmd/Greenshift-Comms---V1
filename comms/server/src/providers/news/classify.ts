// Lightweight, free, deterministic topic tagging for news items — no AI call on
// every feed load. First matching rule wins (order = priority).

export const NEWS_TOPICS = ['geopolitics', 'policy', 'renewables', 'gas', 'power', 'oil', 'macro'] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number] | 'other';

const RULES: { topic: NewsTopic; kw: RegExp }[] = [
  { topic: 'geopolitics', kw: /\b(war|sanction|hormuz|russia|ukraine|opec\+?|middle east|conflict|tariff|geopolit|embargo|red sea|israel|iran|tanker|strait)\b/i },
  { topic: 'policy', kw: /\b(ofgem|government|policy|net[\s-]?zero|desnz|regulat|subsid|levy|price cap|legislat|parliament|consultation|mandate|budget)\b/i },
  { topic: 'renewables', kw: /\b(wind|solar|renewable|offshore|hydrogen|nuclear|battery|green|interconnector|ccs|carbon capture|ev\b)\b/i },
  { topic: 'gas', kw: /\b(gas|lng|nbp|ttf|pipeline|methane|storage)\b/i },
  { topic: 'power', kw: /\b(power|electricity|grid|generation|demand|capacity|megawatt|mwh|day[\s-]?ahead|elexon)\b/i },
  { topic: 'oil', kw: /\b(oil|brent|crude|wti|barrel|refinery|petrol|diesel|spr)\b/i },
  { topic: 'macro', kw: /\b(inflation|interest rate|economy|gdp|recession|bank of england|federal reserve|markets|sterling|bond yield)\b/i },
];

export function classifyTopic(title: string, summary = ''): NewsTopic {
  const text = `${title} ${summary}`;
  for (const r of RULES) if (r.kw.test(text)) return r.topic;
  return 'other';
}
