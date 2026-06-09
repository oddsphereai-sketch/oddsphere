/**
 * Phase 7F (Path A) — NBA-as-DailyEdge admin debug route.
 *
 * GET /api/admin/nba-as-daily-edge?date=YYYY-MM-DD  (date interpreted as ET)
 *
 * Phase 7G refactor: route now delegates the full NBA pipeline to the
 * shared `buildNbaDailyEdgeAdapted` service so this admin debug surface
 * and the member-facing /api/lab/daily-edge?sport=nba branch run the
 * exact same code. No behavioral drift between the two.
 *
 * READ-ONLY. Returns an MLB-shaped `DailyEdgeResponse` so the existing
 * DailyEdgeShell can render NBA games through MLB's components.
 *
 * Auth: admin gate. The preview-branch bypass was removed alongside
 * launch — now that NBA is member-facing, this debug route does not
 * need an unauthenticated bypass.
 */

import { validateAdminAuth } from "@/lib/auth/admin";
import { buildNbaDailyEdgeAdapted } from "@/lib/services/nba/buildNbaDailyEdgeAdapted";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  if (rawDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return new Response(
      JSON.stringify({
        error: "Invalid `date` format (expected YYYY-MM-DD, interpreted as ET slate date).",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const date = rawDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  try {
    const adapted = await buildNbaDailyEdgeAdapted(date);
    return new Response(JSON.stringify(adapted), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `nba-as-daily-edge failed: ${(e as Error).message}` }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
