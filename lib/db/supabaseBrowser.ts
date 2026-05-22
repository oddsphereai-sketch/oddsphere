import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client.
 *
 * Uses the ANON key, which is subject to Row-Level Security policies. Safe
 * to import from any client component or browser-only code path.
 *
 * The client instance is memoized so React re-renders don't construct
 * multiple clients (which would each try to subscribe to auth state).
 *
 * ✅ Import from:
 *    • Client Components ("use client")
 *    • Browser-only hooks
 *    • Public-facing pages that don't need privileged data
 *
 * ❌ For privileged reads/writes (cron jobs, admin operations, anything that
 *    must bypass RLS), use `/lib/db/supabase.ts` instead.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL — check .env.local."
  );
}
if (!anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY — check .env.local."
  );
}

// Memoize so multiple imports share the same client instance.
let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}
