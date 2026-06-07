# Comms — project folder

Everything for the Green Shift Energy market-intelligence app ("Comms") lives here.

## What's inside

1. **Comms - Project Brief.md**
   The full plan / PRD: vision, users, feature scope, data-source research (free + paid),
   architecture, compliance, and a phased roadmap.

2. **comms/** — the runnable starter app
   A working scaffold you (or a developer) can run today. Backend = Node + Fastify;
   frontend = React + Vite + Tailwind. It boots with **sample data and no API keys**.

   Run it (two terminals):
   ```
   cd comms/server && cp .env.example .env && npm install && npm run dev   # http://localhost:8080
   cd comms/web    && npm install && npm run dev                           # http://localhost:5173
   ```
   Then open http://localhost:5173.

   - Add an `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in `comms/server/.env` to switch on
     the AI brief + report drafting. One line — `AI_PROVIDER=claude|openai` — picks the engine.
   - Set `USE_LIVE_MARKET_DATA=true` for free live data (Elexon + National Gas).

## To keep building

- **comms/docs/SYSTEM_PROMPT.md** — paste this to an AI coding agent (or read as a dev) to
  continue. It has the full context, conventions, brand colours, guardrails, and roadmap.
- **comms/docs/PROVIDERS.md** — copy-paste recipes to swap free → paid data/news and to add
  Word export.
- **comms/README.md** — setup + architecture reference.

## Brand

Logo green `#40A800` on white, charcoal ink `#2B2A2E`, IBM Plex type. The logo ships inside
the app at `comms/web/public/gse.png`.
