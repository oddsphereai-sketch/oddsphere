import { validateCronAuth } from "@/lib/cron/auth";
import { supabase } from "@/lib/db/supabase";
import { runTrackingIntegrityAudit } from "@/lib/services/audit/trackingIntegrityAudit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
/** Authenticated SELECT-only operational proof. No providers, alerts or writes. */
export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const report = await runTrackingIntegrityAudit({ client: supabase });
    return Response.json({ ok: report.errors === 0, report }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
