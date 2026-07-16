import { validateAdminAuth } from "@/lib/auth/admin";
import { scoreMockMlbPropSlate } from "@/lib/mlb/props/liveScoring";

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const body = await safeJson(request);
  const date = typeof body.date === "string" ? body.date : "2026-07-07";
  const result = await scoreMockMlbPropSlate({ date });
  return Response.json({
    ok: true,
    queued: false,
    mode: "fixture_backtest_phase_1",
    result,
  });
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
