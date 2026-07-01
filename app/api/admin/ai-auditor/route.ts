import { validateAdminAuth } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { currentMonthKey, loadAiAuditUsageSummary } from "@/lib/services/aiAuditCostControl";
import {
  buildAiAuditorCostPreviewFromDailyEdge,
  parseAiAuditorMarkets,
} from "@/lib/services/aiAuditor/costPreview";
import { guardedLiveQcStatus } from "@/lib/services/aiAuditor/guardedLiveQc";
import { currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";

const VALID_PREVIEW_SPORTS: Sport[] = ["mlb", "nba", "nhl", "soccer", "wnba"];

function parsePreviewSport(raw: string | null, fallback: Sport): Sport {
  const normalized = (raw ?? fallback).toLowerCase();
  return VALID_PREVIEW_SPORTS.includes(normalized as Sport) ? (normalized as Sport) : fallback;
}

function activePreviewSports(): Sport[] {
  const raw = process.env.AI_AUDITOR_COST_PREVIEW_ACTIVE_SPORTS ?? "mlb,wnba,soccer";
  const sports = raw
    .split(",")
    .map((part) => parsePreviewSport(part.trim(), "mlb"));
  return Array.from(new Set(sports));
}

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const monthKey = url.searchParams.get("month") ?? currentMonthKey();
  const previewSport = parsePreviewSport(url.searchParams.get("previewSport"), "mlb");
  const previewDate = url.searchParams.get("previewDate") ?? currentSlateDate(previewSport);
  const previewRefreshes = Number(url.searchParams.get("previewRefreshes") ?? process.env.AI_AUDITOR_COST_PREVIEW_REFRESHES ?? 8);
  const summary = await loadAiAuditUsageSummary(monthKey);
  const costPreview = await buildAiAuditorCostPreviewFromDailyEdge({
    sport: previewSport,
    from: previewDate,
    to: previewDate,
    markets: parseAiAuditorMarkets(url.searchParams.get("previewMarkets") ?? "ML,TOTAL,FI"),
    refreshesPerDay: Number.isFinite(previewRefreshes) ? previewRefreshes : 8,
  });
  const activeSportPreviews = await Promise.all(
    activePreviewSports().map(async (sport) => {
      const date = sport === previewSport ? previewDate : currentSlateDate(sport);
      return await buildAiAuditorCostPreviewFromDailyEdge({
        sport,
        from: date,
        to: date,
        markets: parseAiAuditorMarkets(url.searchParams.get("previewMarkets") ?? "ML,TOTAL,FI"),
        refreshesPerDay: Number.isFinite(previewRefreshes) ? previewRefreshes : 8,
      });
    }),
  );
  const activeSportsCostPreview = {
    sports: activeSportPreviews.map((preview) => preview.sport),
    estimatedNanoCostUsd: +activeSportPreviews.reduce((sum, preview) => sum + preview.estimatedNanoCostUsd, 0).toFixed(6),
    gameCardPayloadsBuilt: activeSportPreviews.reduce((sum, preview) => sum + preview.gameCardPayloadsBuilt, 0),
    estimatedAiCalls: activeSportPreviews.reduce((sum, preview) => sum + preview.estimatedAiCalls, 0),
    estimatedCacheSkips: activeSportPreviews.reduce((sum, preview) => sum + preview.estimatedCacheSkips, 0),
    projectedMonthEndRealisticUsd: +activeSportPreviews
      .reduce((sum, preview) => sum + preview.projectedMonthlyCostUsd.realisticCaseFromHistoricalPayloads, 0)
      .toFixed(6),
  };
  const { data, error } = await supabase
    .from("ai_audit_usage_ledger")
    .select("*")
    .eq("month_key", monthKey)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const recent = data ?? [];
  const actionRows: Array<{ applied: boolean; actions: string[]; status: string | null }> = recent.map((row) => ({
    applied: row.applied === true,
    actions: Array.isArray(row.recommended_actions) ? row.recommended_actions.map((action: unknown) => String(action)) : [],
    status: row.status,
  }));
  const liveQcCounters = {
    safeCopyFixesApplied: actionRows.filter((row) => row.applied && row.actions.some((action) => action.includes("safe_copy_fix") || action === "apply_copy_fixes")).length,
    gradeDowngradesOrCapsApplied: actionRows.filter((row) => row.applied && row.actions.some((action) => action.includes("downgrade") || action.includes("cap"))).length,
    blocks: actionRows.filter((row) => row.status === "block" || row.actions.some((action) => action.includes("block"))).length,
    recommendationsNotApplied: actionRows.filter((row) => !row.applied && row.actions.some((action) => action !== "none")).length,
  };

  return Response.json(
    {
      summary,
      costPreview,
      activeSportsCostPreview,
      liveQc: {
        status: guardedLiveQcStatus(),
        counters: liveQcCounters,
        recentAppliedFixes: recent
          .filter((row) => row.applied === true)
          .slice(0, 10)
          .map((row) => ({
            created_at: row.created_at,
            sport: row.sport,
            slate_date: row.slate_date,
            game_id: row.game_id,
            audit_scope: row.audit_scope,
            model: row.model,
            actions: row.recommended_actions,
            status: row.status,
          })),
      },
      recent,
      caps: {
        soft: Number(process.env.AI_AUDITOR_MONTHLY_SOFT_CAP_USD ?? 150),
        protect: Number(process.env.AI_AUDITOR_MONTHLY_PROTECT_CAP_USD ?? 200),
        hard: Number(process.env.AI_AUDITOR_MONTHLY_HARD_CAP_USD ?? 250),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
