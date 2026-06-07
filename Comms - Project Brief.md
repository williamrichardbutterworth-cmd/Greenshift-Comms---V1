# Green Shift Energy — Internal Market Intelligence App
### Project Brief & Build Roadmap (v1.0)

**Prepared for:** Green Shift Energy Consulting (greenshiftenergy.co.uk)
**Audience:** Internal — lead generation & closing / pricing teams
**Working name:** *Market Desk* (placeholder — rename as preferred)
**Status:** Brief for sign-off → build

---

## 1. The one-paragraph summary

We are building an **internal-only web app** that gives every agent a single, always-current view of the UK gas and electricity markets, turns that data into **plain-English talking points** they can use live on calls, and lets closers **auto-generate a branded, client-ready report** (PDF or Word) in minutes instead of hours. It pulls the most reputable live UK market data available, layers a **daily market review** built from real news and real figures, and flags **geopolitical events that actually move our market** (e.g. Strait of Hormuz tensions, LNG supply shocks) so agents can demonstrate genuine, up-to-the-minute expertise to prospects.

The app exists to do one job: **make every agent sound like the most informed person in the conversation, and make every closer faster at proving it on paper.**

---

## 2. Why this matters (the business case)

Green Shift positions itself as a *consultancy*, not a transactional broker — bulk buying power **plus** ongoing account management and genuine market expertise. That positioning only holds up if agents can actually talk about the market with authority. Today that knowledge lives in individuals' heads and varies wildly by experience level. This app levels that up:

| User | What they get | Outcome |
|---|---|---|
| **Lead gen / discovery** | Live figures, clear charts, daily talking points, geopolitical hooks, ready-made discovery questions | Sounds expert from day one; opens stronger conversations; books more qualified appointments |
| **Closer / pricing specialist** | Everything above **+** automated, tailored, branded reports built from live data and evidence | Closes on logic and proof; turns a half-day report into a 15-minute job; higher conversion on large accounts |

**Net effect:** shorter ramp time for new hires, consistent expert positioning across the floor, and dramatically less admin time per deal.

---

## 3. Who uses it & the core jobs-to-be-done

1. *"I'm about to dial. Give me today's three best talking points and the headline numbers."*
2. *"A prospect just mentioned the Middle East / oil prices / their bill going up — what's the relevant, accurate angle?"*
3. *"What questions should I ask to open up a discovery conversation about their procurement?"*
4. *"I've had a great call with a 5-site manufacturer. Generate a tailored, branded report backing up my recommendation, with live data and the news I referenced, ready to email."*
5. *"Show me where the market is and where it's heading, simply enough that I can explain it to a non-expert."*

---

## 4. What the app must do — feature scope

