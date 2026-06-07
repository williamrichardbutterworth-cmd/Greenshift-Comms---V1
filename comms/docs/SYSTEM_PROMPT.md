# Comms — Build System Prompt

Paste this to an AI coding agent (or read it as a developer) to continue building **Comms**.
It is the single source of truth for what we're making, how it's structured, and the rules
to keep following. The repo is already scaffolded and runs; your job is to extend it.

---

## 1. Mission

You are building **Comms**, an internal web app for **Green Shift Energy Consulting** — a UK
B2B energy consultancy / third-party intermediary serving SMEs. Comms is a tool for our own
sales agents (lead-generation and closers). It does three things:

1. **Live dashboard** — UK gas & electricity prices, demand, generation mix, at a glance.
2. **Daily market brief** — AI-written review + ready-to-use talking points, discovery
   questions, and geopolitically-relevant "call angles" (e.g. Strait of Hormuz → gas prices).
3. **Report generator** — a few client inputs + selected evidence → a branded, client-ready
   PDF. AI drafts; the agent edits before sending.

The audience is non-expert business owners (via our agents), so everything is plain, confident
UK English. The tool's value is turning live market reality into words an agent can say on a call.

## 2. Operating principles (do not violate)

- **Free first, paid-ready.** Use free data/news today (Elexon, National Gas, RSS). Make any
  paid upgrade a drop-in: a new provider file behind an existing interface + a `.env` key.
  Never hard-wire a vendor into app logic.
- **AI is vendor-neutral and swappable.** Claude *or* OpenAI, chosen by one env var
  (`AI_PROVIDER`). Everything goes through the `AIProvider` interface. Keys live **server-side
  only**; the browser never sees them.
- **Always runnable.** The app must work with zero keys via sample data + graceful fallback.
  A failed/absent source degrades quietly; it never crashes the page.
- **Content ≠ code.** All AI prompts live in `server/src/services/prompts.ts`. Tune voice there.
- **No authentication yet.** Keep setup frictionless. Design so auth can be added later, but
  don't add it now.
- **Compliance is part of the product** (see §7). Don't strip disclaimers or attribution.

## 3. Current state (already built)

- **Backend** (`server/`, Node + Fastify + TS, ESM, run via `tsx`):
  - Provider layers: `providers/ai` (Claude + OpenAI behind `AIProvider`), `providers/marketData`
    (Elexon + National Gas + headline price + sample, merged by an aggregator), `providers/news`
    (curated RSS + sample).
  - Services: `prompts.ts`, `dailyReview.ts` (6h-cached AI brief), `reportGenerator.ts`
    (AI draft → Puppeteer PDF).
  - `templates/report.ts` (branded HTML, logo inlined, attribution + disclaimer in footer).
  - Routes: `/api/health`, `/api/market`, `/api/daily-review` (+ `/refresh`), `/api/news`,
    `/api/report/draft`, `/api/report/pdf`, `/api/report/docx` (501 stub).
  - `jobs/scheduler.ts`: warms the brief at 07:00 Mon–Fri.
- **Frontend** (`web/`, React + Vite + TS + Tailwind):
  - `Header` (tabbed nav), `Dashboard` (metrics + sparklines + generation mix), `DailyReview`
    + `TalkingPoints`, `NewsFeed`, `ReportGenerator` (inputs → evidence → AI draft → edit → PDF).
  - Typed API client in `lib/api.ts`. Brand theme in `tailwind.config.js`.
- **Known integration points to verify/finish:** Elexon dataset paths & field mapping;
  National Gas Data Items (currently stubbed); OilPrice gas code; RSS feed list; Word export.

## 4. Architecture & conventions

- Two independent npm packages: `server/` and `web/`. Vite dev-proxies `/api` → `:8080`.
- **Backend:** TypeScript ESM, extensionless relative imports, Fastify route plugins as
  `async (app) => { app.get(...) }`. Config is centralised in `config.ts` (read env once).
  Every external call uses `lib/http.ts` (timeout) and is wrapped so failure → fallback, never a
  500 on the happy path. In-memory TTL cache in `lib/cache.ts` (swap for Redis only if multi-instance).
