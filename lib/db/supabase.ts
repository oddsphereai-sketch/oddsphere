import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * Uses the SERVICE-ROLE key, which BYPASSES Row-Level Security. This means
 * any code holding this client can read and write anything. Treat it as a
 * privileged credential.
 *
 * ✅ Import from:
 *    • /app/api/* (route handlers)
 *    • /app/api/cron/* (cron jobs)
 *    • /lib/services/* (service layer)
 *    • Server Components (no "use client")
 *    • Standalone server scripts (seed, migrations, etc.)
 *
 * ❌ NEVER import from:
 *    • Client Components ("use client")
 *    • Client-side hooks
 *    • Any code that runs in the browser
 *
 * Browser code should use `/lib/db/supabaseBrowser.ts` instead.
 *
 * Session persistence is disabled — server-side requests are stateless.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL — check .env.local."
  );
}
if (!serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY — paste from Supabase Dashboard → Settings → API → service_role."
  );
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
