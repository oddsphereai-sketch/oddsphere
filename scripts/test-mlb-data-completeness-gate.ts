import {
  applyMlbDataCompletenessGate,
  assessMlbDataCompleteness,
} from "../lib/services/mlbDataCompletenessGate";
import type { AutoFactors, AutoModelOutput, GameSnapshot, StarterSnapshot } from "../lib/automodel/types";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`not ok - ${name}${details ? ` (${details})` : ""}`);
  }
}

function starter(overrides: Partial<StarterSnapshot> = {}): StarterSnapshot {
  return {
    player_external_id: 100,
    player_name: "Pitcher One",
    throws: "R",
    season_era: 3.7,
    season_whip: 1.18,
    season_k_per_9: 8.6,
    last30_era: null,
    pitch_quality_score: 0.98,
    is_confirmed: true,
    is_scratched: false,
    first_inning_era: 3.1,
    first_inning_starts: 10,
    first_inning_whip: 1.05,
    season_games_started: 14,
    season_games_pitched: 14,
    season_innings_pitched: 82,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    game_external_id: 5059001,
    slate_date: "2026-06-27",
    game_date: "2026-06-27T23:10:00Z",
    home_team: {
      team_external_id: 1,
      abbreviation: "HOM",
      bullpen_era_proxy: 3.9,
      bullpen_era_proxy_raw: 4.1,
      bullpen_ip: 210,
      season_runs_per_game: null,
      team_avg_batter_ops: 0.72,
      team_avg_batter_ops_sample: 1200,
    },
    away_team: {
      team_external_id: 2,
      abbreviation: "AWY",
      bullpen_era_proxy: 4.2,
      bullpen_era_proxy_raw: 4.4,
      bullpen_ip: 205,
      season_runs_per_game: null,
      team_avg_batter_ops: 0.71,
      team_avg_batter_ops_sample: 1100,
    },
    home_starter: starter({ player_name: "Home Starter" }),
    away_starter: starter({ player_external_id: 200, player_name: "Away Starter", throws: "L" }),
    home_lineup_top8: Array.from({ length: 8 }, (_, i) => ({
      player_external_id: 1000 + i,
      player_name: `Home Batter ${i}`,
      batting_position: i + 1,
      bats: "R",
      season_obp: 0.32,
      season_slg: 0.41,
      season_ops: 0.73,
      vs_lhp_ops: 0.72,
      vs_rhp_ops: 0.74,
      season_pa: 200,
      lineup_source: "confirmed",
    })),
    away_lineup_top8: Array.from({ length: 8 }, (_, i) => ({
      player_external_id: 2000 + i,
      player_name: `Away Batter ${i}`,
      batting_position: i + 1,
      bats: "L",
      season_obp: 0.31,
      season_slg: 0.4,
      season_ops: 0.71,
      vs_lhp_ops: 0.7,
      vs_rhp_ops: 0.72,
      season_pa: 210,
      lineup_source: "confirmed",
    })),
    ballpark: { park_factor_runs: 1.01, is_dome: false },
    weather: {
      temperature_f: 78,
      humidity_pct: 52,
      wind_speed_mph: 8,
      wind_direction_degrees: 180,
      is_notable: false,
      notable_reason: null,
    },
    market: {
      listed_total: 8.5,
      home_ml_odds_american: -120,
      away_ml_odds_american: 110,
      over_odds_american: -110,
      under_odds_american: -110,
      has_pinnacle_total: true,
      total_line_source: "real_book",
      total_line_book: "pinnacle",
      total_line_agreement_count: 4,
      total_line_consensus_at_same_line: true,
    },
    sharp: null,
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: true,
      lineup_confirmed: true,
      weather_available: true,
      season_stats_present: true,
    },
    ...overrides,
  };
}

function prediction(overrides: Partial<AutoModelOutput> = {}): AutoModelOutput {
  return {
    game_external_id: 5059001,
    predicted_home_score: 4.6,
    predicted_away_score: 3.9,
    predicted_total: 8.5,
    predicted_ml_winner: "home",
    ml_confidence: 58,
    predicted_ou_side: "under",
    ou_confidence: 54,
    predicted_nrfi: true,
    nrfi_confidence: 53,
    prediction_source: "auto_v1_mlb_rules",
    sport_specific: {
      model_version: "auto_v2.2_mlb_full_game_projection",
      stage: "morning_draft",
      starter_confirmed: true,
      lineup_confirmed: true,
      market_line_available: true,
      opposing_deterministic_warning: false,
      listed_line: 8.5,
      held: false,
      hold_reason: null,
      hold_picks: [],
      stale: false,
      stale_reason: null,
      predicted_nrfi: true,
      nrfi_confidence: 53,
      auto_factors: {} as AutoFactors,
      ai_sanity: {
        action: "approve",
        reasoning: "ok",
        applied_confidence_delta: 0,
        applied_score_delta_home: 0,
        applied_score_delta_away: 0,
        warnings: [],
        deterministic_corrections: [],
      },
      ml_play_grade: "best_angle",
      ou_play_grade: "best_angle",
      ml_best_angle_eligible: true,
      ou_best_angle_eligible: true,
      v2_best_angle_eligible: true,
      v2_2_audit: {
        data_quality_tier: "high",
        feature_neutral_fallback_count: 0,
        feature_missing_count: 0,
        ml_play_grade: "best_angle",
        ou_play_grade: "best_angle",
        ml_best_angle_eligible: true,
        ou_best_angle_eligible: true,
      },
    },
    ...overrides,
  };
}

