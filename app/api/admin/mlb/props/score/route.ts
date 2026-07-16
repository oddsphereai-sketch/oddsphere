import { validateAdminAuth } from "@/lib/auth/admin";
import { easternSlateDate, refreshMlbPropsBoard } from "@/lib/mlb/props/liveBoard";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;
  const body = await safeJson(request);
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : easternSlateDate();
  const persist = body.persist === true;
  const result = await refreshMlbPropsBoard({ slateDate: date, refreshMode: "full", persist });
  return Response.json({
    ok: result.snapshot.validation.publishable,
    applied: result.published,
    scoringRunId: result.scoringRunId,
    snapshotId: result.snapshot.snapshotId,
    validation: result.snapshot.validation,
    movement: result.snapshot.movement,
    tracking: result.tracking,
    counts: result.snapshot.data.summary,
  }, { status: result.snapshot.validation.publishable ? 200 : 503 });
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
