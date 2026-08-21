import { supabase } from "@/lib/db/supabase";
import { computeTrackingAggregate } from "@/lib/services/trackingAggregateService";

const MEMBER_TRACKING_FROM = "2026-06-07";
const TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS = 120000;

type TrackingResponseBody = Record<string, unknown>;
type TrackingAggregateResult = Awaited<ReturnType<typeof computeTrackingAggregate>>;

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function buildTrackingFoundationSnapshotBody(input: {
  timeoutMs?: number;
} = {}): Promise<TrackingResponseBody> {
  const today = todayEt();
  const result = await withTimeout(
    computeTrackingAggregate({
      supabase,
      from: MEMBER_TRACKING_FROM,
      to: today,
      includeLaunchDay: false,
    }),
    input.timeoutMs ?? TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS,
    "tracking aggregate",
  );
  return trackingFoundationResponseBody(result, undefined);
}

export function trackingFoundationResponseBody(
  result: TrackingAggregateResult,
  sport: string | undefined,
): TrackingResponseBody {
  const safeBaselines = result.baselines.map((baseline) => ({
    sport: baseline.sport,
    market: baseline.market,
    source_label: baseline.source_label,
    model_family: baseline.model_family,
    lifetime_wins: baseline.lifetime_wins,
    lifetime_total: baseline.lifetime_total,
    lifetime_pct: baseline.lifetime_pct,
    current_season_wins: baseline.current_season_wins,
    current_season_total: baseline.current_season_total,
    current_season_pct: baseline.current_season_pct,
  }));
  return {
    sport: sport ?? "all",
    baselines: safeBaselines,
    overall: result.overall,
    bySport: result.bySport,
    byMarket: result.byMarket,
    bySportMarket: result.bySportMarket,
    byPlayGrade: result.byPlayGrade,
    bestAngles: result.bestAngles,
    leans: result.leans,
    yesterday: result.yesterday,
    thisWeek: result.thisWeek,
    thisMonth: result.thisMonth,
    dailyTrend: result.dailyTrend,
    recentPicks: result.recentPicks,
    recentlySettled: result.recentlySettled,
    tablesInitialized: result.tablesInitialized,
    freshTrackingStarted: result.overall.picks > 0,
    generatedAt: new Date().toISOString(),
  };
}