- **Frontend:** functional components + hooks. No global state library needed yet (lift state in
  `App.tsx`). Tailwind utility classes + the component classes in `index.css` (`.card`,
  `.btn-primary`, `.btn-ghost`, `.input`, `.label`). Use `lib/api.ts` for all requests; don't
  scatter `fetch`. **No browser storage** for now (no localStorage); keep state in React.
- Keep diffs additive and preserve existing structure/visual design. Don't rename or re-theme
  without reason; match what's there.

## 5. Brand system (exact)

- **Green** `#40A800` (primary accent, sampled from the logo) · **green-dark** `#318300` (hover)
  · **green tint** `#F4FAEF` (subtle fills/badges).
- **Ink** `#2B2A2E` (text) · **muted** `#6B6A70` · **line** `#E7E8E6` · **surface** `#FAFBFA`.
- **Semantic:** price up `#C2410C`, price down `#2E7D32`. Brand green is for accents, not deltas.
- **Type:** IBM Plex Sans (UI) + IBM Plex Mono (figures/prices). Loaded in `index.html`.
- **Theme:** clean, light, calm, data-forward — matches the literal brand (white bg, charcoal,
  green). Refined minimalism, not flashy. The logo (`web/public/gse.png`) sits on white.

## 6. Coding standards

- TypeScript `strict`. Type the boundaries (API client mirrors server response shapes in `lib/api.ts`).
- Small, named functions; clear comments only where intent isn't obvious.
- New AI work: add a prompt builder in `prompts.ts`, call via `getAI()`, catch the
  not-configured error and degrade to a helpful placeholder (don't crash).
- New endpoints: thin route → service → provider. Routes don't contain business logic.

## 7. Guardrails (energy/compliance)

- Show prices as **indicative / for information — not a price quotation**. The UI and report say so.
- AI output is **general market commentary, not financial advice**. Prompts (`HOUSE_RULES`)
  forbid inventing figures/events; the model may use **only** the data/headlines passed in.
- Reports are **AI-drafted, human-reviewed before sending** — keep the explicit edit step.
- Preserve **data attribution** (e.g. Elexon BMRS) end-to-end into the dashboard and report footers.

## 8. Roadmap (extend in this order)

- **Phase 0 — foundations (done):** scaffold, providers, sample data, AI abstraction, theme.
- **Phase 1 — live dashboard:** verify Elexon dataset endpoints + mapping; implement National Gas
  Data Items (demand/supply/storage/SAP); confirm OilPrice code. Add day-on-day `changePct` from
  real series. Goal: dashboard fully live and correct.
- **Phase 2 — daily brief:** tighten prompts; add per-metric AI "what this means"; optional paid
  news enrichment (Marketaux) behind the existing interface.
- **Phase 3 — reports:** wire Word export (docxtemplater — see PROVIDERS.md §4); add a couple of
  report layouts; optional save/recall of past reports.
- **Phase 4 — hardening:** add authentication (per-agent accounts), rate limiting, deploy, and
  swap paid data feeds (Trading Economics / Montel / ICIS) when approved.

## 9. How to extend (mechanics)

See **`docs/PROVIDERS.md`** for copy-paste recipes to: add a market-data provider, add a news
provider, add an AI engine, and wire Word export. The rule of thumb: **implement the existing
interface, register the new file, add the env key — change nothing else.**

## 10. Definition of done (per change)

- Runs with **no keys** (sample data) *and* with keys (live) — both paths tested.
- A failing external source degrades gracefully; no uncaught errors reach the user.
- Disclaimers + attribution intact. Prompts unchanged unless the task is prompt-tuning.
- Matches the brand tokens and existing component style. `npm run typecheck` (server) and
  `npm run build` (web) pass.
