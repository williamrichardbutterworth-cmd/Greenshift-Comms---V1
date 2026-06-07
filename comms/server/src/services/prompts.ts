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

// ── Report assembly (§8B): AI returns an ordered section list, never raw doc ──

export interface AssembleNews { source: string; title: string; summary?: string }
export interface AssembleCustomChart { id: string; title: string; points: { label: string; value: number }[] }
export interface AssembleContext {
  selectedNews?: AssembleNews[];
  includeSnapshot?: boolean;
  dailyBrief?: string | null;
  extraNotes?: string;
  customCharts?: AssembleCustomChart[];
}

function assembleNewsForPrompt(news: AssembleNews[]): string {
  return news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.summary ? ' — ' + n.summary : ''}`).join('\n');
}

export function reportAssemblePrompt(inputs: ReportInputs, snapshot: MarketSnapshot, ctx: AssembleContext) {
  const refs: string[] = [];
  if (ctx.includeSnapshot) refs.push('"marketSnapshot" — the live market metrics table');
  refs.push('"chart:brent:12m" — a price-trend chart (series may be brent|gas|power; range may be 3m|6m|12m)');
  if (ctx.selectedNews?.length) refs.push('"selectedNews" — the attached news headlines, as a bulleted list');
  (ctx.customCharts ?? []).forEach((c) => refs.push(`"customChart:${c.id}" — the agent's own chart titled "${c.title}"`));

  return {
    system: HOUSE_RULES,
    prompt: `Assemble a client energy report for ${inputs.companyName ?? 'the client'} as an ordered list of sections.

Client details:
${JSON.stringify(inputs, null, 2)}

${ctx.includeSnapshot ? snapshotForPrompt(snapshot) : '(market snapshot not attached)'}
${ctx.dailyBrief ? `\nToday's market brief (context):\n${ctx.dailyBrief}` : ''}
${ctx.selectedNews?.length ? `\nAttached news headlines:\n${assembleNewsForPrompt(ctx.selectedNews)}` : ''}
${ctx.extraNotes ? `\nExtra context from the agent:\n${ctx.extraNotes}` : ''}
${inputs.agentNotes ? `\nAgent's own notes / projections:\n${inputs.agentNotes}` : ''}
${(ctx.customCharts ?? []).length ? `\nThe agent's charts you may embed:\n${ctx.customCharts!.map((c) => `- "${c.title}" (id ${c.id}): ${c.points.map((p) => `${p.label}=${p.value}`).join(', ')}`).join('\n')}` : ''}

Return ONLY JSON in exactly this shape:
{
  "sections": [
    { "kind": "text",  "heading": "Executive summary", "body": "1-2 short paragraphs of plain prose" },
    { "kind": "embed", "heading": "Market data", "ref": "<one allowed ref>" }
  ]
}

For every "embed" section, "ref" MUST be EXACTLY one of:
${refs.map((r) => `- ${r}`).join('\n')}

Guidance:
- Produce a clear, client-ready structure: executive summary, market context, outlook, and a tailored recommendation — embedding the attached data / charts / news where they support the argument.
- Put a market-data or chart embed near the market context; put "selectedNews" near the end as supporting evidence.
- Use ONLY the figures and evidence provided — never invent numbers. An "embed" merely names data to insert; do not restate those numbers in prose unless they appear in the snapshot above.
- 6 to 10 sections total. Plain, confident UK English. The agent reviews and edits before sending.`,
  };
}

// ── Inline AI edits on a selection / section, and chart captions ──
export type EditAction = 'concise' | 'expand' | 'addData' | 'rewrite' | 'regenerate' | 'analyseChart';

const EDIT_INSTRUCTIONS: Record<EditAction, string> = {
  concise: 'Rewrite the passage below to be tighter and more concise, keeping every fact and the same confident voice.',
  expand: 'Expand the passage below with one or two more sentences of relevant, non-repetitive detail. Do not invent figures.',
  addData: 'Naturally weave ONE relevant figure from the market snapshot into the passage below. Use only the figures provided.',
  rewrite: 'Rewrite the passage below to read more clearly and professionally for a UK business client.',
  regenerate: 'Rewrite the passage below from scratch — same intent and facts, fresh wording, client-ready.',
  analyseChart: 'Write ONE short, plain-English sentence stating the key takeaway from the data below, suitable as a chart caption. No preamble, no markdown.',
};

export function reportEditPrompt(action: EditAction, text: string, opts: { snapshot?: MarketSnapshot; instruction?: string }) {
  const dataCtx = action === 'addData' && opts.snapshot ? `\n\n${snapshotForPrompt(opts.snapshot)}` : '';
  return {
    system: HOUSE_RULES,
    prompt: `${EDIT_INSTRUCTIONS[action]}${opts.instruction ? ' ' + opts.instruction : ''}${dataCtx}

Passage:
"""
${text}
"""

Return ONLY the rewritten text — no quotes, no preamble, no markdown.`,
  };
}

// Mine a pasted call transcript for report-relevant client details.
export function transcriptExtractPrompt(transcript: string) {
  return {
    system: HOUSE_RULES,
    prompt: `Read this transcript of a call between a Green Shift energy agent and a UK business. Extract ONLY details that are clearly stated and useful for a client energy report. Never invent or infer beyond what is said.

Transcript:
"""
${transcript.slice(0, 12000)}
"""

Return ONLY JSON in exactly this shape:
{
  "profile": {
    "companyName": "", "contact": "", "sites": "", "currentSupplier": "", "contractEnd": "", "consumption": ""
  },
  "points": ["a concise, report-relevant point actually raised on the call — a goal, pain point, renewal driver or objection"]
}
Leave any profile field as an empty string if it was not clearly stated. Provide 0-8 points. Plain UK English.`,
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
