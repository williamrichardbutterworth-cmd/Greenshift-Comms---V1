# Comms — Progress Tracker

> Single source of truth for what's done / in-flight / next. Updated 2026-06-25.
> Legend: ✅ shipped to `main` · 🟡 built + reviewed, ready to push · ⬜ next · 💡 backlog

---

## Operating notes (read first)

- **Monorepo**: `comms/web` (React 18 + Vite + TS + Tailwind) · `comms/server` (Fastify, `logger:false`, esbuild → `dist/app.js`) · `comms/api/[...path].ts` (Vercel serverless wrapping Fastify via `inject()`).
- **Persistence (dual-path)**: Supabase when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, else local JSON in `comms/server/data/` (gitignored).
- **AI**: `getAI()` → Claude (`claude-opus-4-8`, **rejects sampling params**) | OpenAI. All AI endpoints degrade gracefully (never 500). Vision supported via `images[]` on `AIGenerateOptions`. No "AI" in user-facing copy.
- **Verification gates** (run ALL before commit): `cd comms/server && npm run typecheck && npm run build` · `cd comms/web && npm run build` · `cd comms && npx tsc --noEmit -p tsconfig.json`.
- **Push**: commit straight to `main` (single-dev). End commit msgs with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `gh` auth = `williamrichardbutterworth-cmd`.
- **Brand**: green `#40A800`, greenDark `#318300`, tint `#F4FAEF`, ink `#2B2A2E`, muted `#6B6A70`. Recharts `isAnimationActive={false}` mandatory. Compliance disclaimers mandatory on client docs.
- **⚠️ DEPLOY (Supabase)**: re-run `comms/supabase/schema.sql` at each deploy — it now adds `forward_curves`, the `client_profiles` CRM columns, `document_templates` + its `report_kind`/`subtitle` columns. Prod CRM/templates/forward-curve break without it. `CLAUDE_MODEL` env must be `claude-opus-4-8` (Fable 5 not on this account). **LOA needs NO schema change** (LOA fields live in `client_profiles.inputs` jsonb).
- **⚙️ ENV (optional)**: `COMPANIES_HOUSE_API_KEY` (free from developer.company-information.service.gov.uk) enables live Companies House verification in the LOA builder; without it that lookup degrades to manual entry (everything else works). Web-scrape uses no key (plain fetch + AI; JS-only sites yield little).

---

## Shipped to main ✅

