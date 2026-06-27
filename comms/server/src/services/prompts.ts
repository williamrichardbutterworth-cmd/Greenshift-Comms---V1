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
- Use ONLY the data and headlines provided. Never invent figures, prices or events. If a figure isn't provided, don't state one.
- Treat all prices as indicative/for-information, not a price quotation. Never present an indicative level as a firm quote.
- This is general market commentary, NOT financial advice, and not a personal recommendation to buy or sell.
- Distinguish OBSERVED data (live/settled market prices we measured) from MODELLED/forward views (the forward curve, scenarios, outlooks) — never present a forecast as a fact.
- Use measured, hedged language: prefer "indicative", "suggests", "currently points to", "on the basis of [dated] data", "may", "could". Avoid "will", "guaranteed", "best price", or "you should buy/sell". Frame a market read as something the client may wish to consider.
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
/** A past conversation/summary the agent has chosen to ground this draft in. */
export interface AssembleConversation { when?: string; summary?: string; points?: string[]; angles?: string[] }
export interface AssembleContext {
  selectedNews?: AssembleNews[];
  includeSnapshot?: boolean;
  dailyBrief?: string | null;
  extraNotes?: string;
  customCharts?: AssembleCustomChart[];
  /** Which document template to build to (resolved server-side). */
  templateId?: string;
  /** Prior conversations with this client, fed as context (text only — never figures to restate as fact). */
  linkedConversations?: AssembleConversation[];
}

function assembleNewsForPrompt(news: AssembleNews[]): string {
  return news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}${n.summary ? ' — ' + n.summary : ''}`).join('\n');
}

function refList(ctx: AssembleContext): string[] {
  const refs: string[] = [];
  if (ctx.includeSnapshot) refs.push('"marketSnapshot" — the live market metrics table');
  refs.push('"chart:brent:12m" — a price-trend chart (series may be brent|gas|power; range may be 3m|6m|12m)');
  refs.push('"generationMap" — a UK map of regional grid carbon intensity + live interconnector flows (use at most once, where grid/sustainability context helps)');
  refs.push('"forwardCurve" — the UK power baseload + NBP gas forward season curves with the backwardation / "procure now vs wait" read (use where procurement timing is the point)');
  refs.push('"kpiStrip" — a compact 3-4 card "at a glance" strip of the headline market numbers (day-ahead power, gas, forward read); use once near the top');
  refs.push('"comparisonTable" — a side-by-side comparison of the supplier quotes / options the agent has gathered (the agent fills the figures; never invent them)');
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
${(ctx.linkedConversations ?? []).length ? `\nLinked past conversations with this client (context — restate or build on these, do NOT invent beyond them):\n${ctx.linkedConversations!.map((c) => `- ${c.when ? `[${c.when.slice(0, 10)}] ` : ''}${c.summary ?? ''}${c.angles?.length ? ` | angles: ${c.angles.join('; ')}` : ''}${c.points?.length ? ` | facts: ${c.points.join('; ')}` : ''}`).join('\n')}` : ''}
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
  "points": ["a concise, useful FACT actually stated — a goal, figure, pain point, renewal driver or objection"],
  "angles": ["a client-specific CONVERSATIONAL ANGLE the agent can use to build the relationship and move the deal forward on the next call — e.g. a hook tied to something they said, a concern to pre-empt, a follow-up to raise, a value point that matters to THIS client. Actionable and personal, not generic market commentary."],
  "suggestedMilestones": ["zero or more of: billReceived, loaSent, loaReturned, quotesGathered, proposalSent, signed — ONLY if the source clearly evidences that milestone (e.g. an attached/described bill -> billReceived; a signed LOA -> loaReturned)"]
}
Leave any profile field as an empty string if not clearly stated. For 'consumption' include units (e.g. "450,000 kWh/yr"). Provide 0-8 points and 0-5 angles. Base angles ONLY on this source and the known client details — never invent. Plain UK English.`,
  };
}

