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

alter table public.client_profiles enable row level security;
