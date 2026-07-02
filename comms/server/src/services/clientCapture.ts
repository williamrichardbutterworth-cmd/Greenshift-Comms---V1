import { getClientProfile, updateClientProfile, appendActivity, type ClientProfile, type ActivityType } from './clientProfilesStore';
import { uploadFile, getFileMeta } from './fileStore';
import { analyzeSource, type ReportInputs } from './reportGenerator';
import { clientIntake } from './clientIntake';
import { groundEvents, type RawEvent } from './calendarScan';
import { upsertDetectedEvents } from './calendarStore';
import type { SourceKind, ClientMeter } from './prompts';

// The capture pipeline — ONE server round trip from "something was said/received"
// to a fully-updated client. Both entry points follow the same contract:
//
//   1. The VERBATIM text is made durable FIRST (a file on the client), before any
//      AI runs — a model failure can never cost the words again.
//   2. ONE unified extraction reads the raw text (profile fields + meters +
//      milestones + talk tracks + calendar commitments in a single pass).
//   3. The merge happens HERE against a fresh read (fill-blanks; meters matched
//      by MPAN/MPRN digits), not against whatever snapshot a browser was holding.
//   4. The timeline entry carries the summary/bullets for the eye and
//      meta.transcriptFileId for the record, so every later miner (calendar scan,
//      LOA/RFQ extractors, re-analysis) can read the raw call — not a summary of
//      a summary.
//   5. Spoken commitments are provenance-gated against the RAW text and upserted
//      onto the calendar immediately — no waiting for the Calendar tab to open.
//
// Mirrors the never-throw contract of the extractors: AI failure degrades to an
// `analysis.error` on a still-successful capture (the text IS saved).

const SOURCE_KINDS: SourceKind[] = ['transcript', 'email', 'bill', 'auto'];

const actTypeFor = (kind: string): ActivityType =>
  kind === 'email' ? 'email-received' : kind === 'bill' ? 'file' : kind === 'transcript' ? 'transcript' : 'note';

const digitsOf = (s?: string): string => (s ?? '').replace(/\D+/g, '');

/** Fill only blank keys — an existing non-blank value (a manual edit) always wins. */
function fillBlanks(target: Record<string, unknown>, patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.trim() && !String(target[k] ?? '').trim()) target[k] = v.trim();
  }
}

/** Merge extracted meters into the stored set: match by MPAN/MPRN digit-string,
 *  fill blanks on a match, append genuinely new supply points. Never flips an
 *  existing meter's fuel (the bill-analysis invariant) — a digit match on a meter
 *  of the OTHER fuel is treated as a mis-extraction and skipped entirely rather
 *  than minting a duplicate supply point. */
export function mergeMeters(existing: ClientMeter[], incoming: ClientMeter[]): ClientMeter[] {
  const out = existing.map((m) => ({ ...m }));
  const hadNone = !existing.length;
  const siteKey = (s?: string) => (s ?? '').trim().toLowerCase();
  for (const inc of incoming) {
    const incKey = digitsOf(inc.mpan) || digitsOf(inc.mprn);
    const digitMatch = incKey
      ? out.find((m) => digitsOf(m.mpan) === incKey || digitsOf(m.mprn) === incKey)
      : undefined;
    if (digitMatch && digitMatch.type !== inc.type) continue; // fuel conflict → mis-extraction
    if (digitMatch) {
      for (const k of ['mpan', 'mprn', 'siteAddress', 'supplier', 'contractEnd', 'consumption'] as const) {
        const v = inc[k];
        if (v && v.trim() && !String(digitMatch[k] ?? '').trim()) (digitMatch as Record<string, string>)[k] = v.trim();
      }
    } else if (incKey || (hadNone && inc.siteAddress && !out.some((m) => siteKey(m.siteAddress) === siteKey(inc.siteAddress)))) {
      // Add a meter we can identify (an MPAN/MPRN) — or, for a brand-new client,
      // sited meters with distinct addresses. A bare "they mentioned a meter" on a
      // client with existing supply points must not mint phantoms.
      out.push({ ...inc });
    }
  }
  return out;
}

const getMeters = (inputs: Record<string, unknown>): ClientMeter[] =>
  Array.isArray(inputs.meters) ? (inputs.meters as ClientMeter[]) : [];

