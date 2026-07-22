import { validateAdminAuth } from "@/lib/auth/admin";
import {
  getInternalMlbPropsTrackingReport,
  settleInternalMlbProps,
} from "@/lib/mlb/props/internalTracking";
import { loadMlbPropsLaunchReadiness } from "@/lib/mlb/props/launchReadiness";
import { easternSlateDate } from "@/lib/mlb/props/liveBoard";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate");
  const launch = await loadMlbPropsLaunchReadiness(easternSlateDate());
  let reportError: string | null = null;
  const report = await getInternalMlbPropsTrackingReport({
    startDate: startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : undefined,
  }).catch((error) => {
    reportError = error instanceof Error ? error.message : String(error);
    return emptyReport(startDate ?? undefined);
  });
  return Response.json({ ok: true, health: launch.tracking, report, reportError, launch }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;
  const body = await safeJson(request);
  if (body.action !== "settle") {
    return Response.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const result = await settleInternalMlbProps({ dates: date ? [date] : undefined });
  return Response.json({ ok: true, result }, { headers: { "Cache-Control": "private, no-store" } });
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function emptyReport(startDate?: string) {
  const metrics = { tracked: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, hitRate: null, units: 0, riskedUnits: 0, roi: null, averageClvProbabilityDelta: null, brierScore: null };
  return {
    startDate: startDate ?? "not-initialized",
    generatedAt: new Date().toISOString(),
    summary: metrics,
    calibration: metrics,
    oneUnitAll: metrics,
    byMarket: [],
    byCategory: [],
    byGrade: [],
    byRelease: [],
    oneUnitByMarket: [],
    oneUnitByCategory: [],
    oneUnitByGrade: [],
    oneUnitByRelease: [],
    recent: [],
  };
}
