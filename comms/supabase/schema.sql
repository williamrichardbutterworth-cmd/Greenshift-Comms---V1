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
