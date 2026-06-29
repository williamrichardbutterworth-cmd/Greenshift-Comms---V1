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

// ── RFQ (Greenshift Lead Generation Form): qualify a lead from a call transcript ──
// The internal form handed to the pricing specialist. Extract the basic info AND the
// answers to the qualification questions from a call transcript / notes (or basic info
// from a website). Mirror the LOA extractor contract: ground everything, fill blanks.
export const RFQ_FIELD_KEYS = [
  'leadGenName', 'companyName', 'contactName', 'contactNumber', 'email', 'businessType', 'numberOfSites',
  'estimatedConsumption', 'meterProfiled', 'electricMpan', 'currentSupplier', 'contractEndDate', 'callTime',
  'loaInPlace', 'billsAvailable', 'procureMethod', 'useBroker', 'brokerWho', 'brokerFrequency',
  'marketKnowledge', 'reviewedContracts', 'reviewedKva', 'decisionMaker', 'awareLooking', 'decisionProcess',
  'decisionToday', 'timeline', 'worksWell', 'bugBear', 'supplierIssues', 'unexpectedCosts', 'targetBudget',
  'receivedPrices', 'pricesFromWho', 'expectingPrices', 'fixedVsMarket', 'contractLength', 'signOffToday',
] as const;

const RFQ_FIELD_GUIDE = `Basic information:
- companyName, contactName, contactNumber, email, businessType (sector/what they do)
- numberOfSites, estimatedConsumption (annual kWh), meterProfiled ("HH" or "NHH" if stated)
- electricMpan, currentSupplier, contractEndDate, callTime (any agreed call time/date)
- loaInPlace ("Yes"/"No"), billsAvailable ("Yes"/"No" — have they shared/attached bills)
Qualification answers (capture the customer's actual answer concisely, in their sense):
- procureMethod: how they normally buy energy (direct, broker, comparison, etc.)
- useBroker (Yes/No), brokerWho (which broker), brokerFrequency (how often they hear from them)
- marketKnowledge: their understanding of the energy market
- reviewedContracts: whether they've reviewed contracts recently
- reviewedKva: whether they've reviewed kVA capacity / standing charges
- decisionMaker (who signs off), awareLooking (are they aware you're checking prices)
- decisionProcess, decisionToday (could they decide on the spot), timeline (if not, when)
- worksWell, bugBear (biggest frustration), supplierIssues, unexpectedCosts
- targetBudget, receivedPrices (Yes/No), pricesFromWho, expectingPrices
- fixedVsMarket (fixed vs market preference), contractLength (term they'd fix for)
- signOffToday: would they sign off today for a strong offer / do they understand prices move daily`;

export function rfqExtractPrompt(text: string, current?: Record<string, string>, fromWebsite = false) {
  const known = current && Object.entries(current).filter(([, v]) => (v ?? '').trim()).length
    ? `\nWhat we already know (do NOT overwrite these unless the source is clearly more accurate; only fill the BLANKS):\n${JSON.stringify(current, null, 2)}`
    : '';
  return {
    system: HOUSE_RULES,
    prompt: `Fill in a Greenshift Lead Generation Form (an internal energy-broker qualification form) from the ${fromWebsite ? 'company website text' : 'call transcript / notes'} below. ${fromWebsite ? 'A website mostly gives basic information (company, sector, contact); leave qualification answers blank.' : 'Capture the customer’s actual answers to the qualification questions, concisely and faithfully.'}
${known}

${fromWebsite ? 'Company website text' : 'Transcript / notes'}:
"""
${text.slice(0, 16000)}
"""

Return ONLY JSON in exactly this shape:
{
  "fields": {
${RFQ_FIELD_KEYS.map((k) => `    "${k}": ""`).join(',\n')}
  },
  "companySummary": ""   // ${fromWebsite ? '2-3 sentence plain-English overview of what the company does (only from the text)' : 'leave empty'}
}

Field guidance:
${RFQ_FIELD_GUIDE}

Rules: Use ONLY what's actually stated. Never invent an MPAN, supplier, consumption or date. Leave any field not covered as "". Summarise long answers in one short sentence. Plain UK English.`,
  };
}

