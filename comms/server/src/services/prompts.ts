import type { MarketSnapshot } from '../providers/marketData/types';
import type { NewsItem } from '../providers/news/types';
import type { DocumentTemplate } from './templatesStore';

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
  /** Which document template to build to (resolved server-side). */
  templateId?: string;
}

function assembleNewsForPrompt(news: AssembleNews[]): string {
  return news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.summary ? ' — ' + n.summary : ''}`).join('\n');
}

function refList(ctx: AssembleContext): string[] {
  const refs: string[] = [];
  if (ctx.includeSnapshot) refs.push('"marketSnapshot" — the live market metrics table');
  refs.push('"chart:brent:12m" — a price-trend chart (series may be brent|gas|power; range may be 3m|6m|12m)');
  refs.push('"generationMap" — a UK map of regional grid carbon intensity + live interconnector flows (use at most once, where grid/sustainability context helps)');
  if (ctx.selectedNews?.length) refs.push('"selectedNews" — the attached news headlines, as a bulleted list');
  (ctx.customCharts ?? []).forEach((c) => refs.push(`"customChart:${c.id}" — the agent's own chart titled "${c.title}"`));
  return refs;
}

function contextBlock(inputs: ReportInputs, snapshot: MarketSnapshot, ctx: AssembleContext): string {
  return `Client details:
${JSON.stringify(inputs, null, 2)}

${ctx.includeSnapshot ? snapshotForPrompt(snapshot) : '(market snapshot not attached)'}
${ctx.dailyBrief ? `\nToday's market brief (context):\n${ctx.dailyBrief}` : ''}
${ctx.selectedNews?.length ? `\nAttached news headlines:\n${assembleNewsForPrompt(ctx.selectedNews)}` : ''}
${ctx.extraNotes ? `\nExtra context from the agent:\n${ctx.extraNotes}` : ''}
${inputs.agentNotes ? `\nAgent's own notes / projections:\n${inputs.agentNotes}` : ''}
${(ctx.customCharts ?? []).length ? `\nThe agent's charts you may embed:\n${ctx.customCharts!.map((c) => `- "${c.title}" (id ${c.id}): ${c.points.map((p) => `${p.label}=${p.value}`).join(', ')}`).join('\n')}` : ''}`;
}

// Template-driven assembly: the model fills the chosen template's section
// structure. Falls back to the default market-report shape when no template.
export function reportAssemblePrompt(
  inputs: ReportInputs,
  snapshot: MarketSnapshot,
  ctx: AssembleContext,
  template?: DocumentTemplate | null,
) {
  const refs = refList(ctx);
  const refsBlock = `For every "embed" section, "ref" MUST be EXACTLY one of:\n${refs.map((r) => `- ${r}`).join('\n')}`;
  const shape = `Return ONLY JSON in exactly this shape:
{
  "sections": [
    { "kind": "text",  "heading": "Executive summary", "body": "the prose for this section" },
    { "kind": "embed", "heading": "Market data", "ref": "<one allowed ref>" }
  ]
}`;

  if (template) {
    const isEmail = template.channel === 'email';
    const structure = template.sections
      .map((s, i) =>
        s.kind === 'embed'
          ? `${i + 1}. [embed] ${s.heading ? `heading "${s.heading}", ` : ''}ref "${s.ref}"`
          : `${i + 1}. [text] ${s.heading ? `heading "${s.heading}" — ` : ''}${s.guidance ?? ''}`,
      )
      .join('\n');

    const emailRules = `- This is an EMAIL, not a document. Write it as ONE cohesive message: a greeting, flowing body paragraphs, and a sign-off. Do NOT use section headings, bullet points or markdown. Return each part as a "text" section with an EMPTY heading ("heading": "").
- Sign off as the Green Shift Energy agent (use the contact/agent details if given, otherwise "The Green Shift Energy team").`;
    const docRules = `- Follow the section structure above in order. Use the given headings. Keep each section tight and client-ready.
- For "embed" sections, return {"kind":"embed","ref":"<the ref above>"} — do not restate the embedded figures in prose.`;

    return {
      system: HOUSE_RULES,
      prompt: `Build "${template.name}" for ${inputs.companyName ?? 'the client'}.
${template.guidance}

${contextBlock(inputs, snapshot, ctx)}

Structure to produce (one section per item, in this order):
${structure}

${shape}

${refsBlock}

Guidance:
${isEmail ? emailRules : docRules}
- Use ONLY the figures, details and evidence provided — never invent numbers or facts.
- Weight inputs by relevance: client details anchor the personal/recommendation parts; market data drives the market parts; the agent's notes steer the tone and recommendation.
- Plain, confident UK English. The agent reviews and edits before sending.`,
    };
  }

  // Default (no template): the original market & procurement report shape.
  return {
    system: HOUSE_RULES,
    prompt: `Assemble a client energy report for ${inputs.companyName ?? 'the client'} as an ordered list of sections.

${contextBlock(inputs, snapshot, ctx)}

${shape}

${refsBlock}

Guidance:
- Produce a polished, well-structured client report: executive summary → market context (with a market-data / chart embed) → supporting evidence (the references/news) → outlook → a recommendation tailored to THIS client.
- Weight the inputs by relevance, distributed across the report — don't dump everything in one place:
  • the CLIENT DETAILS anchor the executive summary and the recommendation (name the company, their supplier, contract end, consumption where given);
  • the MARKET snapshot/brief drive the market-context and outlook sections;
  • the EVIDENCE (attached news + document excerpts in "extra context") support specific claims — cite them where they back a point, not as a list dump;
  • the AGENT'S NOTES / PROJECTIONS are your steer for the recommendation and tone — reflect them.
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

// Summarise a fetched article for the agent (2-3 plain sentences).
export function articleSummaryPrompt(title: string, text: string) {
  return {
    system: HOUSE_RULES,
    prompt: `Summarise this article in 2-3 plain sentences for a UK energy sales agent: the key facts and why they matter for a business buying gas or electricity. No preamble, no markdown.

Title: ${title}

Article:
"""
${text.slice(0, 6000)}
"""

Return only the summary.`,
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
    "companyName": "", "clientName": "", "contact": "", "sites": "", "currentSupplier": "", "contractEnd": "", "consumption": ""
  },
  "points": ["a concise, report-relevant point actually raised on the call — a goal, pain point, renewal driver or objection"]
}
Leave any profile field as an empty string if it was not clearly stated. Provide 0-8 points. Plain UK English.`,
  };
}

// ── CRM: analyse a pasted/uploaded source (transcript, energy bill, email) ──
export type SourceKind = 'transcript' | 'bill' | 'email' | 'auto';

const SOURCE_HINT: Record<SourceKind, string> = {
  transcript: 'This is a call transcript between a Green Shift agent and a UK business.',
  bill: 'This is a UK business energy bill or statement. Look for supplier, MPAN/MPRN, annual or period consumption (kWh), unit rate (p/kWh), standing charge, and contract/renewal end date.',
  email: 'This is an email to/from the client.',
  auto: 'This could be a call transcript, an energy bill, or an email — infer which.',
};

export function sourceAnalysisPrompt(text: string, kind: SourceKind, currentInputs?: ReportInputs) {
  return {
    system: HOUSE_RULES,
    prompt: `${SOURCE_HINT[kind]} Extract ONLY details clearly stated; never invent or infer beyond the text. ${currentInputs && Object.keys(currentInputs).length ? `\n\nWhat we already know (only fill fields that are missing or clearly updated):\n${JSON.stringify(currentInputs, null, 2)}` : ''}

Source:
"""
${text.slice(0, 14000)}
"""

Return ONLY JSON in exactly this shape:
{
  "kind": "transcript|bill|email",
  "profile": { "companyName": "", "clientName": "", "contact": "", "sites": "", "currentSupplier": "", "contractEnd": "", "consumption": "" },
  "summary": "one concise sentence describing what this source is and the single most important takeaway, suitable for a CRM timeline entry",
  "points": ["a concise, useful point actually stated — a goal, figure, pain point, renewal driver or objection"],
  "suggestedMilestones": ["zero or more of: billReceived, loaSent, loaReturned, quotesGathered, proposalSent, signed — ONLY if the source clearly evidences that milestone (e.g. an attached/described bill -> billReceived; a signed LOA -> loaReturned)"]
}
Leave any profile field as an empty string if not clearly stated. For 'consumption' include units (e.g. "450,000 kWh/yr"). Provide 0-8 points. Plain UK English.`,
  };
}

// ── CRM: recommend the next best action for a client ──
export interface RecommendClient {
  inputs: ReportInputs;
  stage: string;
  doneMilestones: string[];
  recentActivity: string[];
}
export interface RecommendTemplate { id: string; name: string; channel: string; description: string }

export function nextStepPrompt(client: RecommendClient, templates: RecommendTemplate[]) {
  return {
    system: `You are an experienced UK B2B energy sales manager coaching an agent through a deal in their CRM. Be decisive, practical and brief. UK English. Base your advice ONLY on the client state provided — never invent facts.`,
    prompt: `Client state:
- Company: ${client.inputs.companyName ?? 'unknown'}${client.inputs.currentSupplier ? `, supplier ${client.inputs.currentSupplier}` : ''}${client.inputs.contractEnd ? `, contract end ${client.inputs.contractEnd}` : ''}${client.inputs.consumption ? `, consumption ${client.inputs.consumption}` : ''}
- Pipeline stage: ${client.stage}
- Completed milestones: ${client.doneMilestones.length ? client.doneMilestones.join(', ') : 'none yet'}
- Recent activity (newest first):
${client.recentActivity.length ? client.recentActivity.map((a) => `  • ${a}`).join('\n') : '  (none)'}

Document templates the agent can generate now:
${templates.map((t) => `- id "${t.id}" — ${t.name} (${t.channel}): ${t.description}`).join('\n')}

Decide the single best NEXT ACTION to move this deal forward. Return ONLY JSON in exactly this shape:
{
  "action": "a short imperative next step, e.g. 'Send the Letter of Authority cover email'",
  "rationale": "one or two sentences: why this is the right next move given where the deal is",
  "templateId": "the id of the template to generate for this action, or empty string if no template fits"
}
Choose templateId ONLY from the ids listed above. Keep it concrete and tied to the client's actual stage and missing milestones.`,
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
