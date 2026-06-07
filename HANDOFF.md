# Comms — Project Handoff & Next-Phase Brief

> **Purpose of this file:** hand a fresh AI chat (or developer) everything needed to resume work on **Comms** instantly — current state, architecture, how to run/deploy, hard-won gotchas, and the next set of features to build. Read this top-to-bottom first, then skim the codebase.

---

## 0. TL;DR — how to resume

- **Comms** is an internal market-intelligence web app for **Green Shift Energy** (UK B2B energy consultancy). It gives sales agents a live UK gas/electricity dashboard, an AI daily market brief, a news feed, an editable AI-drafted client-report generator (PDF + Word), and an **Admin Ideas** board.
- It is **LIVE** on Vercel + Supabase: **https://greenshift-comms-v1.vercel.app**
- Code: monorepo in `comms/` — `web/` (React/Vite frontend) + `server/` (Fastify backend) + `api/` (the Vercel serverless wrapper).
- **Local dev:** `cd comms/server && npm run dev` (:8080) and `cd comms/web && npm run dev` (:5173). Works with zero cloud setup (sample/file fallbacks).
- **It deploys automatically** on every push to `main` (GitHub repo is public; Vercel is connected).
- The two big things to build next are a **multi-feed/categorised News system** and a **full inline report editor + project reporting panel with an AI context tray** — see §8.

---

## 1. What Comms is (product)

Audience: Green Shift's own sales agents (lead-gen + closers) talking to UK businesses about energy procurement. Everything is plain, confident UK English; the value is turning live market reality into words an agent can say on a call and put in a client report.

Five tabs today: **Dashboard · Daily Brief · News · Report · Admin Ideas**.

Compliance is part of the product (keep these): prices are **indicative / not a quotation**; AI output is **general commentary, not financial advice**; reports are **AI-drafted, human-edited before sending**; data **attribution** (Elexon BMRS, National Gas) flows to the dashboard + report footers.

---

## 2. Live deployment & access

| Thing | Value |
|---|---|
| **Live URL** | https://greenshift-comms-v1.vercel.app |
| **GitHub** | https://github.com/williamrichardbutterworth-cmd/Greenshift-Comms---V1 (public) |
| **Hosting** | Vercel (Hobby). Frontend static + one serverless function. |
| **Database** | Supabase (Postgres) — project URL `https://wuobbmbksgyngpslyzwi.supabase.co` |
| **Vercel Root Directory** | `comms` (reads `comms/vercel.json`) |
| **AI** | Anthropic Claude, model `claude-opus-4-8` (the best model — confirmed via the `claude-api` skill; **note: Opus 4.7/4.8 reject `temperature`/sampling params**, so the Claude provider must not send them). |

**Deploys:** push to `main` → Vercel auto-builds. Commits must be authored by the repo owner's GitHub identity for Hobby private repos — the repo is **public**, so any author deploys. Build = `npm --prefix server install && npm --prefix server run build && npm --prefix web install && npm --prefix web run build`, output `web/dist`.

**Environment variables (set in Vercel → Settings → Environment Variables):**
`ANTHROPIC_API_KEY`, `AI_PROVIDER=claude`, `CLAUDE_MODEL=claude-opus-4-8`, `USE_LIVE_MARKET_DATA=true`, `USE_LIVE_NEWS=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…` key).

**Secrets location (do NOT hardcode in the repo):**
- Local: `comms/server/.env` (gitignored) holds `ANTHROPIC_API_KEY` + flags. Supabase is **not** set locally → ideas use the JSON-file fallback. To exercise Supabase locally, add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to that file (values are in the Vercel dashboard).
- Production: all keys are Vercel env vars. The Supabase **service-role** key is server-only.

---

## 3. Architecture