| Commit | What |
|---|---|
| `5bacb64` | Phase 2 + 3 UI overhaul (PR #1) |
| `6a2c047` | Advanced customizable dashboard — carbon intensity, generation map, KPIs, report bridge |
| `c15cfbe` | Custom document-template engine + email channel |
| `9e0ce66` | Live client CRM — pipeline stage, tracker, activity timeline, AI intake + next-step |
| `10c24f9` | Smoother client-creation flow + client-first overview |
| `82202a1` | Forward-curve procurement engine — paste/screenshot → vision extract → backwardation read + client report bridge |
| `d78e59d` | Report engine (dynamic identity, KPI/recommendation/comparison blocks, evidence/disclaimer layer, 4 UK report templates) + revamped client view (stage rail, **talk-track angles**, media bank) + forward curve plots **every** contract |
| `1de5794` | Document-builder overhaul — insert-at-cursor, grouped **Insert ▾** menu, **Outline ▾** jump-nav, live word/page count, zoom 60–140%, menus hidden on email surface (adversarial-reviewed, 8 findings fixed) |
| `c4aef2b` | Angles/conversations → report — one-click **Draft follow-up** from the talk track (seeds a post-call-followup email with the client's angles) + **Past conversations** tray that grounds any draft in selected timeline entries (summary/points/angles fed as prompt context). Browser-verified end-to-end. **No schema change.** |
| `b52dee4` | **Desktop-first overhaul ① shell** — left **Sidebar** nav (grouped Market Intelligence / Client Work, collapsible, persisted) replaces the top-tab Header; design tokens (`3xl` screen, `content`/`wide` max-w, `--topbar-h`/`--sidebar-w` vars killing the magic 57/76/110px sticky offsets); Dashboard tiles into a responsive 2-col grid on wide screens; `CollapsibleSection` animated + optional `persistKey`. |
| `43a6911` | **Overhaul ② document workspace** — the editor is its own **Documents** section with a **tab strip** for concurrent reports. `WorkspaceProvider` (`workspace/WorkspaceContext.tsx`) holds open docs above the section switch (survive navigation); `DocumentStudio` (keyed per tab, per-session autosave + unmount flush); `DocumentsSection` (tabs + empty state); `ClientsHome` (slimmed CRM); `NewDocumentFlow` (shared create flow). **Split the 735-line `ReportGenerator` god-component.** |
| `35a0e82` | **Overhaul ③ panel polish** — setup-tray Client profile grouped (Identity/Contract/Consumption); **References & media** → Articles\|Files tabs with an image-thumbnail **gallery**; update-logger decluttered (composer vs separated Quick-log row); new-client form grouped. |
| `890d97d` | **LOA ① server** — `COMPANIES_HOUSE_API_KEY` + `companiesHouse.ts` (search/getCompany, Basic auth, graceful-degrade), `loaIntel.ts` (`extractLoaFields` + `scrapeCompanyWebsite`), `prompts.loaExtractPrompt`/`LOA_FIELD_KEYS`, `routes/loa.ts` (`/api/companies-house/*`, `/api/loa/{scrape,extract}`). |
| `6ed5c94` | **LOA ② flagship** — new **Letters of Authority** sidebar section, per-client. Stores the ACTUAL template (`web/public/loa-template.pdf`) + fills it via **pdf-lib overlay** at measured coords (page-1 fields + page-2 signature block). `lib/loa.ts` (13-field model, per-field provenance, `deriveLoaFromClient`, completeness, `fillLoaPdf`), `LoaSection.tsx` (builder: source badges, known/missing, manual edit, Read-from-conversations, Companies-House verify, fuel/services, Generate→download). |
| `f150196` | **LOA ③ website scrape** — ClientCreate "Company website" → Fetch scrapes → company summary + harvested LOA fields/fuel/services ride onto the client (`inputs.loa/website/companySummary/customerVariables`). |
| `8e63082` | **LOA ④ client-hub** — LOA completeness + customer-variables panel in the expanded client view. |
| `843a413` | **Client journey flow map** — depth-styled (no WebGL) **Overview ⇄ Journey** view in the client hub: stage flowchart (current elevated, future receding), **captured ideas** (call angles), a flowing step-spine from the timeline, and a glowing **next-step** frontier (Generate-this-step / Add-the-next-step). `components/ClientJourney.tsx`. |
| `4c95e31` | **Email dialogue management** — new **Emails** view in the client hub (Overview ⇄ Journey ⇄ Emails): full conversation as in/out bubbles + AI **next-email/reply** drafting (auto reply-vs-follow-up, grounded in the thread + talk-track angles, hedged), Copy + Mark-as-sent + Log-received. Server `prompts.emailDraftPrompt`/`emailDrafter.ts`/`routes/email.ts` (`POST /api/email/draft`); web `components/EmailThread.tsx`, `api.email.draft`. **No schema change.** |
| `bee1289`→`2f1708a` | **LOA + client-creation strategic update** — (1.1) LOA values now **vertically centred** in their cells (single `vy` baseline model, measured) matching the broker block; (1.2) **auto-population** — MPAN/MPRN from the client's meters, "N/A" by fuel, phone from transcript, site=business address; (1.3) **missing-field** flags (amber on the template + chip list); (1.4) **sources of truth** (colour dots per field + legend). **3-step client-creation wizard** (`ClientCreate`: Website → Transcript → Media → one analysis) backed by a comprehensive **client intake** (server `clientIntakePrompt`/`clientIntake.ts`, `POST /api/client/intake`) that scrapes the site + reads the transcript + bill text/images into ONE rich profile incl. a **meters[]** array (per-meter MPAN/MPRN/site/supplier/contract-end/consumption). New **comprehensive client record** in the hub (`ClientProfilePanel`: captured fields shown, blanks hidden, Edit&add reveals all + a meters editor). `lib/clientProfile.ts`. **No schema change.** |
| `3ea5b4c` | **LOA visual editor + spacing fix** — LOA generation is now a live **visual panel**: the real 2-page template (`public/loa-page-{1,2}.png`) with every field overlaid where it prints, **edit-in-place + drag-to-reposition** (`LoaVisualEditor.tsx`); one exported `LOA_FIELD_POS` drives editor + fill; `fillLoaPdf(values,{positions})` adds drag overrides + per-field maxWidth + **shrink-to-fit/wrap** (fixes overflow). **Moved "What they buy" (fuel/services) OUT of the LOA** into the client hub (`CustomerVariablesEditor.tsx`) — it's a client attribute that tailors reports, not an LOA detail. Layout persists on `inputs.loaLayout`. |

---

## Ready to push 🟡

- _(nothing in flight)_

---

## Next up ⬜ (user-chosen, in order)

> **"Full pipeline system" brief (2026-06-26) — COMPLETE.** LOA automation (`890d97d`→`8e63082`), 3D flow map → depth-styled journey (`843a413`), and email dialogue management (`4c95e31`) all shipped. Nothing outstanding on this brief.
> - **LOA follow-ups** — let the user upload/replace the LOA template in-app (coords are currently hardcoded to the supplied Green Shift template); store generated LOAs via `fileStore` (clientProfileId) not just download; vision-extract LOA fields from an uploaded scan (reuse `extractForwardCurve` images path); auto-search Companies House on customerName.

1. [ ] **Pipeline + needs-attention** — cross-client board by stage (`STAGES` in `lib/crm.ts`); a "contracts ending < N months with no renewal milestone" list that auto-suggests the Renewal / Out-of-contract templates (reuse `recommendNextStep` plumbing + `templateId` mapping).
2. [ ] **Richer media bank** — image/PDF thumbnails, drag a client bill onto the report page, in-app preview. (`fileStore` + `ClientHub` media bank + studio `loadFiles` merge already exist.)
3. [ ] **Bill OCR → auto-fill** — vision extraction of uploaded energy bills (supplier, MPAN, rates, consumption, end date) → auto-fill the client + pre-fill the comparison table. Pattern: `extractForwardCurve` vision flow; note `fileStore` does NOT OCR images, so send the image to the model.

---

## Backlog 💡
- Budget/cost-forecast, switching-proposal, carbon-snapshot report templates (the "next/later" report taxonomy).
- Auto-forward email ingestion for the forward curve.
- Outline as a persistent left rail (currently a dropdown).
- Per-block move/duplicate buttons (drag-reorder already works via the block handle).

---

## Key files map
- **Forward curve**: server `services/forwardCurveStore.ts`, `routes/forwardCurve.ts`; web `lib/forwardCurve.ts` (`analyzeCurve`/`curveSignal`/`legOrderKey`/`chartLegs`), `components/ForwardCurvePanel.tsx`, `ForwardCurveIntake.tsx`, `editor/nodes/ForwardCurve.tsx`.
- **Report engine**: server `services/templatesStore.ts` (reportKind/subtitle, `refreshBuiltins`, 7 seeds), `prompts.ts` (HOUSE_RULES hedged; `forwardCurveExtractPrompt`; `sourceAnalysisPrompt` returns `angles`; `AssembleContext.linkedConversations` + `contextBlock` append), `reportGenerator.ts`; web `lib/exportReport.ts` (dynamic identity, figure captions, `allDisclaimers`), `lib/buildDocFromSections.ts`, `editor/nodes/{KpiStrip,RecommendationBox,ComparisonTable}.tsx`, `editor/CommsEditor.tsx`.
- **UI shell (desktop-first)**: web `App.tsx` (flex shell; section state + sidebar-collapse persisted via `lib/usePersisted.ts`), `components/Sidebar.tsx` (`Tab` union + `NAV` + section labels; Documents badge), `lib/usePersisted.ts`. Tokens in `tailwind.config.js` (`3xl`, `content`/`wide` max-w) + `index.css` (`--topbar-h`/`--sidebar-w`). Sticky offsets reference `var(--topbar-h)`.
- **Document workspace**: web `workspace/WorkspaceContext.tsx` (`WorkspaceProvider`/`useWorkspace`: open-doc `Map`/`order`/`activeId`, `openDoc`/`openDocById`/`closeDoc`/`updateProject`/`requestNewDoc`, hosts `NewDocumentFlow`), `components/DocumentsSection.tsx` (tab strip + empty state), `components/DocumentStudio.tsx` (the studio — editor + setup tray, keyed per tab, per-session autosave + unmount flush; **the old ReportGenerator studio**), `components/NewDocumentFlow.tsx` (picker→client-form→project; `templateId` skips the picker). Lazy-loaded so TipTap stays out of the main bundle.
- **CRM**: server `services/clientProfilesStore.ts`; web `components/ClientsHome.tsx` (the Clients section — CRM home/hub, hands docs to the workspace), `ClientHub.tsx` (talk track + **Draft follow-up** + media bank + decluttered logger), `ClientCreate.tsx` (grouped fields), `ClientProfileForm.tsx` (`seedAngles` → folds into the project's `agentNotes`, never the durable profile). The **Past conversations** tray + `linkedConversations` plumbing now lives in `DocumentStudio.tsx` (per-session; selection persisted via `buildContext`/`restoreContext`).

- **LOA**: server `config.ts` (`companiesHouseApiKey`/`companiesHouseConfigured`), `services/companiesHouse.ts`, `services/loaIntel.ts` (`extractLoaFields`/`scrapeCompanyWebsite`), `prompts.ts` (`loaExtractPrompt`/`LOA_FIELD_KEYS`), `routes/loa.ts`; web `lib/loa.ts` (`LOA_FIELDS`, `deriveLoaFromClient`, `loaCompleteness`, **`fillLoaPdf`** pdf-lib overlay w/ measured coords), `components/LoaSection.tsx`, template asset `web/public/loa-template.pdf`. LOA data lives in `client.inputs.loa` (`{[key]:{value,source}}`) + `inputs.customerVariables` ({fuel,services}) — schemaless, no migration.

## ⚠️ Correctness invariants (don't regress)
- **Backwardation = curve SLOPE** (`furthest < front`), NEVER a single cheap interior leg. `curveSignal()` (`backwardation|value|contango`) drives panel chrome + headline + exported narrative *together*.
- Forward chart plots all contracts via `chartLegs` sorted by `legOrderKey` (DA < months < quarters < seasons); the seasonal strip still drives the backwardation read.
- Client-bank files shown in the report studio are badged "client" and protected from destructive delete (deleting there would destroy the client's source doc app-wide).
- A doc's "Our recommendation" text section is auto-routed into a `recommendationBox`; data blocks are gated off the email surface; `emailText()` preserves recommendation prose.
- **LOA geometry is ONE map**: `LOA_FIELD_POS` (`lib/loa.ts`, pt coords) drives BOTH the on-screen `LoaVisualEditor` (overlays on `public/loa-page-{1,2}.png`, displayed at `SCALE`) AND `fillLoaPdf` (pdf-lib overlay on `public/loa-template.pdf`, baseline `y = 842 - (y + 9)`) — keep them sharing the map so WYSIWYG holds. Coords are template-specific: if the template PDF is swapped, **re-measure with pymupdf `get_text('words')` AND re-render the page PNGs**. Single-line text shrinks-to-fit `maxWidth`; multi-line wraps; per-field drag overrides live in `inputs.loaLayout`. LOA fields use empty-string === unknown; `deriveLoaFromClient` seeds from the profile without clobbering saved values. **Customer variables (fuel/services) are NOT LOA data** — they live in `inputs.customerVariables`, edited in the client hub, and tailor reports.
- **Document workspace**: `DocumentStudio` is keyed by `project.id` and remounts per active tab (one live editor; background tabs are pure session state). It seeds ALL state from the `project` prop at mount and IGNORES later prop changes; edits autosave (debounced) AND flush on unmount (optimistic `updateProject` + server save) so switching tabs / navigating away never loses edits. Any new per-doc state must live in the studio (not lifted) and round-trip via the project record. Opening a doc (`openDoc`/`openDocById`) also navigates to the Documents section.
- **Linked conversations + handed-off angles are PROMPT TEXT only** — fed via `contextBlock` ("restate or build on these, do NOT invent beyond them") / `agentNotes`, never an embed `ref`, so `VALID_REF`/`sanitiseSections` are untouched and no figure can be echoed as a firm price. `assemble()` reads LIVE tray state (not the persisted `ContextItem[]`), so any new context channel must be wired into BOTH the `assemble()` payload AND `buildContext`/`restoreContext`. The conversations tray is read-only (never mutates `profile.activities`).
</content>
