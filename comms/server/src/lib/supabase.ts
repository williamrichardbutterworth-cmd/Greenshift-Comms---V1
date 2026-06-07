import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Returns a Supabase client when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// set (production on Vercel), or null otherwise (local dev falls back to the
// JSON file store). The service-role key is server-only — never exposed to the
// browser — so it bypasses RLS; lock the table down to service-role access.

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}
