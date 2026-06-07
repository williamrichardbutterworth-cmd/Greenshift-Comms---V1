# Comms — Green Shift Energy market intelligence

Internal web app for our sales team. Three jobs:

1. **Dashboard** — live UK gas & power prices, demand, and generation mix at a glance.
2. **Daily brief** — an AI-written market review with ready-to-use talking points, discovery questions, and geopolitical "call angles", refreshed every weekday morning.
3. **Reports** — turn a few client details + selected evidence into a branded, client-ready PDF. AI drafts it; the agent edits before sending.

It runs **free** today (public data + RSS news) and is built so paid data feeds and either AI engine (Claude **or** OpenAI) can be swapped in by changing config — no rewrites. There is **no login yet**, by design, to keep setup simple.

---

## Prerequisites

- **Node.js 20+** and npm
- (Optional) an **Anthropic** or **OpenAI** API key to switch the AI features on
- The first `npm install` in `server/` downloads Chromium for Puppeteer (used for PDF export) — give it a minute.

## Quick start (two terminals)

```bash
# Terminal 1 — backend API (http://localhost:8080)
cd server
cp .env.example .env        # works as-is with sample data; no keys required
npm install
npm run dev

# Terminal 2 — web app (http://localhost:5173)
cd web
npm install
npm run dev
```

Open **http://localhost:5173**. Out of the box you'll see the dashboard populated with **sample data**, live RSS news, and a prompt to add an AI key for the brief/reports.

## Turn the real things on

Everything below is just editing `server/.env`:

| To enable | Do this |
|---|---|
| **AI brief + report drafting** | Set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY=…` (or `AI_PROVIDER=openai` + `OPENAI_API_KEY=…`). Update the model string if needed. |
| **Live market data** | Set `USE_LIVE_MARKET_DATA=true`. Uses free Elexon (electricity) + National Gas — no key. Anything that fails silently falls back to sample data. |
| **Free headline gas price** | Add `OILPRICE_API_KEY` (free tier) and confirm `OILPRICE_GAS_CODE`. |
| **Switch AI engine** | Change the single `AI_PROVIDER` line. Nothing else changes. |

> Sample data, live data, and AI are independent. You can run any combination.

## How it's built (and why swapping is easy)

Everything external sits behind a small **provider interface**, so the rest of the app never knows or cares which vendor is behind it:

- **AI** — `server/src/providers/ai/` — `ClaudeProvider` and `OpenAIProvider` both implement one `AIProvider` interface. `getAI()` returns whichever `AI_PROVIDER` names.
- **Market data** — `server/src/providers/marketData/` — each source (Elexon, National Gas, headline price) is a `MarketDataProvider`. An aggregator merges them **over** sample data by metric id, so the dashboard is always full even if a source is down.
- **News** — `server/src/providers/news/` — a curated RSS list today; a paid provider is a drop-in.

**Free → paid** is therefore: write one new provider file, add it to the list, drop a key in `.env`. Step-by-step in [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

All **prompts** live in one file (`server/src/services/prompts.ts`) so the product's "voice" is easy to tune without touching code paths.

## Project structure

```
comms/
├─ server/                 # Node + Fastify + TypeScript API
│  └─ src/
│     ├─ providers/        # ai · marketData · news  (the swappable bits)
│     ├─ services/         # prompts, dailyReview, reportGenerator
│     ├─ templates/        # branded report HTML (logo inlined)
│     ├─ routes/           # /api/market, /api/daily-review, /api/news, /api/report/*
│     └─ jobs/             # weekday 07:00 brief warm-up (node-cron)
├─ web/                    # React + Vite + Tailwind frontend
│  └─ src/
│     ├─ components/       # Dashboard, DailyReview, NewsFeed, ReportGenerator …
│     └─ lib/api.ts        # typed API client
└─ docs/
   ├─ SYSTEM_PROMPT.md     # hand this to an AI/dev to keep building
   └─ PROVIDERS.md         # free → paid upgrade guide
```

## Compliance notes (don't strip these)

- Prices shown are **indicative / for information only — not a price quotation**, and the app says so.
- AI output is **general market commentary, not financial advice**, and prompts forbid inventing figures.
- Reports are **AI-drafted, human-reviewed before sending** — the flow enforces an edit step.
- Free data carries **attribution requirements** (e.g. Elexon BMRS). Attribution strings flow through to the dashboard footer and report footer — keep them.

## Roadmap

- **Now:** dashboard, daily brief, report PDF — free data, AI on.
- **Next:** verify/curate live endpoints & feeds; Word export (docxtemplater); per-metric AI "what this means".
- **Later:** paid data feeds (Trading Economics / Montel / ICIS), saved reports, and authentication when you're ready to add accounts.
