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

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl"];

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

const CRON_CONFIGS: CronCfg[] = [
  { data_source: "daniel_scores_model", per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "morning_slate",       per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "daily_refresh",       per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "midday_refresh",      per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "afternoon_refresh",   per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "evening_refresh",     per_sport: true,  cadence_minutes: 1440,  frontline: true  },
  { data_source: "lineup_watch",        per_sport: true,  cadence_minutes: 30,    frontline: true  },
  { data_source: "pregame_sweep",       per_sport: true,  cadence_minutes: 15,    frontline: true  },
  { data_source: "post_game_results",   per_sport: false, cadence_minutes: 1440,  frontline: false },
  { data_source: "weekly_park_factors", per_sport: false, cadence_minutes: 10080, frontline: false },
  { data_source: "weekly_calibration",  per_sport: false, cadence_minutes: 10080, frontline: false },
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

  return {
    state: worst,
    last_updated_at: freshest,
    age_seconds,
    next_scheduled_at: null, // Filled when next-scheduled is wired in 5E.
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