/** Unique site addresses across meters → the "sites" summary string. */
function meterSites(meters: ClientMeter[]): string {
  const seen = new Set<string>(); const out: string[] = [];
  for (const m of meters) {
    const s = (m.siteAddress ?? '').trim(); const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out.join('; ');
}

/** Persist pasted text as a plain-text file on the client — the durable verbatim
 *  copy. ASCII-only name (Supabase Storage rejects fancy punctuation in keys). */
async function persistRawText(clientProfileId: string, text: string, label: string): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  try {
    const saved = await uploadFile({
      name: `${label} - ${stamp}.txt`,
      mime: 'text/plain',
      clientProfileId,
      dataBase64: Buffer.from(text, 'utf8').toString('base64'),
    });
    return saved.id;
  } catch (e) {
    // The file copy is belt-and-braces — capture still proceeds — but a persist
    // failure must be observable, not swallowed into thin air.
    console.warn(`clientCapture: raw-text persist failed for ${clientProfileId}:`, (e as Error).message);
    return null;
  }
}

// ── Log a call / email / bill text against an existing client ──

export interface LogCallResult {
  client: ClientProfile;
  analysis: { summary: string; points: string[]; angles: string[]; rapport: string[]; provider: string; error?: string };
  calendar: { detected: number };
  transcriptFileId: string | null;
}

export async function logCallToClient(
  id: string,
  input: { text?: string; kind?: SourceKind; fileId?: string },
): Promise<LogCallResult | null> {
  const profile = await getClientProfile(id);
  if (!profile) return null;
  const kind: SourceKind = SOURCE_KINDS.includes(input.kind as SourceKind) ? (input.kind as SourceKind) : 'auto';

  // 1. Resolve the raw text + make it durable before any AI touches it.
  let raw = '';
  let fileId: string | null = null;
  if (input.fileId) {
    const f = await getFileMeta(input.fileId);
    if (f && f.clientProfileId === id) { // never read another client's file
      raw = f.extractedText ?? '';
      fileId = f.id;
    }
  } else if (input.text?.trim()) {
    raw = input.text;
    const label = kind === 'email' ? 'Email' : kind === 'bill' ? 'Bill text' : 'Call transcript';
    fileId = await persistRawText(id, raw, label);
  }
  const emptyAnalysis = { summary: '', points: [], angles: [], rapport: [], provider: 'none' as string };
  if (!raw.trim()) return { client: profile, analysis: emptyAnalysis, calendar: { detected: 0 }, transcriptFileId: fileId };

  // 2. ONE unified extraction over the verbatim text.
  const loggedAt = new Date().toISOString();
  const a = await analyzeSource(raw, kind, profile.inputs as ReportInputs, { loggedAt, withEvents: true });

  // 3. Merge onto a FRESH read (not a browser snapshot).
  const fresh = (await getClientProfile(id)) ?? profile;
  const inputs = { ...fresh.inputs };
  fillBlanks(inputs, a.profile);
  if (a.profile.email || a.profile.telephone) fillBlanks(inputs, { contact: a.profile.email || a.profile.telephone });
  if (a.meters.length) {
    inputs.meters = mergeMeters(getMeters(fresh.inputs), a.meters);
    fillBlanks(inputs, { sites: meterSites(inputs.meters as ClientMeter[]) });
  }
  const tracker = { ...fresh.tracker };
  for (const m of a.suggestedMilestones) if (!tracker[m]) tracker[m] = loggedAt;
  await updateClientProfile(id, { inputs, tracker });

  // 4. The timeline entry — bullets for the eye, the raw file for the record.
  const meta: Record<string, unknown> = {
    ...(a.angles.length ? { angles: a.angles } : {}),
    ...(a.rapport.length ? { rapport: a.rapport } : {}),
    ...(fileId ? { transcriptFileId: fileId } : {}),
  };
  const withActivity = await appendActivity(id, {
    type: actTypeFor(a.kind || kind),
    title: a.summary || (a.error ? 'Logged — automatic reading unavailable' : 'Update logged'),
    detail: a.points.length ? a.points.map((p) => `• ${p}`).join('\n') : undefined,
    meta: Object.keys(meta).length ? meta : undefined,
  });
  const activity = withActivity?.activities[0]; // appendActivity prepends

  // 5. Spoken commitments → the calendar, grounded against the RAW text.
  let detected = 0;
  if (activity && a.events.length) {
    try {
      const grounded = groundEvents(id, { id: activity.id, at: activity.at, haystack: raw }, a.events as RawEvent[]);
      if (grounded.length) { await upsertDetectedEvents(id, grounded); detected = grounded.length; }
    } catch { /* the calendar write is additive — a failure must not fail the capture */ }
  }

  const client = withActivity ?? (await getClientProfile(id)) ?? fresh;
  return {
    client,
    analysis: { summary: a.summary, points: a.points, angles: a.angles, rapport: a.rapport, provider: a.provider, error: a.error },
    calendar: { detected },
    transcriptFileId: fileId,
  };
}

// ── Run the full new-client intake against an existing (provisional) profile ──

