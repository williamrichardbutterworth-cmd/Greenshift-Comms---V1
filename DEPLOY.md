# Deploying Comms — Vercel + Supabase

This repo is set up to run as a **single Vercel project**:

- **Frontend** — the Vite app in `comms/web` → built to static files.
- **API** — the Fastify backend, served by **one Vercel serverless function** at `comms/api/[...path].ts` (same origin as the frontend → no CORS).
- **Storage** — the **Admin Ideas** board persists in **Supabase Postgres**. Everything else (market data, news, the AI daily brief) is fetched live and CDN-cached, so no database is needed for it.
- **Exports** — PDF + Word are generated **in the browser** (no Puppeteer/Chromium on the server).

> Local development is unchanged: `cd comms/server && npm run dev` and `cd comms/web && npm run dev`. With no Supabase env set, ideas fall back to a local JSON file.

---

## 1. Push to GitHub

A git repo + first commit are already created in this folder. Create an **empty** repo on github.com (no README/.gitignore), then:

```bash
cd "<this folder>"
git remote add origin https://github.com/<your-account>/<repo-name>.git
git push -u origin main
```

*(Or, if you install the GitHub CLI: `gh auth login` then `gh repo create comms --private --source=. --push`.)*

---

## 2. Set up Supabase

1. In your Supabase project: **SQL Editor → New query**, paste the contents of [`comms/supabase/schema.sql`](comms/supabase/schema.sql), and **Run**. This creates the `ideas` table (RLS on, locked to the service-role key).
2. Grab two values from **Project Settings → API**:
   - **Project URL** → `SUPABASE_URL`
   - **`service_role` secret key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ server-only — never put this in the frontend)

---

## 3. Import to Vercel

1. **Add New… → Project**, pick your GitHub repo.
2. **Root Directory: `comms`** ← important (the app lives in the `comms/` subfolder).
3. **Framework Preset: Other** (the build is driven by `comms/vercel.json`).
4. Add **Environment Variables** (Production + Preview):

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key (`sk-ant-…`) |
   | `AI_PROVIDER` | `claude` |
   | `CLAUDE_MODEL` | `claude-opus-4-8` |
   | `USE_LIVE_MARKET_DATA` | `true` |
   | `USE_LIVE_NEWS` | `true` |
   | `SUPABASE_URL` | your Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key |

5. **Deploy.** Vercel installs the function deps (`comms/package.json`), builds the web app, and serves it.

---

## 4. Verify

- `https://<your-app>.vercel.app/api/health` → `{"ok":true,...}`
- Open the app: Dashboard (live data), Daily Brief (AI), News, Report (draft → export PDF/Word), **Admin Ideas** (add one → it saves to Supabase; check the `ideas` table).

---

## ⚠️ Important: it's open to the public

You chose **no login** for now. The public URL means anyone who finds it can use every feature — including the AI endpoints (report draft, ideas summary), which **cost money** per call. The daily brief is CDN-cached so it's cheap, but report drafting is per-request.

Before sharing the URL widely, consider adding access control. Easiest options:
- **Vercel password protection** (Project → Settings → Deployment Protection) — one shared password, zero code.
- **Supabase Auth** (magic-link / email allowlist) — proper per-user login; ask and I'll wire it in (~an afternoon).

---

## Notes & troubleshooting

- **Costs:** `CLAUDE_MODEL=claude-opus-4-8` is the priciest/best model. Switch to `claude-sonnet-4-6` to cut AI cost materially at volume.
- **Function build fails?** Confirm Root Directory is `comms` and the env vars are set. The function bundles `comms/server/src` via `comms/api/[...path].ts`.
- **Ideas not saving in prod?** Check `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set and the schema was run. Without them the function silently uses the (ephemeral, non-persistent) file fallback.
- **`maxDuration`** is 30s (see `comms/vercel.json`) — comfortable for Opus drafts. Raise on Vercel Pro if needed.
- **Daily brief freshness:** it's CDN-cached for 6h; the first hit after expiry regenerates it. (A Vercel Cron to pre-warm it each morning is a small future add.)