**Production (Vercel):**
- `comms/web` → Vite static build (served from `web/dist`).
- `comms/api/[...path].ts` → **one** Node serverless function. It boots the Fastify app and dispatches each request via `app.inject()` (this avoids the serverless request-stream body gotcha — Vercel pre-parses JSON into `req.body`, which we pass as the inject payload). Using ONE catch-all function keeps us under Vercel's function limit and reuses every route unchanged.
- The Fastify backend is **pre-bundled** by esbuild into `comms/server/dist/app.js` during the build (`server` `npm run build`), and the function dynamic-imports that bundle. (Without bundling, the serverless ESM runtime can't resolve the cross-directory extensionless TS imports → `ERR_MODULE_NOT_FOUND`.)
- `comms/vercel.json` rewrites: `/api/(.*) → /api/[...path]` (routes ALL nested API paths to the function — the catch-all alone did NOT match multi-segment paths) and `/((?!api/).*) → /index.html` (SPA fallback that excludes `/api`).
- **Supabase** stores the Admin Ideas (`ideas` table). Daily brief / market / news are CDN-cached via `Cache-Control` headers (cheap, no DB).
- **Exports run client-side** (no Puppeteer/Chromium on the server) — jsPDF + `docx`, charts rasterised SVG→PNG in the browser.

**Local dev:** `server/src/index.ts` runs the same `buildApp()` as a long-lived Fastify server on :8080 + the node-cron scheduler; `web` runs Vite on :5173 and proxies `/api` → :8080. Ideas fall back to `server/data/ideas.json` when Supabase env is absent.

---

## 4. Repo map (key files)

```
comms/
├─ api/[...path].ts        # Vercel serverless function: wraps Fastify via inject()
├─ package.json            # ROOT deps for the function (fastify, anthropic, openai, supabase, rss-parser, dotenv)
├─ tsconfig.json           # for the function + server bundling
├─ vercel.json             # buildCommand, outputDirectory, functions, rewrites
├─ supabase/schema.sql     # ideas table (run once in Supabase SQL editor)
├─ server/
│  ├─ src/
│  │  ├─ app.ts            # buildApp(): Fastify + CORS + route registration (no listen/cron)
│  │  ├─ index.ts          # LOCAL entry: buildApp() + scheduler + listen
│  │  ├─ config.ts         # reads env once
│  │  ├─ lib/{http,cache,supabase}.ts
│  │  ├─ routes/{market,review,news,report,ideas}.ts   # thin routes (+ Cache-Control headers)
│  │  ├─ services/{prompts,dailyReview,reportGenerator,priceHistory,ideasStore}.ts
│  │  └─ providers/
│  │     ├─ ai/{index,claude,openai,json,types}.ts      # AIProvider interface (claude|openai)
│  │     ├─ marketData/{index,elexon,nationalGas,brent,headlinePrice,mock,types}.ts
│  │     └─ news/{index,rss,feeds,mock,types}.ts
│  └─ package.json         # has "build" = esbuild bundle of src/app.ts -> dist/app.js
├─ web/
│  ├─ src/
│  │  ├─ App.tsx, components/Header.tsx (tabs)
│  │  ├─ components/{Dashboard,MetricCard,DailyReview,TalkingPoints,NewsFeed,ReportGenerator,IdeasBoard}.tsx
│  │  └─ lib/{api.ts, exportReport.ts, chartSvg.ts}     # typed API client + client-side PDF/Word + chart SVG
│  └─ ...
└─ docs/{SYSTEM_PROMPT.md, PROVIDERS.md}
DEPLOY.md   (root)         # deployment steps
```

---

## 5. Data sources (all live, free)

- **Electricity — Elexon BMRS** (`data.elexon.co.uk/bmrs/api/v1`, no key): day-ahead power = `/balancing/pricing/market-index` filtered to `APXMIDP` non-zero (N2EX returns 0); demand = `/datasets/INDO` (MW→GW); generation mix = `/datasets/FUELINST` (group `INT*`→Imports, drop negatives, friendly fuel names; no embedded solar in this dataset).
- **Gas — National Gas** (`data.nationalgas.com/api/find-gas-data-download`, no key, CSV): demand = `PUBOB623` (mcm/day); System Average Price = `PUBOB47` (p/kWh → p/therm). Storage % isn't published here (would need AGSI+).
- **Brent crude — Yahoo Finance** chart API (`query1.finance.yahoo.com/v8/finance/chart/BZ%3DF`, no key) → live + up to 1y history.
- **Price history endpoint** (`/api/market/history?series=brent|gas|power&range=3m|6m|12m`) powers report charts: Brent 1y (Yahoo), UK gas SAP 1y (National Gas), power ~90d (Elexon paginated).
- **News — curated RSS** (`server/src/providers/news/feeds.ts`), live.

> Everything is behind provider interfaces and degrades to sample data on failure. Free→paid is a drop-in (see `docs/PROVIDERS.md`).

---

## 6. Run / build / deploy + gotchas

```bash
# local
cd comms/server && npm install && npm run dev   # :8080
cd comms/web    && npm install && npm run dev    # :5173  (open this)

# checks
cd comms/server && npm run typecheck
cd comms/web    && npm run build                 # tsc -b && vite build
cd comms        && npx tsc --noEmit -p tsconfig.json   # the serverless function

# deploy = git push origin main  (Vercel auto-builds)
```

**Hard-won gotchas (don't re-learn these):**
1. **No Puppeteer on Vercel** — PDF/Word are client-side (`web/src/lib/exportReport.ts`). jsPDF needs image **compression** (`'FAST'`/`'MEDIUM'`) or the PDF balloons to multiple MB.
2. **Bundle the backend** — esbuild `--bundle --format=esm --packages=external` → `server/dist/app.js`; the function imports that. Plain TS imports don't resolve in the serverless ESM runtime.
3. **Route nested `/api/*`** — needs the explicit `"/api/(.*)" → "/api/[...path]"` rewrite; the catch-all alone only matched single-segment paths. `req.url` IS preserved through that rewrite (so Fastify routing via inject works).
4. **SPA rewrite must exclude `/api`** (`"/((?!api/).*)"`) or it returns `index.html` for API calls.
5. **Opus 4.8 rejects `temperature`** — the Claude provider must omit sampling params.
6. **Supabase + file fallback** — `lib/supabase.ts` returns null when env is unset; `ideasStore` then uses the JSON file. Keep this dual path so local dev needs no Supabase.
7. **`web/tsconfig.node.json`** must not be `composite` + `noEmit` together (it emits to `node_modules/.tmp`) or `npm run build` fails.
8. **Git** — the GitHub repo is on a separate account; pushes were done with a fine-grained PAT via a one-off `http.extraheader` (never stored in the repo). Repo is public so commit author no longer matters for deploys.

---

## 7. Conventions & guardrails (keep following)

- **Free-first, paid-ready**; **AI vendor-neutral** (Claude *or* OpenAI via `AI_PROVIDER`, behind `AIProvider`); **keys server-side only**.
- **All AI prompts live in `server/src/services/prompts.ts`** (content ≠ code). Tune voice there.
- **Always runnable** with zero keys (sample/file fallbacks); a failed source degrades quietly.
- **Brand:** green `#40A800`, green-dark `#318300`, tint `#F4FAEF`, ink `#2B2A2E`, muted `#6B6A70`, line `#E7E8E6`; up `#C2410C`, down `#2E7D32`; IBM Plex Sans/Mono; clean light UI; logo `web/public/gse.png`.
- **Compliance:** indicative-pricing + not-advice disclaimers, human-review-before-export, source attribution — all already wired; don't strip.

---

## 8. WHAT TO BUILD NEXT (the new requirements)

### 8A. News — multi-feed, categorised, curatable
The current News tab is a single live RSS feed. Level it up:
- **Keep the Live feed** (recent updates / relevant market movements).
- **Add a "Headlines" category** — the biggest stories of the last months/year: the major talking points, *persisted* over time (not just the ephemeral live feed). Likely needs a stored/curated set (Supabase table) + AI to identify/keep "headline-worthy" stories.
- **Multiple / selectable news feeds & sources** — let users add and choose which feeds are active.
- **Categories / filters** (e.g. by topic: geopolitics, gas, power, policy, macro) so agents can find the right angle fast.
- **A curated "library"** — let users save/pin articles so they're "to hand" to reference in reports and on calls.
- Articles must be **referenceable in the report generator** and easy to cite on a call.

*Implementation ideas:* Supabase tables `news_feeds` (user-curated feed list) + `saved_articles`/`headlines`; an AI classification/curation step that tags articles by topic and flags headline-worthy ones; category tabs + "save to library" actions; the report evidence picker pulls from the saved library too.

### 8B. Report creation — full inline editor + project reporting panel + AI context tray
This is the big one. Take the report generator from "edit blocks → export" to a **full document editor with a project workspace**:
- **Full inline (WYSIWYG) document editor** — users edit the report document directly (rich text), reorder/format freely, with AI assistance — and export it (PDF + Word, building on the existing client-side exporter).
- **Project reporting panel** — manage reports as saved **projects** (create, name, save, list, revisit, version) persisted in Supabase. Report history + saved client profiles.
- **An AI "context tray"** in the report generator: users attach ANYTHING as context, and the AI fits it into the relevant report sections automatically. Attachables include:
  - **Custom charts with custom data/statistics** — a **chart/diagram builder in the app** (user inputs data → builds a chart/diagram), plus AI-analysed charts. Charts embed into the document (reuse the SVG→PNG path for export).
  - **Relevant news articles** (from the curated library, §8A) as context.
  - **Client/business info** — the structured fields already captured: Company, Contact name, Contact detail, Sites/meters, Current supplier, Contract end, Annual consumption, Notes/your projections (budget, risk appetite, renewal goals).
  - **Daily market brief** content — to build the case for purchasing/fixing now.
  - **Any other context** the user attaches (free notes, files, market snapshots).
- **Full flexibility over input/output and organisation** — users control what goes in and where, but **automation + generation stay first-class** (one click to draft/assemble; AI maps attached context to sections; per-section regenerate; inline AI edit commands like "make concise"/"add the data").

*Implementation ideas:* a rich-text editor (TipTap/Lexical/Slate); a "context tray" UI that lists attached items and lets the AI place them; a data-table→chart builder (Recharts) with an "analyse" AI pass; persist `reports`/`report_projects` + `client_profiles` in Supabase; extend `exportReport.ts` to render the rich-text document; report templates; optional email-send.

### 8C. Other worthwhile ideas
- **Saved client profiles** + **report history** (reusable across reports).
- A reusable **evidence library** (saved news, charts, market snapshots) draggable into any report.
- **Auth (Supabase Auth)** before wider rollout — the app is currently **open to the public**, so AI endpoints (report draft, ideas summary) cost money on every anonymous hit. Add magic-link/email-allowlist, or at minimum Vercel password protection.
- Vercel Cron to pre-warm the daily brief each morning.

Keep changes additive, match the existing brand + component style, and preserve the compliance guardrails.
