import type { MarketSnapshot } from '../providers/marketData/types';
import type { NewsItem } from '../providers/news/types';

// All AI prompts live here so the "voice" of the product is in one editable
// place (content/code separation). Keep them tightly scoped and insist on
// accuracy: the model must only use the data/news we pass in.

const HOUSE_RULES = `You are the in-house market analyst for Green Shift Energy, a UK B2B energy
consultancy and third-party intermediary. Your audience is our own sales agents
(lead generation and closers) talking to UK business customers about gas and
electricity procurement.

Hard rules:
- Use ONLY the data and headlines provided. Never invent figures, prices or events.
- Treat all prices as indicative/for-information, not a price quotation.
- This is general market commentary, NOT financial advice.
- Plain, confident English a non-expert business owner can follow. UK spelling.
- Be concise. No hype, no emojis.`;

function snapshotForPrompt(s: MarketSnapshot): string {
  const lines = s.metrics.map(
    (m) =>
      `- ${m.label}: ${m.value ?? 'n/a'} ${m.unit}` +
      (m.changePct != null ? ` (${m.changePct > 0 ? '+' : ''}${m.changePct}% vs prev)` : ''),
  );
  const mix = s.generationMix.map((g) => `${g.fuel} ${g.pct}%`).join(', ');
  return `Market snapshot (as of ${s.asOf}):\n${lines.join('\n')}\nGeneration mix: ${mix}`;
}

function headlinesForPrompt(news: NewsItem[]): string {
  return news
    .slice(0, 10)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.summary ? ' — ' + n.summary : ''}`)
    .join('\n');
}

export function dailyReviewPrompt(snapshot: MarketSnapshot, news: NewsItem[]) {
  return {
    system: HOUSE_RULES,
    prompt: `${snapshotForPrompt(snapshot)}

Today's relevant headlines:
${headlinesForPrompt(news)}

Produce a daily market brief for our agents. Return ONLY JSON in exactly this shape:
{
  "review": "≈140-word plain-English summary: where gas & power moved, the main driver(s), and what it means for a UK business buying energy.",
  "talkingPoints": [
    { "type": "fact",      "text": "a specific, accurate fact an agent can state" },
    { "type": "statement", "text": "a confident positioning statement for a call" },
    { "type": "question",  "text": "an open discovery question that opens up procurement" }
  ],
  "geoHooks": [
    { "headline": "the relevant world/geopolitical event", "angle": "one sentence: how to raise it usefully on a call" }
  ]
}
Provide 3-5 talkingPoints and up to 3 geoHooks. Only include geoHooks that genuinely affect UK energy. Base everything strictly on the data and headlines above.`,
  };
}

export interface ReportInputs {
  clientName?: string;
  companyName?: string;
  contact?: string;
  sites?: string;
  currentSupplier?: string;
  contractEnd?: string;
  consumption?: string;
  agentNotes?: string;
}

export function reportNarrativePrompt(
  inputs: ReportInputs,
  snapshot: MarketSnapshot,
  selectedNews: NewsItem[],
) {
  return {
    system: HOUSE_RULES,
    prompt: `Draft the written sections of a client report for ${inputs.companyName ?? 'the client'}.

Client details:
${JSON.stringify(inputs, null, 2)}

${snapshotForPrompt(snapshot)}

Evidence the agent selected:
${selectedNews.length ? headlinesForPrompt(selectedNews) : '(none selected)'}

Agent's own notes / projections:
${inputs.agentNotes ?? '(none)'}

Return ONLY JSON in this shape (each value is 1-2 short paragraphs of plain prose):
{
  "executiveSummary": "...",
  "marketContext": "... grounded in the snapshot above ...",
  "outlook": "... balanced, no over-promising ...",
  "recommendation": "... what Green Shift suggests and why, tailored to this client ..."
}
Use only the figures and evidence provided. Keep it professional and client-ready. The agent will review and edit before sending.`,
  };
}

export interface IdeaForSummary {
  title: string;
  details?: string;
  reasoning?: string;
  category: string;
  votes: number;
  status: string;
  author: string;
}

export function ideasSummaryPrompt(ideas: IdeaForSummary[]) {
  const list = ideas
    .map(
      (i, n) =>
        `${n + 1}. [${i.category}] "${i.title}" — ${i.votes} vote(s), status: ${i.status}, by ${i.author}.` +
        (i.details ? ` Detail: ${i.details}` : '') +
        (i.reasoning ? ` Why: ${i.reasoning}` : ''),
    )
    .join('\n');
  return {
    system: `You are the product lead for "Comms", Green Shift Energy's internal market-intelligence app.
You triage feature ideas submitted by the team. Be concise, practical and use UK English.
Only use the ideas provided — never invent new ones.`,
    prompt: `Submitted ideas (with vote counts and status):
${list}

Produce a short, skimmable product digest for the admin:
- Group the ideas into 3-5 clear themes.
- For each theme: a one-line summary, the ideas that belong to it, and the combined demand (sum of votes).
- Finish with "Suggested next 3" — the highest-impact, most-requested ideas to action first, one line of rationale each.
Keep it under ~250 words. Use plain text only — UPPERCASE section headings and simple dashes for lists. Do NOT use any markdown symbols (#, *, _ or backticks).`,
  };
}