Scoped using **MoSCoW** (Must / Should / Could / Won't-yet) so we can ship value early and grow incrementally.

### 4.1 Live Market Dashboard — **MUST**
- Headline **wholesale gas** price (NBP, GBp/therm) and **wholesale electricity** price (£/MWh), with day-on-day and week-on-week movement.
- GB **electricity**: day-ahead / market index price, current demand, generation mix (wind/gas/nuclear/imports).
- GB **gas**: system supply vs demand, storage/LNG status, linepack, System Average Price.
- Simple, glanceable charts (last 24h, 7d, 30d, 12m). **Plain-English plain-number first; charts second.**
- A "**What this means**" line under each metric (auto-generated) so a non-analyst instantly understands it.

### 4.2 Daily Market Review & Talking Points — **MUST**
- A short daily briefing (auto-generated each morning) summarising: where the market moved, why, and **what to say about it**.
- A **"Talking Points" panel**: 3–5 ready-to-use facts, statements and discovery questions, refreshed daily and tied to the live data.
- A **Geopolitical / News feed**, filtered to stories that genuinely affect UK energy (Middle East / shipping / LNG / EU gas / weather / policy), each with a one-line "how to use this on a call" note.
- Everything relevance-filtered to **UK B2B procurement** — no irrelevant firehose.

### 4.3 Automated Report Generator — **MUST**
- Agent fills a short form: **client name, company, sites/meter info, contract context** (a few simple variables).
- Agent pastes / selects **supporting evidence**: live data snapshots, chosen news items, projections, their own notes.
- App drafts the narrative (executive summary, market outlook, rationale, recommendation) from that input.
- Agent reviews/edits, then **exports a beautifully branded PDF and/or editable Word document** ready to email.
- **Human review step is mandatory before export** (see §9 Compliance).

### 4.4 Should / Could (later phases)
- **Should:** per-user accounts & report history; saved client profiles; light role separation (lead gen vs closer views); attribution/disclaimers baked into outputs.
- **Could:** forward-curve charts (season-ahead / year-ahead — premium data, §6); carbon (UKA) price; a "scenario" projection tool; email-send from inside the app; mobile-friendly quick-glance mode for agents between calls.
- **Won't-yet (out of scope for v1):** CRM replacement, live quoting/pricing engine, supplier tendering automation, customer-facing login. Keep the app a *knowledge & reporting* tool, not a system of record.

---

## 5. Recommended technology stack

Chosen for: fast delivery, low running cost, easy to maintain by a small team, and a clean separation of **content/data from code** (a principle we want to carry through). This builds naturally on the React/Vite direction already in mind.

| Layer | Recommendation | Why |
|---|---|---|
| **Frontend** | **React + Vite + TypeScript + Tailwind CSS**, with **shadcn/ui** components | Fast, modern, matches existing plan; shadcn gives clean, professional UI quickly; easy to brand |
| **Charts** | **Recharts** (or Chart.js) | Simple, good-looking, well-supported |
| **Backend / API** | **Node.js + Fastify (or Express) + TypeScript** | Protects API keys server-side; runs scheduled jobs; handles report generation. Keep it a separate service from the frontend |
| **Database** | **PostgreSQL** (hosted: **Supabase** or **Neon**) — or **SQLite** to start | Stores users, daily reviews, saved reports, client profiles. SQLite is fine for the first internal version |
| **Scheduled jobs** | **node-cron** (or host scheduler: Render Cron / Railway) | Generates the daily review and refreshes data on a schedule |
| **AI synthesis** | **Anthropic Claude API** (Messages endpoint) | Turns raw data + headlines into the daily review, talking points, and report narrative. This is the engine behind the "expert voice" |
| **PDF export** | **Puppeteer** (headless Chrome → renders a branded HTML template to PDF) | Best route to *genuinely beautiful, on-brand* PDFs — full control of fonts, colours, layout |
| **Word export** | **docxtemplater** (fill a branded .docx template with placeholders) | Produces an editable Word doc the closer can tweak before sending |
| **Auth** | **Email allowlist + magic-link** (e.g. Auth.js) — or **Clerk** for speed | Small internal team; per-user accounts enable report attribution & history |
| **Hosting** | Frontend on **Vercel/Netlify**; backend on **Railway / Render / Fly.io** | Cheap, simple, scales to a small team. (A single VPS also works if preferred) |

> **Simpler alternative if a single deployable unit is preferred:** build the whole thing in **Next.js** (App Router) on Vercel — frontend, API routes and cron in one place. Trade-off: PDF generation via Puppeteer needs a serverless-friendly Chromium (`@sparticuz/chromium`) or an external PDF service. For an internal tool with heavy PDF needs, the **Vite + separate Node backend** route above is cleaner.

---

## 6. Live market data — the sources (this is the heart of the app)

The guiding rule: **reputable, live, and relevant to UK B2B energy procurement.** Below is the recommended sourcing strategy, tiered by cost. **Start free, add paid only where it clearly earns its place.**

### Tier 1 — Free, authoritative fundamentals (use from day one)

| Source | What it gives us | Access | Notes |
|---|---|---|---|
| **Elexon Insights Solution** (BMRS) | GB **electricity**: market index / day-ahead price (£/MWh, APX & N2EX), system demand, generation mix, imbalance prices | Public **REST API**, **no API key required**, returns JSON/CSV/XML | `developer.data.elexon.co.uk`. **Commercial use is permitted but requires source attribution** under the BMRS Data Licence Terms — we must display the attribution |
| **National Gas Data Portal** | GB **gas**: live & forecast supply/demand, flows, storage & LNG, linepack, System Average Price, Composite Weather Variable | Open data, **REST API** (migrating off SOAP), 12,000+ data items | `data.nationalgas.com`. Open data under their Gas System Operator licence |

These two cover the **fundamentals** an agent needs to sound credible: where prices are, what demand is doing, how tight the system is, and the renewables/weather story.

### Tier 2 — Affordable headline traded prices (recommended for MVP polish)

| Source | What it gives us | Cost | Notes |
|---|---|---|---|
| **Trading Economics API** | NBP UK gas (GBp/therm), TTF, Brent crude, plus forecasts | Paid subscription (tiered) | Good single source for the "market headline" prices agents quote; also has forecast data |
| **OilPriceAPI** | UK natural gas (GBp/therm) and other benchmarks, timestamped | Free API key tier available | Lightweight, cheap way to show a live UK gas benchmark |
| **Barchart** (ICE-sourced) | UK natural gas / power futures quotes | Paid API tiers (delayed data on lower tiers) | Closer to traded futures; heavier/pricier |

> Tradeable headline prices (NBP gas, Brent) ultimately originate from **ICE**. The affordable APIs above republish reference prices — perfectly fine for *agent talking points and reports* (clearly labelled "indicative / for information"). They are **not** a basis for live quoting.

### Tier 3 — Premium forward curves (later upgrade, only if needed)

The **forward curve** (season-ahead, year-ahead power & gas) — the prices a fixed contract is actually built on — is the genuinely expensive data. Providers: **ICE**, **Montel**, **LCP Delta / EnAppSys**, **ICIS**, **S&P Global Commodity Insights**. These run into real money and licensing. **Recommendation: do not buy this for v1.** Revisit only once the tool is embedded and we know closers specifically need live forward curves in reports. In the interim, forward-looking commentary can use Trading Economics forecasts + the daily review narrative.

### Supporting (free, nice-to-have)
- **Open-Meteo** (free weather API) — temperature drives demand; a simple "cold snap incoming" signal adds colour.
- **NESO / gov.uk / Ofgem** open data & RSS — policy, capacity, network charge changes (feeds the non-commodity-cost story).

---

## 7. News, geopolitics & the "Daily Review" engine

This is what makes agents sound *current*. The approach combines a **curated, reputable feed** with **AI synthesis** — not a generic news dump.

### 7.1 News sourcing — curated RSS first
A hand-picked list of **reputable energy + macro sources** via their RSS feeds gives us free, reliable, *relevant* coverage that we control. Suggested starting set (confirm/curate):
- Reuters (Energy / Commodities), S&P Global Commodity Insights, Argus / ICIS headlines, OilPrice.com, Energy Live News, Montel headlines
- UK official: NESO, National Gas notices, Ofgem, gov.uk energy
- Macro/geopolitical: Reuters World, plus **GDELT** (free, no key) for event-level geopolitical signals

### 7.2 Optional paid enrichment
If keyword search + sentiment is wanted (e.g. auto-catch every "Strait of Hormuz", "LNG", "TTF", "NBP" story and score it):
- **Marketaux** — financial news + sentiment, **free tier ~100 requests/day**, paid for production volume
- **NewsData.io / NewsAPI.org / GNews** — broader coverage; note NewsAPI's commercial plan is pricey (~$449/mo) and GNews paid tiers start ~$84/mo. **Marketaux or NewsData are the better-value starting points.**

### 7.3 The synthesis layer (the clever bit) — Claude API
A scheduled morning job feeds **today's market data + the curated headlines** into the **Claude API** with a tightly-scoped prompt, producing:
- A **Daily Market Review** (≈150 words, plain English): what moved, why, what it means for UK businesses.
- **3–5 Talking Points**: a fact, a statement, and a discovery question agents can use verbatim.
- A **Geopolitical hook list**: relevant world events + a one-line "how to raise this on a call" each.

This keeps the output **on-message, relevant, and consistent** across the floor — and it's the same engine that drafts report narratives (§8), so we build it once.

> **Worked example (the Hormuz case):** the job ingests a Reuters story on Strait of Hormuz tensions + today's NBP gas tick. Claude returns: *"~20% of global LNG transits Hormuz; renewed tension is supporting gas prices this week. Talking point: 'With the situation in the Gulf pushing wholesale gas up, businesses fixing now are insulating themselves from that volatility — is price certainty something you've thought about for your next contract?'"* — accurate, relevant, immediately usable.

---

## 8. The Report Generator — how it works

**Flow:**
1. **Inputs (variables):** client name, company, contact, site(s)/meters, current supplier & contract end, consumption band — a short form.
2. **Evidence:** agent selects live data snapshots (auto-pulled from the dashboard at that moment), picks relevant news items, and adds their own projections/notes.
3. **Draft:** Claude API turns inputs + evidence into structured narrative — *Executive Summary, Market Context, Outlook, Our Recommendation, Supporting Evidence*.
4. **Review & edit:** agent reviews on screen and edits freely (**mandatory** — see §9).
5. **Export:** one click → **branded PDF** (Puppeteer + HTML template) and/or **editable Word** (docxtemplater). Both carry Green Shift branding, the data-as-of timestamp, source attributions, and a standard disclaimer.
6. **(Phase 4)** Save to report history against the client profile; optional email-send.

**Design principle:** templates and brand assets live as **separate template files**, not hard-coded — so branding can be updated without touching app logic (consistent with our content/code separation goal).

---

## 9. Compliance, accuracy & risk — read before building

The app surfaces market data and auto-generated content that may reach clients. As a third-party intermediary in a regulated market, we must build the right guardrails in from the start. (This is also reputational: bad numbers in a client report do more harm than no report.)

- **Indicative-data labelling:** all prices shown and exported are labelled *"indicative, for information only — not a price quotation."* Live quoting stays in our normal supplier process.
- **Not advice:** reports carry a clear note that market commentary is **general information, not a personal financial recommendation.**
- **Mandatory human review:** **no AI-drafted content reaches a client without an agent reviewing and approving it.** The export button sits *after* a review screen. AI drafts, humans sign off.
- **Source attribution:** Elexon (BMRS Data Licence Terms) and National Gas data **must** be attributed wherever displayed/exported. Build attribution into the dashboard footer and report template.
- **"Data as of" timestamps:** every figure and report shows when the data was pulled. Stale data is flagged.
- **API key security:** all third-party and Claude API keys live **server-side only**, never in the frontend bundle.
- **TPI conduct context:** keep an eye on the evolving UK third-party intermediary regulation landscape (Ofgem's expected mandatory registration framework). Building accuracy, transparency and disclaimers in now means we're ahead of it.
- **Cost guardrails:** rate-limit/cron-cache external API calls so we don't blow through free tiers or rack up Claude usage; cache the daily review rather than regenerating per user.

---

## 10. System architecture (at a glance)

```
                    ┌─────────────────────────────────────────┐
   Scheduled job ──▶ │ BACKEND (Node + Fastify, server-side)    │
   (daily/hourly)    │                                          │
                     │  • Fetch: Elexon API, National Gas API,  │
   Market data ─────▶│    headline price API                    │
   News (RSS/API) ──▶│  • Fetch & curate: RSS feeds / news API  │
                     │  • Synthesise: Claude API → daily review, │
                     │    talking points, report narratives     │
                     │  • Generate: Puppeteer (PDF), docx (Word) │
                     │  • Store: Postgres (reviews, reports,     │
                     │    users, client profiles)                │
                     └───────────────┬──────────────────────────┘
                                     │  clean JSON / file downloads
                                     ▼
                     ┌─────────────────────────────────────────┐
   Agents (browser) │ FRONTEND (React + Vite + Tailwind)        │
                    │  • Live Market Dashboard                   │
                    │  • Daily Review + Talking Points panel     │
                    │  • Geopolitical news feed                  │
                    │  • Report Generator (form → review →export)│
                    └─────────────────────────────────────────┘
```

Keys and heavy work stay on the backend; the frontend just renders clean data and triggers report generation/downloads.

---

## 11. Brand & design direction

**Goal:** an internal tool that feels like a natural extension of greenshiftenergy.co.uk — professional, clean, sustainability-led, data-dense but uncluttered.

**Observed brand character (from the site):** modern B2B energy consultancy; clean white/light sections with photographic imagery and video; "Green Shift" sustainability identity; partners with Shell Energy, ENGIE, UGP, Jellyfish; confident, reassuring, plain-English tone ("simple & hassle-free", "your shift to better energy").

**Recommended look for the internal app:** a **clean dark UI with the Green Shift green as the accent** — data reads beautifully on dark, it suits an at-a-desk tool used all day, and a single strong brand-green accent keeps it unmistakably *Green Shift*. (This also dovetails with the dark, minimalist aesthetic already used in the Call Command tool — consistent internal-tooling feel.) A light theme matching the website is a straightforward alternative if preferred.

> **Exact brand colours — action for build:** the precise hex values weren't machine-readable from the live site in research. Before styling, lock them by either (a) opening greenshiftenergy.co.uk and using browser inspect/eyedropper on the logo, header and buttons, (b) pulling the global colours from the site's WordPress/Divi theme settings, or (c) taking them from the official brand/logo asset files. Capture: **primary green, dark/near-black neutral, light/off-white background, and one or two greys.** Set these as **CSS variables / Tailwind theme tokens** so the whole app (and report templates) are themed from one place.

**Typography:** match or complement the website's font; default to a clean professional sans (e.g. Inter) if the brand font isn't available for app use. **Logo:** use the official `gse.png` (and a white/mono version for the dark UI and report headers).

---

## 12. Phased roadmap — the trackable path to live

Five phases. **Phase 1 is "live and useful" internally**; Phases 2–4 layer on the flagship features. Tick boxes as you go — this section *is* the tracker.

### Phase 0 — Foundations & decisions  *(target: week 1)*
- [ ] Confirm app name and lock brand colours/fonts/logo (per §11)
- [ ] Create the repo (frontend + backend), set up TypeScript, Tailwind, shadcn
- [ ] Decide hosting (Vercel + Railway/Render) and create projects
- [ ] Sign up & get keys: **Elexon** (free account for scripting key/portal — note the no-key REST API too), **National Gas** portal account, **Claude API**, chosen headline-price API, chosen news API (if any)
- [ ] Decide auth approach (magic-link allowlist vs Clerk) and the initial user list
- [ ] Stand up a "hello world" frontend + backend talking to each other, deployed

### Phase 1 — Live Market Dashboard (MVP) ✅ *first usable release*  *(target: weeks 2–3)*
- [ ] Backend: fetch & normalise Elexon electricity data (price, demand, generation mix)
- [ ] Backend: fetch & normalise National Gas data (supply/demand, storage, SAP)
- [ ] Backend: fetch headline NBP gas + Brent price
- [ ] Cache responses and expose clean JSON endpoints to the frontend
- [ ] Frontend: dashboard with headline numbers, day/week movement, and 24h/7d/30d/12m charts
- [ ] Frontend: auto "What this means" line under each metric
- [ ] Source attribution + "data as of" timestamps in the footer
- [ ] Deploy and get the team using it 🎯 **MILESTONE: app live internally**

### Phase 2 — Daily Review & Talking Points  *(target: weeks 4–5)*
- [ ] Curate the RSS source list; build the RSS ingestion + de-duplication job
- [ ] (Optional) wire in Marketaux/NewsData for keyword search + sentiment
- [ ] Build the Claude synthesis job → Daily Market Review + 3–5 talking points
- [ ] Build the geopolitical hook list with "how to use on a call" notes
- [ ] Frontend: Daily Review panel, Talking Points panel, News feed
- [ ] Schedule the morning job; cache the daily output (one generation, all users)
- [ ] 🎯 **MILESTONE: agents get fresh daily ammunition automatically**

### Phase 3 — Report Generator  *(target: weeks 6–8)*
- [ ] Build the input form (client/company/site/contract variables)
- [ ] Build evidence selection (snapshot live data + pick news items + free notes)
- [ ] Claude narrative drafting from inputs + evidence
- [ ] **Review & edit screen** (mandatory before export)
- [ ] Design the branded HTML report template + Puppeteer PDF export
- [ ] Design the branded .docx template + docxtemplater Word export
- [ ] Bake in disclaimers, attribution, timestamps
- [ ] 🎯 **MILESTONE: closers generate branded client reports in minutes**

### Phase 4 — Hardening, roles & history  *(target: weeks 9–10)*
- [ ] Per-user accounts, report history, saved client profiles
- [ ] Light role separation (lead-gen view vs closer view)
- [ ] Cost guardrails, monitoring, error handling, data-freshness alerts
- [ ] Compliance pass (disclaimers, attribution, review-gate verified)
- [ ] (Optional) email-send from the app; mobile quick-glance mode
- [ ] (Optional, revisit) premium forward-curve data integration
- [ ] 🎯 **MILESTONE: full vision live, robust, ready to scale across the floor**

---

## 13. How we'll know it worked (success metrics)

- **Adoption:** % of agents opening the app daily before calls
- **Speed:** average time to produce a client report (target: a half-day task → under ~15 minutes)
- **Volume:** number of branded reports generated per week
- **Quality signal:** agents reporting they used a talking point / news hook on a live call
- **Ramp:** new-hire time-to-confidence on market conversations
- **Conversion (directional):** appointment-to-close rate on accounts where a report was used

---

## 14. Decisions needed from you (to unblock the build)

1. **App name** and the **light vs dark** UI direction (recommended: dark with green accent).
2. **Exact brand colours/fonts** (or confirm we extract them from the site — §11).
3. **Budget appetite** for paid data/news: free-only MVP, or add Trading Economics + Marketaux (modest monthly cost)? Premium forward curves — defer (recommended) or in-scope?
4. **Auth:** magic-link allowlist (free, minimal) or Clerk (fastest)? And the **initial user list**.
5. **Build resourcing:** are we building this in-house, with a contractor, or do you want me to generate the starter repo + system prompt so a developer (or you) can begin immediately?

---

## 15. Suggested immediate next step

Say the word and I'll produce, as the next deliverable, a **build-starter pack**: the repo structure, a developer-ready system prompt (in the same style as the Call Command starter), the exact data-source endpoint list to hit first, and a one-page "Phase 1 in a weekend" plan so you can see live data in the app fast.

---

*Sources referenced for data/news options: Elexon Insights (developer.data.elexon.co.uk, bmrs.elexon.co.uk), National Gas Data Portal (data.nationalgas.com), Trading Economics API (tradingeconomics.com/api), OilPriceAPI, Barchart, Marketaux, NewsData.io, GNews, GDELT. Pricing/availability current as of June 2026 and should be reconfirmed at build time.*
