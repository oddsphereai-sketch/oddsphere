/**
 * GET /api/lab/refresh-status?sport=mlb
 *
 * Powers the RefreshIndicator + HowWeUpdatePanel. Aggregates the latest run
 * for each cron `data_source` from `data_refresh_log` and returns:
 *   • Per-source detail (last_completed_at, status, records_updated, age, state)
 *   • Aggregate `overall` state for the frontline pipeline (UI badge)
 *
 * Auth: public read. data_refresh_log carries no member-identifying data —
 * it's the same information we'll surface to logged-in members in the UI.
 *
 * Slate cadence-awareness: state derivation uses per-source EXPECTED_CADENCE
 * (minutes). A source is "stale" when older than 2× its cadence. Cross-sport
 * sources (post_game_results, weekly_*) are returned but excluded from the
 * MLB `overall` aggregate.
 */

import { supabase } from "@/lib/db/supabase";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  RefreshSource,
  RefreshState,
  RefreshStatusResponse,
} from "@/app/lab/lib/labTypes";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer"];

type CronCfg = {
  data_source: string;
  /** true = row written per sport; false = cross-sport (sport is NULL). */
  per_sport: boolean;
  /** Expected interval between successful runs, minutes. */
  cadence_minutes: number;
  /**
   * Frontline = the main refresh pipeline a member sees on the Lab. Drives
   * the `overall` aggregate. Weekly + post-game crons are out (they're
   * pipeline-internal). daniel_scores_model is in: it's the only signal we
   * have that today's predictions exist.
   */
  frontline: boolean;
};

// Phase 6B.6 — aligned with what vercel.json actually schedules.
// Pre-launch this list carried legacy data_source names (morning_slate,
// daily_refresh, midday/afternoon/evening_refresh, lineup_watch, etc.)
// whose routes still exist but are NOT in vercel.json's cron list. They
// always read as `stale` or `unknown`, which dominated the worst-case
// state escalation in deriveOverall() AND polluted deriveOverall's
// freshest-timestamp picker. The result: the "Last updated" pill
// reported the freshest *legacy* timestamp (typically 1–4 days old)
// even when the live cron (slate_cycle_automation) had finished
// minutes earlier.
//
// Current truth (vercel.json):
//   • /api/cron/slate-cycle          → writes data_source=slate_cycle_automation
//                                       schedule: cold runs 08/10/12 UTC,
//                                       hourly intraday 13–02 UTC
//   • /api/cron/tracking-refresh     → writes data_source=tracking_refresh
//                                       schedule: hourly (0 * * * *)
//   • /api/cron/pregame-sweep        → writes data_source=pregame_sweep
//                                       schedule: every 15 min
//   • /api/cron/feature-coverage-refresh → writes data_source=feature_coverage_refresh
//                                       schedule: 11:30 + 21:30 UTC (12h cadence)
//
// Cadence rationale:
//   • slate_cycle_automation = 120 min. Hourly intraday (~13–02 UTC).
//     The overnight gap (02→08 UTC) WILL trip stale — that's the
//     correct member-visible signal (no slate-cycle activity, no
//     games starting in that window).
//   • tracking_refresh       = 120 min. Hourly cadence; tolerance
//     covers one missed firing.
//   • pregame_sweep          = 30 min. Runs every 15 min; tolerance
//     allows a single missed firing without going stale.
//   • feature_coverage_refresh = 720 min. Twice-daily; informational
//     for model readiness, not member-facing freshness.
//
// frontline=true means the source counts toward the member-visible
// "Last updated" pill. feature_coverage_refresh stays out so a
// midday operator skip doesn't mislead members. pregame_sweep also
// stays out — it's an automation/health source, not member-facing.
const CRON_CONFIGS: CronCfg[] = [
  // slate_cycle_automation runs every 2 hours in the morning pre-game
  // window (8 / 10 / 12 UTC) and then HOURLY during the intraday
  // window (13 → 23 UTC). vercel.json is the source of truth. The
  // member-facing countdown is dominated by the intraday cadence
  // because that's when members are watching the page; the AM gaps
  // are operator-facing. Reporting 60 keeps the pill honest during
  // game-day hours (was 120, which over-promised the wait).
  { data_source: "slate_cycle_automation",   per_sport: true, cadence_minutes: 60,  frontline: true  },
  { data_source: "tracking_refresh",         per_sport: true, cadence_minutes: 120, frontline: true  },
  { data_source: "pregame_sweep",            per_sport: true, cadence_minutes: 30,  frontline: false },
  { data_source: "feature_coverage_refresh", per_sport: true, cadence_minutes: 720, frontline: false },
];

/** Window during which an in_progress row counts as "actively updating". */
const IN_PROGRESS_WINDOW_MS = 5 * 60 * 1000;

type LogRow = {
  refresh_started_at: string;
  refresh_completed_at: string | null;
  refresh_status: "success" | "partial" | "failed" | "in_progress";
  records_updated: number | null;
  scheduled_next_refresh: string | null;
};

/**
 * Pull the most recent row for (data_source, sport) and the most recent
 * still-in-progress row started within IN_PROGRESS_WINDOW. Returns both so
 * the caller can decide which signal to surface.
 */
