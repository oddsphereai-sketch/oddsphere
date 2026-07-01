import { validateCronAuth } from "@/lib/cron/auth";
import { auditDailyEdgeBoards } from "@/lib/services/dailyEdgeDeepAudit";

export const maxDuration = 60;

const SPORTS = ["mlb", "wnba", "soccer"] as const;

export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const { GET: dailyEdgeGet } = await import("@/app/api/lab/daily-edge/route");
  const origin = new URL(request.url).origin;
  const boards: Record<string, unknown> = {};

  for (const sport of SPORTS) {
    const response = await dailyEdgeGet(new Request(`${origin}/api/lab/daily-edge?sport=${sport}`));
    boards[sport] = await response.json();
  }

  const result = auditDailyEdgeBoards(boards as Record<string, Record<string, unknown>>);
  return Response.json({
    ok: result.ok,
    result,
    // Returned intentionally so the operator script can validate the same DTO
    // payload the member UI consumes, without exposing secrets or user data.
    boards,
  }, { status: result.ok ? 200 : 409 });
}