const ready = assessMlbDataCompleteness(snapshot(), prediction());
check("ready card is normal publish", ready.status === "ready" && ready.can_publish_normal);
check("ready card allows Best Angle", ready.best_angle_allowed === true);
check("ready card has no missing fields", ready.missing_fields.length === 0);

const missingStarterSnap = snapshot({ home_starter: null });
const missingStarter = assessMlbDataCompleteness(missingStarterSnap, prediction());
check("missing starter marks card incomplete", missingStarter.status === "incomplete_missing_required_data");
check("missing starter records exact missing field", missingStarter.missing_fields.includes("home_probable_pitcher"));
check("missing starter schedules probable pitcher repair", missingStarter.repair_actions.includes("retry_probable_pitcher_fetch"));
check("missing starter blocks Best Angle", missingStarter.best_angle_allowed === false);

const probableStarter = assessMlbDataCompleteness(
  snapshot({ home_starter: starter({ is_confirmed: false }) }),
  prediction(),
);
check("probable starter is explicitly provisional", probableStarter.status === "provisional_starters_pending");
check("probable starter blocks Best Angle", probableStarter.best_angle_allowed === false);
check("probable starter remains publishable as provisional", probableStarter.can_publish_normal === true);
check("probable starter schedules confirmation repair", probableStarter.repair_actions.includes("retry_probable_pitcher_fetch"));

const fallbackStatsSnap = snapshot({
  away_starter: starter({ season_era: null, pitch_quality_score: null }),
  home_team: { ...snapshot().home_team, bullpen_era_proxy: null },
});
const fallbackStats = assessMlbDataCompleteness(fallbackStatsSnap, prediction());
check("missing stats are pitcher degraded not silently ready", fallbackStats.status === "degraded_pitcher_fallback");
check("missing stats have explicit fallback reason", fallbackStats.fallback_reasons.includes("away_starter_stats_fallback"));
check("missing bullpen has explicit fallback reason", fallbackStats.fallback_reasons.includes("home_bullpen_league_fallback"));

const lineupPendingPrediction = prediction({
  sport_specific: {
    ...prediction().sport_specific,
    v2_2_audit: {
      data_quality_tier: "high",
      feature_neutral_fallback_count: 1,
      feature_missing_count: 1,
      feature_reason_codes: ["lineup_missing", "lineup_projected", "offense_team_proxy_ops"],
      ml_play_grade: "best_angle",
      ou_play_grade: "best_angle",
      ml_best_angle_eligible: true,
      ou_best_angle_eligible: true,
    },
  },
});
const lineupPending = assessMlbDataCompleteness(
  snapshot({ home_lineup_top8: [], away_lineup_top8: [] }),
  lineupPendingPrediction,
);
check("official lineup pending is provisional not critical", lineupPending.status === "provisional_lineup_pending");
check("official lineup pending can publish", lineupPending.can_publish_normal === true);
check("official lineup pending can still be Best Angle eligible", lineupPending.best_angle_allowed === true);
check("official lineup pending is repair eligible", lineupPending.repair_eligible === true);

const missingOffensePrediction = prediction({
  sport_specific: {
    ...prediction().sport_specific,
    v2_2_audit: {
      data_quality_tier: "low",
      feature_neutral_fallback_count: 2,
      feature_missing_count: 4,
      feature_reason_codes: ["lineup_missing", "offense_missing"],
      ml_play_grade: "best_angle",
      ou_play_grade: "best_angle",
      ml_best_angle_eligible: true,
      ou_best_angle_eligible: true,
    },
  },
});
const missingOffense = assessMlbDataCompleteness(
  snapshot({ home_lineup_top8: [], away_lineup_top8: [] }),
  missingOffensePrediction,
);
check("team offense missing is stats degraded", missingOffense.status === "degraded_stats_fallback");
check("team offense missing blocks Best Angle", missingOffense.best_angle_allowed === false);

const fallbackPrediction = prediction({
  sport_specific: {
    ...prediction().sport_specific,
    v2_2_audit: {
      data_quality_tier: "fallback",
      feature_neutral_fallback_count: 5,
      feature_missing_count: 8,
      ml_play_grade: "best_angle",
      ou_play_grade: "best_angle",
      ml_best_angle_eligible: true,
      ou_best_angle_eligible: true,
    },
  },
});
const gated = applyMlbDataCompletenessGate(snapshot(), fallbackPrediction);
check("fallback-heavy card cannot remain ML Best Angle", gated.sport_specific.ml_play_grade !== "best_angle");
check("fallback-heavy card cannot remain total Best Angle", gated.sport_specific.ou_play_grade !== "best_angle");
check("fallback-heavy card stores completeness audit", gated.sport_specific.mlb_data_completeness != null);
check("fallback-heavy card preserves picks", gated.predicted_ml_winner === "home" && gated.predicted_ou_side === "under");

const lockedLineupPending = assessMlbDataCompleteness(
  snapshot({ home_lineup_top8: [], away_lineup_top8: [] }),
  prediction({
    sport_specific: {
      ...lineupPendingPrediction.sport_specific,
      locked_at: "2026-06-27T20:00:00Z",
    } as AutoModelOutput["sport_specific"],
  }),
);
check("locked cards are not repair eligible", lockedLineupPending.repair_eligible === false);
check("locked cards expose lock protection", lockedLineupPending.lock_protected === true);

if (fail > 0) {
  console.error(`mlb data completeness gate tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`mlb data completeness gate tests: ${pass} passed, ${fail} failed`);