async function loadSourceRows(
  data_source: string,
  sport: Sport | null
): Promise<{ latestCompleted: LogRow | null; activeInProgress: LogRow | null }> {
  // Latest completed (any non-in_progress status).
  let qCompleted = supabase
    .from("data_refresh_log")
    .select(
      "refresh_started_at, refresh_completed_at, refresh_status, records_updated, scheduled_next_refresh"
    )
    .eq("data_source", data_source)
    .neq("refresh_status", "in_progress")
    .order("refresh_started_at", { ascending: false })
    .limit(1);
  qCompleted = sport === null ? qCompleted.is("sport", null) : qCompleted.eq("sport", sport);
  const { data: completedRows, error: completedErr } = await qCompleted;
  if (completedErr) throw new Error(`refresh-status load completed: ${completedErr.message}`);
  const latestCompleted = (completedRows?.[0] as LogRow | undefined) ?? null;

  // Active in_progress within window.
  const threshold = new Date(Date.now() - IN_PROGRESS_WINDOW_MS).toISOString();
  let qActive = supabase
    .from("data_refresh_log")
    .select(
      "refresh_started_at, refresh_completed_at, refresh_status, records_updated, scheduled_next_refresh"
    )
    .eq("data_source", data_source)
    .eq("refresh_status", "in_progress")
    .gte("refresh_started_at", threshold)
    .order("refresh_started_at", { ascending: false })
    .limit(1);
  qActive = sport === null ? qActive.is("sport", null) : qActive.eq("sport", sport);
  const { data: activeRows, error: activeErr } = await qActive;
  if (activeErr) throw new Error(`refresh-status load active: ${activeErr.message}`);
  const activeInProgress = (activeRows?.[0] as LogRow | undefined) ?? null;

  return { latestCompleted, activeInProgress };
}

function deriveSource(
  cfg: CronCfg,
  sport: Sport | null,
  now: Date,
  completed: LogRow | null,
  active: LogRow | null
): RefreshSource {
  const ageMinutes =
    completed?.refresh_completed_at
      ? (now.getTime() - new Date(completed.refresh_completed_at).getTime()) / 60_000
      : null;

  let state: RefreshState;
  if (active) {
    state = "updating";
  } else if (!completed) {
    state = "unknown";
  } else if (completed.refresh_status === "failed") {
    state = "error";
  } else if (ageMinutes !== null && ageMinutes > cfg.cadence_minutes * 2) {
    state = "stale";
  } else {
    state = "live";
  }

  return {
    data_source: cfg.data_source,
    sport,
    last_started_at: active?.refresh_started_at ?? completed?.refresh_started_at ?? null,
    last_completed_at: completed?.refresh_completed_at ?? null,
    last_status: active ? "in_progress" : completed?.refresh_status ?? null,
    records_updated: completed?.records_updated ?? null,
    expected_cadence_minutes: cfg.cadence_minutes,
    age_minutes: ageMinutes,
    state,
  };
}

function deriveOverall(
  frontline: RefreshSource[],
  now: Date
): RefreshStatusResponse["overall"] {
  if (frontline.length === 0) {
    return {
      state: "unknown",
      last_updated_at: null,
      age_seconds: null,
      next_scheduled_at: null,
    };
  }

  // Worst-case state escalation: error > stale > updating > unknown > live.
  const order: Record<RefreshState, number> = {
    error: 4,
    stale: 3,
    updating: 2,
    unknown: 1,
    live: 0,
  };
  let worst: RefreshState = "live";
  for (const s of frontline) {
    if (order[s.state] > order[worst]) worst = s.state;
  }

  // Freshest completion timestamp across frontline.
  let freshest: string | null = null;
  for (const s of frontline) {
    if (!s.last_completed_at) continue;
    if (!freshest || s.last_completed_at > freshest) freshest = s.last_completed_at;
  }
  const age_seconds = freshest
    ? Math.floor((now.getTime() - new Date(freshest).getTime()) / 1000)
    : null;

  // "Next refresh" = earliest projected next run across frontline sources.
  // Projection: last_started_at + cadence_minutes for each source we've seen
  // run at least once. If projection is in the past (we missed the window),
  // surface the soonest in the future by adding cadence until > now. Sources
  // that have never run are skipped — they'd otherwise dominate the minimum.
  let nextScheduled: number | null = null;
  for (const s of frontline) {
    if (!s.last_started_at) continue;
    const startMs = new Date(s.last_started_at).getTime();
    const cadenceMs = s.expected_cadence_minutes * 60_000;
    let projected = startMs + cadenceMs;
    while (projected <= now.getTime()) projected += cadenceMs;
    if (nextScheduled === null || projected < nextScheduled) {
      nextScheduled = projected;
    }
  }

  return {
    state: worst,
    last_updated_at: freshest,
    age_seconds,
    next_scheduled_at: nextScheduled ? new Date(nextScheduled).toISOString() : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const sport: Sport | null =
    sportParam && (VALID_SPORTS as string[]).includes(sportParam)
      ? (sportParam as Sport)
      : null;

  const now = new Date();
  const sources: RefreshSource[] = [];

  // Per-sport sources: only include rows scoped to the requested sport.
  // Cross-sport sources (per_sport=false): always include (sport is NULL).
  // If no sport requested, default to surfacing MLB per-sport rows + all
  // cross-sport rows — MLB is the only live sport in V1.
  const effectiveSport: Sport = sport ?? "mlb";

  for (const cfg of CRON_CONFIGS) {
    const scope: Sport | null = cfg.per_sport ? effectiveSport : null;
    const { latestCompleted, activeInProgress } = await loadSourceRows(
      cfg.data_source,
      scope
    );
    sources.push(deriveSource(cfg, scope, now, latestCompleted, activeInProgress));
  }

  const frontline = sources.filter((s, i) => CRON_CONFIGS[i]!.frontline);
  const overall = deriveOverall(frontline, now);

  const body: RefreshStatusResponse = {
    as_of: now.toISOString(),
    sport,
    overall,
    sources,
  };

  return Response.json(body, {
    headers: {
      // Short edge cache — RefreshIndicator polls anyway, but this protects
      // the DB if a spike of clients lands at the same second.
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
    },
  });
}