export interface IntakeRunResult {
  client: ClientProfile;
  intake: { companyName: string; summary: string; companySummary: string; provider: string; error?: string };
  calendar: { detected: number };
  transcriptFileId: string | null;
}

export async function runClientIntake(
  id: string,
  input: { website?: string; transcript?: string; fileIds?: string[]; images?: { base64: string; mime?: string }[] },
): Promise<IntakeRunResult | null> {
  const profile = await getClientProfile(id);
  if (!profile) return null;

  // 1. Durable transcript first.
  let transcriptFileId: string | null = null;
  if (input.transcript?.trim()) transcriptFileId = await persistRawText(id, input.transcript, 'Call transcript');

  // 2. Texts of the already-uploaded media (bills/docs attached in the wizard).
  const fileTexts: string[] = [];
  for (const fid of (input.fileIds ?? []).slice(0, 12)) {
    try {
      const f = await getFileMeta(fid);
      if (f?.extractedText?.trim()) fileTexts.push(f.extractedText);
    } catch { /* skip an unreadable file */ }
  }

  // 3. ONE comprehensive intake (website scrape happens inside).
  const loggedAt = new Date().toISOString();
  const r = await clientIntake({ website: input.website, transcript: input.transcript, fileTexts, images: input.images, loggedAt });

  // 4. Merge into the profile (server-side port of web mergeIntakeIntoInputs).
  const fresh = (await getClientProfile(id)) ?? profile;
  const inputs = { ...fresh.inputs };
  fillBlanks(inputs, {
    companyName: r.companyName, clientName: r.contactName, position: r.position,
    email: r.email, telephone: r.telephone, contact: r.email || r.telephone,
    registeredNo: r.registeredNo, businessAddress: r.businessAddress, postcode: r.postcode,
    industry: r.industry, website: r.websiteUrl, companySummary: r.companySummary,
    currentSupplier: r.currentSupplier, contractEnd: r.contractEnd, consumption: r.consumption,
  });
  if (r.meters.length) inputs.meters = mergeMeters(getMeters(fresh.inputs), r.meters);
  // Sites from the MERGED meters — never list an address that has no meter row.
  fillBlanks(inputs, { sites: meterSites(getMeters(inputs)) });
  const cv = (inputs.customerVariables ?? {}) as { fuel?: string };
  inputs.customerVariables = { ...cv, fuel: cv.fuel || r.fuel };
  const tracker = { ...fresh.tracker };
  for (const m of r.suggestedMilestones) if (!tracker[m]) tracker[m] = loggedAt;
  const name = r.companyName || fresh.name;
  await updateClientProfile(id, { name, inputs, tracker });

  // 5. Journey-seeding activities (transcript entry + website note). Rapport rides
  // the transcript entry when there is one, else the website note — never both.
  let transcriptActivityId: string | null = null;
  let transcriptActivityAt = loggedAt;
  if (input.transcript?.trim()) {
    const p = await appendActivity(id, {
      type: 'transcript',
      title: r.summary || (r.error ? 'Call logged — automatic reading unavailable' : 'Call analysed'),
      detail: r.points.length ? r.points.map((p2) => `• ${p2}`).join('\n') : undefined,
      meta: {
        ...(r.angles.length ? { angles: r.angles } : {}),
        ...(r.rapport.length ? { rapport: r.rapport } : {}),
        ...(transcriptFileId ? { transcriptFileId } : {}),
      },
    });
    const act = p?.activities[0];
    if (act) { transcriptActivityId = act.id; transcriptActivityAt = act.at; }
  }
  const rapportOnTranscript = !!input.transcript?.trim() && r.rapport.length > 0;
  if (input.website?.trim() && r.companySummary) {
    await appendActivity(id, {
      type: 'note', title: 'Website summarised', detail: r.companySummary,
      meta: { website: r.websiteUrl, ...(!rapportOnTranscript && r.rapport.length ? { rapport: r.rapport } : {}) },
    }).catch(() => {});
  }

  // 6. First-call commitments → the calendar, grounded against the raw transcript.
  let detected = 0;
  if (transcriptActivityId && input.transcript?.trim() && r.events.length) {
    try {
      const grounded = groundEvents(
        id,
        { id: transcriptActivityId, at: transcriptActivityAt, haystack: input.transcript },
        r.events as RawEvent[],
      );
      if (grounded.length) { await upsertDetectedEvents(id, grounded); detected = grounded.length; }
    } catch { /* additive — never fail the intake for a calendar write */ }
  }

  const client = (await getClientProfile(id)) ?? fresh;
  return {
    client,
    intake: { companyName: r.companyName, summary: r.summary, companySummary: r.companySummary, provider: r.provider, error: r.error },
    calendar: { detected },
    transcriptFileId,
  };
}
