import type { AutoModelOutput, GameSnapshot } from "../automodel/types";

export type MlbDataCompletenessStatus =
  | "ready"
  | "provisional_starters_pending"
  | "provisional_lineup_pending"
  | "degraded_stats_fallback"
  | "degraded_pitcher_fallback"
  | "incomplete_missing_required_data";

export type MlbDataCompletenessAudit = {
  schema_version: "mlb_data_completeness_v2";
  sport: "mlb";
  status: MlbDataCompletenessStatus;
  can_publish_normal: boolean;
  best_angle_allowed: boolean;
  repair_eligible: boolean;
  lock_protected: boolean;
  last_repair_attempt_at: string | null;
  missing_fields: string[];
  degraded_fields: string[];
  fallback_reasons: string[];
  repair_actions: string[];
  starter_policy: {
    away: "confirmed" | "probable" | "missing" | "fallback";
    home: "confirmed" | "probable" | "missing" | "fallback";
  };
  stats_policy: {
    pitcher: "complete" | "fallback" | "missing";
    bullpen: "complete" | "fallback" | "missing";
    offense: "complete" | "fallback" | "missing";
    park_weather: "complete" | "fallback" | "missing";
  };
  notes: string[];
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

function starterStatus(starter: GameSnapshot["home_starter"]): "confirmed" | "probable" | "missing" | "fallback" {
  if (starter === null) return "missing";
  return starter.is_confirmed ? "confirmed" : "probable";
}

function buildRepairActions(missing: string[], degraded: string[]): string[] {
  const actions: string[] = [];
  const all = [...missing, ...degraded].join("|");
  if (/starter|pitcher/.test(all)) {
    actions.push("retry_probable_pitcher_fetch");
    actions.push("retry_pitcher_stat_fetch");
  }
  if (/bullpen|offense|lineup|team/.test(all)) {
    actions.push("retry_team_player_stat_fetch");
  }
  if (/(market|price|total_line|moneyline)/.test(all)) {
    actions.push("retry_market_line_price_fetch");
  }
  if (missing.length > 0 || degraded.length > 0) {
    actions.push("rebuild_model_inputs");
    actions.push("recompute_unlocked_prediction");
    actions.push("refresh_daily_edge_dto_cache");
  }
  return actions;
}

export function assessMlbDataCompleteness(
  snap: GameSnapshot,
  prediction: AutoModelOutput,
): MlbDataCompletenessAudit {
  const missing: string[] = [];
  const degraded: string[] = [];
  const fallbackReasons: string[] = [];
  const notes: string[] = [];

  if (!snap.home_team?.abbreviation) pushUnique(missing, "home_team_mapped");
  if (!snap.away_team?.abbreviation) pushUnique(missing, "away_team_mapped");
  if (!snap.game_date) pushUnique(missing, "start_time");

  if (prediction.predicted_ml_winner === null) pushUnique(missing, "ml_pick");
  if (prediction.predicted_ou_side === null) pushUnique(missing, "total_pick");
  if (!finite(prediction.predicted_home_score)) pushUnique(missing, "projected_home_score");
  if (!finite(prediction.predicted_away_score)) pushUnique(missing, "projected_away_score");
  if (!finite(prediction.predicted_total)) pushUnique(missing, "projected_total");

  if (snap.market.home_ml_odds_american === null) pushUnique(missing, "home_moneyline_price");
  if (snap.market.away_ml_odds_american === null) pushUnique(missing, "away_moneyline_price");
  if (snap.market.listed_total === null) pushUnique(missing, "total_line");
  if (snap.market.over_odds_american === null) pushUnique(missing, "over_price");
  if (snap.market.under_odds_american === null) pushUnique(missing, "under_price");

  if (snap.home_starter === null) {
    pushUnique(missing, "home_probable_pitcher");
    fallbackReasons.push("provider_missing_probable_pitcher_home");
  }
  if (snap.away_starter === null) {
    pushUnique(missing, "away_probable_pitcher");
    fallbackReasons.push("provider_missing_probable_pitcher_away");
  }

  for (const [side, starter] of [
    ["home", snap.home_starter],
    ["away", snap.away_starter],
  ] as const) {
    if (starter === null) continue;
    if (!starter.is_confirmed) {
      pushUnique(degraded, `${side}_starter_confirmation`);
      fallbackReasons.push(`${side}_starter_probable_unconfirmed`);
    }
    if (starter.season_era === null) {
      pushUnique(degraded, `${side}_starter_season_stats`);
      fallbackReasons.push(`${side}_starter_stats_fallback`);
    } else if (starter.season_stats_source === "prior_season_proxy") {
      pushUnique(degraded, `${side}_starter_prior_season_stats`);
      fallbackReasons.push(`${side}_starter_prior_season_proxy`);
    }
    if (starter.pitch_quality_score === null) {
      fallbackReasons.push(`${side}_pitch_quality_proxy_unavailable`);
    }
  }

  if (snap.home_team.bullpen_era_proxy === null) {
    pushUnique(degraded, "home_bullpen_stats");
    fallbackReasons.push("home_bullpen_league_fallback");
  }
  if (snap.away_team.bullpen_era_proxy === null) {
    pushUnique(degraded, "away_bullpen_stats");
    fallbackReasons.push("away_bullpen_league_fallback");
  }
  if (snap.home_lineup_top8.length < 8) {
    pushUnique(degraded, "home_lineup_offense_stats");
    fallbackReasons.push("home_lineup_team_fallback");
  }
  if (snap.away_lineup_top8.length < 8) {
    pushUnique(degraded, "away_lineup_offense_stats");
    fallbackReasons.push("away_lineup_team_fallback");
  }
  if (snap.ballpark?.park_factor_runs === null || snap.ballpark === null) {
    pushUnique(degraded, "park_factor");
    fallbackReasons.push("park_factor_neutral_fallback");
  }
  if (snap.weather === null) {
    pushUnique(degraded, "weather");
    fallbackReasons.push("weather_neutral_fallback");
  }

  const v22 = prediction.sport_specific.v2_2_audit as
    | {
        data_quality_tier?: unknown;
        feature_neutral_fallback_count?: unknown;
        feature_missing_count?: unknown;
        feature_reason_codes?: unknown;
      }
    | null
    | undefined;
  const v22Tier = typeof v22?.data_quality_tier === "string" ? v22.data_quality_tier : null;
  const v22ReasonCodes = Array.isArray(v22?.feature_reason_codes)
    ? v22.feature_reason_codes.filter((value): value is string => typeof value === "string")
    : [];
  const hasV22Reason = (reason: string) => v22ReasonCodes.includes(reason);
  const neutralFallbackCount = finite(v22?.feature_neutral_fallback_count)
    ? v22.feature_neutral_fallback_count
    : 0;
  const featureMissingCount = finite(v22?.feature_missing_count) ? v22.feature_missing_count : 0;
  if (v22Tier === "fallback") {
    pushUnique(degraded, "v2_2_data_quality_fallback");
    fallbackReasons.push("model_data_quality_fallback");
  }
  if (neutralFallbackCount > 3) {
    pushUnique(degraded, "broad_neutral_fallback");
    fallbackReasons.push("broad_neutral_fallback_used");
  }
  if (featureMissingCount >= 7) {
    pushUnique(degraded, "sparse_model_features");
    fallbackReasons.push("sparse_model_features");
  }

  const pitcherFallback =
    degraded.some((field) => field.includes("starter") && !field.includes("confirmation")) ||
    hasV22Reason("starter_missing") ||
    hasV22Reason("pitch_quality_missing");
  const statsFallback =
    degraded.some((field) =>
      field.includes("bullpen") ||
      field.includes("broad_neutral") ||
      field.includes("sparse_model") ||
      field.includes("v2_2_data_quality"),
    ) ||
    hasV22Reason("offense_missing") ||
    hasV22Reason("bullpen_missing") ||
    neutralFallbackCount > 3 ||
    featureMissingCount >= 7;
  const lineupPending =
    degraded.some((field) => field.includes("lineup")) ||
    hasV22Reason("lineup_missing") ||
    hasV22Reason("lineup_projected");
  const startersPending =
    snap.home_starter !== null &&
    snap.away_starter !== null &&
    (!snap.home_starter.is_confirmed || !snap.away_starter.is_confirmed);

  const status: MlbDataCompletenessStatus =
    missing.length > 0
      ? "incomplete_missing_required_data"
      : pitcherFallback
        ? "degraded_pitcher_fallback"
        : statsFallback
          ? "degraded_stats_fallback"
          : startersPending
            ? "provisional_starters_pending"
          : lineupPending
            ? "provisional_lineup_pending"
            : "ready";
  const bestAngleAllowed = status === "ready" || status === "provisional_lineup_pending";

  if (status === "incomplete_missing_required_data") {
    notes.push("Card requires repair before normal pre-lock display.");
  }
  if (status === "provisional_lineup_pending") {
    notes.push("Official lineup is pending; card can publish and should repair when lineup data arrives.");
  }
  if (status === "provisional_starters_pending") {
    notes.push("Probable starters are not confirmed; card can publish provisionally but cannot be Best Angle.");
  }
  if (!bestAngleAllowed) notes.push("Fallback-heavy card cannot be promoted to Best Angle.");

  const pitcherStatsMissing =
    snap.home_starter === null ||
    snap.away_starter === null ||
    snap.home_starter.season_era === null ||
    snap.away_starter.season_era === null;
  const bullpenMissing =
    snap.home_team.bullpen_era_proxy === null || snap.away_team.bullpen_era_proxy === null;
  const offenseMissing = snap.home_lineup_top8.length < 8 || snap.away_lineup_top8.length < 8;
  const parkWeatherMissing =
    snap.ballpark === null || snap.ballpark.park_factor_runs === null || snap.weather === null;
  const sportSpecificRecord = prediction.sport_specific as Record<string, unknown>;
  const lockProtected = typeof sportSpecificRecord.locked_at === "string";
  const repairActions = buildRepairActions(missing, degraded);

  return {
    schema_version: "mlb_data_completeness_v2",
    sport: "mlb",
    status,
    can_publish_normal: status !== "incomplete_missing_required_data",
    best_angle_allowed: bestAngleAllowed,
    repair_eligible: repairActions.length > 0 && !lockProtected,
    lock_protected: lockProtected,
    last_repair_attempt_at:
      typeof sportSpecificRecord.last_repair_attempt_at === "string"
        ? sportSpecificRecord.last_repair_attempt_at
        : null,
    missing_fields: missing,
    degraded_fields: degraded,
    fallback_reasons: fallbackReasons,
    repair_actions: repairActions,
    starter_policy: {
      away: starterStatus(snap.away_starter),
      home: starterStatus(snap.home_starter),
    },
    stats_policy: {
      pitcher: pitcherStatsMissing ? (snap.home_starter === null || snap.away_starter === null ? "missing" : "fallback") : "complete",
      bullpen: bullpenMissing ? "fallback" : "complete",
      offense: offenseMissing ? "fallback" : "complete",
      park_weather: parkWeatherMissing ? "fallback" : "complete",
    },
    notes,
  };
}

export function applyMlbDataCompletenessGate(
  snap: GameSnapshot,
  prediction: AutoModelOutput,
): AutoModelOutput {
  const audit = assessMlbDataCompleteness(snap, prediction);
  const current = prediction.sport_specific;
  if (audit.best_angle_allowed) {
    return {
      ...prediction,
      sport_specific: {
        ...current,
        mlb_data_completeness: audit,
      },
    };
  }

  const mlGrade = current.ml_play_grade === "best_angle" ? "lean" : current.ml_play_grade;
  const ouGrade = current.ou_play_grade === "best_angle" ? "lean" : current.ou_play_grade;
  const v22 =
    current.v2_2_audit && typeof current.v2_2_audit === "object"
      ? {
          ...(current.v2_2_audit as Record<string, unknown>),
          ml_play_grade:
            (current.v2_2_audit as Record<string, unknown>).ml_play_grade === "best_angle"
              ? "lean"
              : (current.v2_2_audit as Record<string, unknown>).ml_play_grade,
          ou_play_grade:
            (current.v2_2_audit as Record<string, unknown>).ou_play_grade === "best_angle"
              ? "lean"
              : (current.v2_2_audit as Record<string, unknown>).ou_play_grade,
          ml_best_angle_eligible: false,
          ou_best_angle_eligible: false,
          data_completeness_best_angle_blocked: true,
        }
      : current.v2_2_audit;

  return {
    ...prediction,
    sport_specific: {
      ...current,
      ml_play_grade: mlGrade,
      ou_play_grade: ouGrade,
      ml_best_angle_eligible: false,
      ou_best_angle_eligible: false,
      v2_best_angle_eligible: false,
      v2_2_audit: v22,
      mlb_data_completeness: audit,
      model_integrity_notes: [
        ...(current.model_integrity_notes ?? []),
        "mlb_data_completeness_gate_blocked_best_angle",
      ],
    },
  };
}