// ── Forward curve: extract the UK power baseload + NBP gas season tables from a
// pasted/screenshotted morning market report (e.g. TotalEnergies / Energy
// Market Price). Works on attached image(s) and/or pasted text. ──
export function forwardCurveExtractPrompt(text?: string) {
  const hasText = !!text && text.trim().length > 0;
  return {
    system: `You read UK wholesale energy market reports and return their forward-price tables as structured data. Extract ONLY values clearly present in the source — never invent, infer or fill gaps. Numbers must be copied exactly as shown (no rounding). UK English.`,
    prompt: `From the ${hasText ? 'text below' : 'attached image(s)'}${hasText ? '' : ' of a daily market report'}, extract the two UK forward-price tables:
- UK power baseload prices (unit "£/MWh")
- UK NBP gas prices (unit "p/therm")

Each table lists contracts by row. The columns are typically: Contract, a recent settlement date, the previous settlement date, a "Change" column (IGNORE — it is derived), a "Current Offer/Price (*)" column, and another "Change" column (IGNORE). Map them to:
- "label": the contract name exactly as written (e.g. "DA", "Jul-26", "Aug-26", "Q3-26", "Q4-26", "Win 26", "Sum 27", "Win 27", "Sum 28", "Win 28")
- "latest": the most recent settlement price (the left-most dated price column)
- "prev": the previous settlement price (the next dated price column)
- "current": the "Current Offer" / "Current price" value (the column marked with "(*)")
${hasText ? `\nSource:\n"""\n${text.slice(0, 16000)}\n"""\n` : ''}
Return ONLY JSON in exactly this shape:
{
  "asOfDate": "YYYY-MM-DD — the most recent settlement date (the left-most dated column header), or the report's 'Last Update' date; empty string if not shown",
  "source": "the report's publisher if visible (e.g. 'TotalEnergies — Energy Market Price'), else ''",
  "curves": [
    { "commodity": "power", "unit": "£/MWh", "legs": [ { "label": "DA", "latest": 104.40, "prev": 97.50, "current": 114 } ] },
    { "commodity": "gas", "unit": "p/therm", "legs": [ { "label": "DA", "latest": 121.60, "prev": 118.50, "current": 122.00 } ] }
  ]
}
Use numbers (not strings) for prices; use null for any price genuinely absent. Include every contract row you can see, in the order shown. Only include a "power" and/or "gas" curve if that table is actually present.`,
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

// ── Letter of Authority (LOA) extraction + company-website summary ──
// The fixed set of LOA variables we try to harvest from any source (call
// transcript, the company website, uploaded docs). Empty string === unknown.
export const LOA_FIELD_KEYS = [
  'customerName', 'registeredNo', 'businessAddress', 'postcode', 'telephone',
  'authorisedRep', 'email', 'mpan', 'mpr', 'siteAddresses', 'signatoryName', 'position', 'signatoryEmail',
] as const;

const LOA_FIELD_GUIDE = `- customerName: the customer's full legal/trading name (the entity signing the LOA)
- registeredNo: UK company registration number (8 digits) if a limited company; else ''
- businessAddress: registered/main business address (street, town) — exclude the postcode
- postcode: the business postcode on its own
- telephone: a business phone number
- authorisedRep: the contact/decision-maker we deal with
- email: the customer's email address
- mpan: electricity meter point (MPAN, the long S-number / 13-digit "bottom line") if stated
- mpr: gas meter point reference (MPR/MPRN) if stated
- siteAddresses: address(es) of the supplied site(s); separate multiple with "; "
- signatoryName: the person who will sign (PRINT NAME) — often the authorised rep
- position: the signatory's job title / position
- signatoryEmail: the signatory's email if different from email; else ''`;

export function loaExtractPrompt(text: string, current?: Record<string, string>, fromWebsite = false) {
  const known = current && Object.entries(current).filter(([, v]) => (v ?? '').trim()).length
    ? `\nWhat we already know (do NOT overwrite these unless the source is clearly more accurate; only fill the BLANKS):\n${JSON.stringify(current, null, 2)}`
    : '';
  return {
    system: HOUSE_RULES,
    prompt: `Extract the details needed to complete a UK energy Letter of Authority for a business customer, from the ${fromWebsite ? 'company website text' : 'source text'} below.
${known}

${fromWebsite ? 'Company website text' : 'Source'}:
"""
${text.slice(0, 14000)}
"""

Return ONLY JSON in exactly this shape:
{
  "fields": {
${LOA_FIELD_KEYS.map((k) => `    "${k}": ""`).join(',\n')}
  },
  "fuel": "",            // one of "gas" | "electric" | "both" | "" — which energy they buy, if discernible
  "services": [],        // short list of relevant services/needs mentioned (e.g. "contract renewal", "bill validation")
  "companySummary": ""   // ${fromWebsite ? '2-3 sentence plain-English overview of what the company does (only from the text)' : 'leave empty unless the source describes the business'}
}

Field guidance:
${LOA_FIELD_GUIDE}

Rules: Use ONLY facts present in the text — never invent a company number, MPAN, address or postcode. Leave any field you can't ground as "". Do not guess the postcode from the town. Plain UK English.`,
  };
}

// ── Email dialogue: draft the next email in an ongoing client conversation ──
export interface EmailMsg { direction: 'in' | 'out'; subject?: string; body: string; at?: string }

export function emailDraftPrompt(
  inputs: ReportInputs,
  history: EmailMsg[],
  opts: { mode: 'reply' | 'follow-up'; instruction?: string; angles?: string[] },
) {
  const thread = history
    .map((m) => `${m.direction === 'in' ? 'CLIENT' : 'US (Green Shift agent)'}${m.subject ? ` — subject "${m.subject}"` : ''}:\n${m.body}`)
    .join('\n\n---\n\n');
  return {
    system: HOUSE_RULES,
    prompt: `Draft the NEXT email in an ongoing conversation between a Green Shift Energy agent and a UK business energy customer.

Client details:
${JSON.stringify(inputs, null, 2)}
${opts.angles?.length ? `\nTalk-track angles for this client (use where natural):\n${opts.angles.map((a) => `- ${a}`).join('\n')}` : ''}

Conversation so far (oldest first; "US" = the agent, "CLIENT" = the customer):
${thread || '(no prior emails — this is the opening email)'}

Task: Write ${opts.mode === 'reply' ? "a reply to the client's most recent message" : 'a proactive follow-up email that moves the relationship forward'}.${opts.instruction ? `\nSpecific instruction from the agent: ${opts.instruction}` : ''}

Return ONLY JSON in exactly this shape:
{
  "subject": "concise relevant subject line (reuse the thread subject with 'Re:' when replying)",
  "body": "the full email body — greet the contact by first name, a warm and professional message that responds to / builds on the conversation, a clear next step, then a sign-off from the Green Shift Energy agent. Plain text, no markdown, no placeholders like [name]."
}

Rules: Use ONLY the details and conversation provided — never invent prices, figures, dates or commitments. Hedged, professional UK English; this is general commentary, not a quotation or advice. Keep it concise and human. The agent will review and edit before sending.`,
  };
}

// ── Comprehensive client intake — one structured profile from all sources ──
export interface ClientMeter {
  type: 'electric' | 'gas';
  mpan?: string; mprn?: string; siteAddress?: string; supplier?: string; contractEnd?: string; consumption?: string;
}

export function clientIntakePrompt(
  sources: { website?: string; transcript?: string; fileTexts?: string[]; hasImages?: boolean },
) {
  const blocks: string[] = [];
  if (sources.website) blocks.push(`COMPANY WEBSITE TEXT:\n"""\n${sources.website.slice(0, 9000)}\n"""`);
  if (sources.transcript) blocks.push(`CALL TRANSCRIPT (e.g. Dialpad — may include the customer's phone number):\n"""\n${sources.transcript.slice(0, 12000)}\n"""`);
  (sources.fileTexts ?? []).forEach((t, i) => { if (t?.trim()) blocks.push(`UPLOADED DOCUMENT ${i + 1} (e.g. an energy bill):\n"""\n${t.slice(0, 6000)}\n"""`); });
  if (sources.hasImages) blocks.push('One or more images are attached (e.g. a photographed energy bill) — read any energy/meter/company details from them.');

  return {
    system: HOUSE_RULES,
    prompt: `You are setting up a new UK business energy customer for Green Shift Energy. Read ALL the sources below and extract ONE comprehensive client profile.

${blocks.join('\n\n') || '(no sources provided)'}

Return ONLY JSON in exactly this shape (use "" / [] when something genuinely isn't in the sources — never invent):
{
  "companyName": "", "registeredNo": "", "businessAddress": "", "postcode": "", "industry": "",
  "contactName": "", "position": "", "email": "", "telephone": "",
  "fuel": "",
  "currentSupplier": "", "contractEnd": "", "consumption": "",
  "meters": [
    { "type": "electric", "mpan": "", "mprn": "", "siteAddress": "", "supplier": "", "contractEnd": "", "consumption": "" }
  ],
  "services": [],
  "companySummary": "",
  "summary": "",
  "points": [],
  "angles": [],
  "suggestedMilestones": []
}

Guidance:
- fuel: one of "gas" | "electric" | "both" | "" — what energy they buy, if discernible.
- meters: one entry PER METER found (across multiple sites if mentioned). type is "electric" (has an MPAN) or "gas" (has an MPRN/MPR). Capture per-meter siteAddress, supplier, contractEnd and consumption when stated — energy bills usually list these. MPAN = the long electricity supply number; MPRN/MPR = the gas meter point reference.
- telephone: prefer a number stated in the transcript (Dialpad shows the caller's number); else from the website.
- companySummary: 2-3 plain-English sentences on what the company does (from the website).
- summary: one line capturing where this prospect is. points: the key facts gathered. angles: client-specific conversational hooks for the next call. suggestedMilestones: any of billReceived, loaSent, loaReturned, quotesGathered, proposalSent, signed that the sources clearly evidence.
- Use ONLY what's in the sources. UK English. Never invent a company number, MPAN, MPRN, postcode or price.`,
  };
}
