-- Comms — Supabase schema.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

create extension if not exists "pgcrypto";

create table if not exists public.ideas (
  id          uuid        primary key default gen_random_uuid(),
  author      text        not null default 'Anonymous',
  title       text        not null,
  details     text        not null default '',
  reasoning   text        not null default '',
  category    text        not null default 'Other',
  status      text        not null default 'new'
                          check (status in ('new', 'considering', 'planned', 'done')),
  votes       integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- Demand-ranking index (most-voted, then newest).
create index if not exists ideas_rank_idx on public.ideas (votes desc, created_at desc);

-- Security: enable RLS with NO policies. The public anon key then has zero
-- access; only the service-role key (used server-side in the Vercel function,
-- never shipped to the browser) can read/write, because it bypasses RLS.
alter table public.ideas enable row level security;


-- ─────────────────────────── Report projects (§8B) ───────────────────────────
-- A saved, versioned client report. `inputs` is the client profile (ReportInputs),
-- `doc` is the TipTap/ProseMirror document JSON, `context` is the attached AI
-- context tray, and `versions` is a capped history of past snapshots. The server
-- treats doc/context/versions as opaque JSON — it never parses the document.

create table if not exists public.report_projects (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null default 'Untitled report',
  inputs      jsonb       not null default '{}'::jsonb,
  doc         jsonb       not null default '{"type":"doc","content":[]}'::jsonb,
  context     jsonb       not null default '[]'::jsonb,
  versions    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Most-recently-edited first (the projects panel ordering).
create index if not exists report_projects_updated_idx on public.report_projects (updated_at desc);

alter table public.report_projects enable row level security;


-- ─────────────────────── Reusable client profiles (§8C) ──────────────────────
-- Optional: saved client profiles reusable across reports.

create table if not exists public.client_profiles (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  inputs      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- CRM fields (added incrementally — safe to re-run): pipeline stage, milestone
-- tracker, activity timeline, and a last-touched timestamp.
alter table public.client_profiles add column if not exists stage      text        not null default 'new';
alter table public.client_profiles add column if not exists tracker    jsonb       not null default '{}'::jsonb;
alter table public.client_profiles add column if not exists activities jsonb       not null default '[]'::jsonb;
alter table public.client_profiles add column if not exists updated_at timestamptz not null default now();
create index if not exists client_profiles_updated_idx on public.client_profiles (updated_at desc);

alter table public.client_profiles enable row level security;


-- ─────────────────────── Uploaded files / media (§8B Batch 2) ────────────────
-- Metadata for files uploaded into a report (PDFs, Word docs, images). The file
-- bytes live in Supabase Storage (bucket `report-files`) in production, or in
-- server/data/uploads/ locally. `extracted_text` is the mined text used as
-- report context. Create the Storage bucket once (private):
--   Supabase → Storage → New bucket → name "report-files", Public = off.

create table if not exists public.client_files (
  id                uuid        primary key default gen_random_uuid(),
  client_profile_id uuid,
  project_id        uuid,
  name              text        not null,
  mime              text        not null default '',
  size              integer     not null default 0,
  storage_path      text        not null,
  extracted_text    text        not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists client_files_project_idx on public.client_files (project_id, created_at desc);

alter table public.client_files enable row level security;


-- ─────────────────────────── News system (§8A) ───────────────────────────────
-- User-curatable feed sources (seeded from the built-in list on first load).
create table if not exists public.news_feeds (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  url         text        not null,
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now()
);
alter table public.news_feeds enable row level security;

-- Saved-article library — articles pinned for reference in reports / on calls.
create table if not exists public.saved_articles (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,
  source        text        not null default '',
  url           text        not null default '',
  summary       text        not null default '',
  topic         text        not null default 'other',
  note          text        not null default '',
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists saved_articles_created_idx on public.saved_articles (created_at desc);
alter table public.saved_articles enable row level security;

-- Persisted "Headlines" — the biggest stories, kept over time (manually pinned
-- or auto-suggested), ranked by priority.
create table if not exists public.headlines (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,
  source        text        not null default '',
  url           text        not null default '',
  summary       text        not null default '',
  topic         text        not null default 'other',
  priority      integer     not null default 0,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists headlines_rank_idx on public.headlines (priority desc, created_at desc);
alter table public.headlines enable row level security;

-- User-definable document templates (seeded with built-ins on first load).
-- `sections` is the ordered list of {kind,heading,guidance|ref} the model fills.
create table if not exists public.document_templates (
  id          text        primary key default gen_random_uuid()::text,
  name        text        not null,
  description text        not null default '',
  channel     text        not null default 'document',
  icon        text,
  guidance    text        not null default '',
  sections    jsonb       not null default '[]'::jsonb,
  builtin     boolean     not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists document_templates_created_idx on public.document_templates (created_at desc);
alter table public.document_templates enable row level security;

-- Forward-curve snapshots — the daily UK power baseload + NBP gas season tables
-- from the morning market report (operator pastes/uploads it, AI extracts it).
-- `curves` is [{ commodity, unit, legs:[{label,latest,prev,current}] }].
create table if not exists public.forward_curves (
  id          text        primary key default gen_random_uuid()::text,
  as_of_date  date,
  source      text        not null default 'Market report',
  note        text,
  curves      jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists forward_curves_asof_idx on public.forward_curves (as_of_date desc, created_at desc);
alter table public.forward_curves enable row level security;

-- Report-system upgrade: templates gain a kind tag (drives the exported
-- letterhead subtitle + disclaimer set) and a cover subtitle. Idempotent so an
-- existing document_templates table picks them up on re-run.
alter table public.document_templates add column if not exists report_kind text;
alter table public.document_templates add column if not exists subtitle    text;


-- ─────────────────────────── Calendar events ─────────────────────────────────
-- Detected + manual calendar events behind the Calendar tab. A broker never types
-- these in: detection mines the client timeline (transcripts/notes/emails) for
-- forward commitments and writes provenance-backed rows here. Contract-end /
-- renewal-window markers are NOT stored — the web app computes those live from
-- each meter's contractEnd. `dedupe_key` is a deterministic provenance hash with a
-- UNIQUE index, so re-running detection updates the same row instead of
-- duplicating it. Detected events soft-delete (status 'dismissed', row kept) so a
-- re-scan can't resurrect a dismissed item.
create table if not exists public.calendar_events (
  id                 uuid        primary key default gen_random_uuid(),
  dedupe_key         text        not null,
  title              text        not null default '',
  start_at           timestamptz not null,
  end_at             timestamptz,
  all_day            boolean     not null default true,
  kind               text        not null default 'manual',
  origin             text        not null default 'manual',
  status             text        not null default 'open'
                                 check (status in ('open', 'done', 'dismissed', 'snoozed')),
  client_profile_id  uuid,
  meter_ref          text,
  source             text,
  source_activity_id text,
  confidence         text,
  note               text,
  owner_id           text,
  snoozed_until      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists calendar_events_dedupe_idx on public.calendar_events (dedupe_key);
create index if not exists calendar_events_start_idx  on public.calendar_events (start_at);
create index if not exists calendar_events_client_idx on public.calendar_events (client_profile_id);
alter table public.calendar_events enable row level security;
