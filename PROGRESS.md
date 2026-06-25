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
- **⚠️ DEPLOY (Supabase)**: re-run `comms/supabase/schema.sql` at each deploy — it now adds `forward_curves`, the `client_profiles` CRM columns, `document_templates` + its `report_kind`/`subtitle` columns. Prod CRM/templates/forward-curve break without it. `CLAUDE_MODEL` env must be `claude-opus-4-8` (Fable 5 not on this account).

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

---

## Ready to push 🟡

- _(nothing in flight)_

---

## Next up ⬜ (user-chosen, in order)

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
- **CRM**: server `services/clientProfilesStore.ts`; web `components/ClientHub.tsx` (talk track + **Draft follow-up** button + media bank), `ClientCreate.tsx`, `ClientProfileForm.tsx` (`seedAngles` → folds into the project's `agentNotes`, never the durable profile), `ReportGenerator.tsx` (`loadFiles` merges client files; `loadConvos` + **Past conversations** tray → `assemble()` payload `linkedConversations`; selection persisted via `buildContext`/`restoreContext`).

## ⚠️ Correctness invariants (don't regress)
- **Backwardation = curve SLOPE** (`furthest < front`), NEVER a single cheap interior leg. `curveSignal()` (`backwardation|value|contango`) drives panel chrome + headline + exported narrative *together*.
- Forward chart plots all contracts via `chartLegs` sorted by `legOrderKey` (DA < months < quarters < seasons); the seasonal strip still drives the backwardation read.
- Client-bank files shown in the report studio are badged "client" and protected from destructive delete (deleting there would destroy the client's source doc app-wide).
- A doc's "Our recommendation" text section is auto-routed into a `recommendationBox`; data blocks are gated off the email surface; `emailText()` preserves recommendation prose.
- **Linked conversations + handed-off angles are PROMPT TEXT only** — fed via `contextBlock` ("restate or build on these, do NOT invent beyond them") / `agentNotes`, never an embed `ref`, so `VALID_REF`/`sanitiseSections` are untouched and no figure can be echoed as a firm price. `assemble()` reads LIVE tray state (not the persisted `ContextItem[]`), so any new context channel must be wired into BOTH the `assemble()` payload AND `buildContext`/`restoreContext`. The conversations tray is read-only (never mutates `profile.activities`).
</content>