// ── RFQ call game plan: per-question cues + how to ask, grounded in what we already know ──
// Turns the qualification call into an assisted flow: for each remaining question, surface the
// most relevant thing the client has ALREADY told us so the agent can reference it (showing they
// listened), and suggest a natural way to ask that weaves the cue in.
export function rfqGameplanPrompt(context: string, questions: { key: string; question: string }[]) {
  return {
    system: HOUSE_RULES,
    prompt: `You are prepping a Green Shift lead-gen agent for an RFQ qualification call with a business energy customer. Below is EVERYTHING we already know about this client — their record, past conversations, and the talking points we've gathered. For each question we still need to answer on the call, return:
- "cue": the single most relevant thing we ALREADY know that relates to this question — a specific fact or a short paraphrase of something they told us — so the agent can reference it and show we've been listening. If we genuinely have nothing relevant, use "".
- "ask": a natural, warm way to ask the question on the call that weaves the cue in when there is one (so it feels like a continuation of the relationship, not an interrogation). If there's no cue, just give a clean, conversational version of the question.

Ground every cue ONLY in the context below — NEVER invent a fact, name, figure or quote. Keep "cue" and "ask" to one sentence each. UK English.

What we already know about this client:
"""
${context.slice(0, 9000)}
"""

Questions still to answer (return exactly one object per key, in the same order):
${questions.map((q) => `- ${q.key}: ${q.question}`).join('\n')}

Return ONLY JSON in this shape:
{ "items": [ ${questions.slice(0, 1).map((q) => `{ "key": "${q.key}", "cue": "", "ask": "" }`).join('')} , … ] }`,
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

// ── Report engine: AI narrative for a generated report ──
export interface NarrativeFact { label: string; value: string }

export function reportFillPrompt(
  kind: string,
  inputs: ReportInputs,
  facts: NarrativeFact[],
  _values: Record<string, string>,
) {
  const factLines = facts.map((f) => `- ${f.label}: ${f.value}`).join('\n');
  const header = `for a UK business energy customer. The figures below are ALREADY computed and FINAL — refer to them, never change or invent numbers.

Client:
${JSON.stringify(inputs, null, 2)}

Key figures (already worked out — be consistent with these, do not alter):
${factLines || '(none yet)'}`;
  const rules = `Rules: Use ONLY the details and figures provided — never invent a price, supplier, figure or date. Concise, professional UK English. This is general commentary, NOT a personal recommendation to trade/hedge or a guaranteed quotation. No markdown, no placeholders.`;

  if (kind === 'procure-ahead') {
    return {
      system: HOUSE_RULES,
      prompt: `Draft the narrative prose for a Green Shift Energy Procure-Ahead market brief ${header}

This report is built around the UK power FORWARD CURVE (the price of each forward delivery period). The "Curve signal" drives the stance: "backwardation" = the whole forward slopes down → act now / fix a longer term; "value" = a specific forward window is cheaper than the front → consider fixing into that window; "contango" = nothing forward is cheaper → hold or take a shorter fix. Tailor the stance to the signal given.
If a "Renewal window on the forward curve" figure is given, ANCHOR the "what this means for you" on it — that is the forward price for the delivery period THIS client will be buying once their contract ends; compare it to the front of the curve and the overall shape, and make the recommendation about securing (or not) that specific window ahead.

Return ONLY JSON in exactly this shape:
{
  "chartCaption": "1 sentence reading the 12-month power trend.",
  "commentaryDrivers": "2-3 sentences on what's moving the market right now.",
  "commentaryOutlook": "2-3 sentences on the balanced outlook ahead.",
  "implication": "2 sentences on what this means for THIS client given their contract end date.",
  "stanceTag": "a 2-4 word tag matching the signal (e.g. 'Act — window open', 'Hold — no discount ahead').",
  "stanceHeadline": "a short imperative headline matching the signal.",
  "stanceRationale": "1-2 sentences setting up the talking points.",
  "talkingPoint1": "one talking point.",
  "talkingPoint2": "one talking point.",
  "talkingPoint3": "one talking point.",
  "talkingPoint4": "one talking point about Green Shift monitoring the market and re-tendering ahead of expiry."
}
${rules}`,
    };
  }

  return {
    system: HOUSE_RULES,
    prompt: `Draft the narrative prose for a Green Shift Energy Cost Comparison report ${header}

Return ONLY JSON in exactly this shape:
{
  "summaryCurrent": "2 sentences on the client's current position and why acting matters (e.g. rolling onto out-of-contract deemed rates when the term ends).",
  "summaryRecommended": "2 sentences on what we found across the supplier panel and the strongest option, consistent with the figures.",
  "recommendationTitle": "a short imperative headline naming the recommended supplier and term.",
  "recommendationRationale": "2-3 sentences on why this option — budget certainty, removing price risk, lowest all-in cost of the panel."
}
${rules}`,
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

// ── Bill analysis "swarm": specialised extractors, one focus area each, run in
// parallel. Each returns its fields with a verbatim source quote + confidence so the
// agent can show WHERE on the bill every value came from and double-check it. ──
export interface BillPass { id: string; keys: string[]; focus: string }
export const BILL_PASSES: BillPass[] = [
  { id: 'identity', keys: ['supplier', 'accountNumber', 'companyName', 'businessAddress', 'postcode', 'billDate'],
    focus: 'the energy SUPPLIER name, the account/customer reference number, the customer company/business name, the full supply or business address, the postcode, and the bill issue date' },
  { id: 'meter', keys: ['meterType', 'mpan', 'mprn', 'consumption'],
    focus: 'whether this is an ELECTRICITY or GAS bill (meterType = "electric" or "gas"), the MPAN (the long electricity supply number, often laid out in a grid with an "S" / "Supply Number"), the MPRN (gas Meter Point Reference Number), and the consumption in kWh (annual if shown, otherwise the billed-period usage — include the period in the source)' },
  { id: 'rates', keys: ['currentUnitRate', 'currentStanding', 'totalAmount'],
    focus: 'the unit rate in pence per kWh (p/kWh), the standing charge in pence per day (p/day), and the total amount due on this bill. If multiple rates exist (day/night, or per-meter), give the primary/most prominent unit rate as the value and note the others verbatim in the source' },
  { id: 'contract', keys: ['contractEnd', 'currentProduct'],
    focus: 'the contract END date (or fixed-term expiry / renewal date), and the tariff or product name (e.g. "Fixed 24 month", "Out of contract", "Deemed", "Variable")' },
];

export function billPassPrompt(pass: BillPass, text: string | undefined, hasImage: boolean) {
  return {
    system: HOUSE_RULES,
    prompt: `You are a meticulous UK energy-bill analyst. Extract ONLY ${pass.focus}, from the bill below.${hasImage ? ' The bill is attached as an image — read it carefully, including small print and meter grids.' : ''}${text ? `\n\nBILL TEXT:\n"""\n${text.slice(0, 14000)}\n"""` : ''}

Return ONLY JSON in exactly this shape:
{
  "fields": {
${pass.keys.map((k) => `    "${k}": { "value": "", "source": "", "confidence": "" }`).join(',\n')}
  }
}
For EACH field: "value" = the clean extracted value (numbers only for rates/consumption — "24.50" not "24.50p/kWh"; a date as written on the bill); "source" = the EXACT verbatim text from the bill you took it from, quoted word-for-word so it can be located on the page; "confidence" = "high" | "medium" | "low". If a field genuinely isn't present on the bill, set its value and source to "". NEVER invent or guess a value — extract only what is actually shown.`,
  };
}
