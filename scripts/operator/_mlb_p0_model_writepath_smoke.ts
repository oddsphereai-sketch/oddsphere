/**
 * MLB-P0 model write-path smoke (pure, no DB).
 *
 * Runs the REAL runMlbAutoModelV2_2 on an overconfident scenario (ace home
 * vs weak away, near-even market) and confirms the new audit fields are
 * emitted and behave: raw preserved, regularized closer to market, edge
 * fields populated, requires_market_confirmation set when the cap fires.
 * Then runs the writer resolver over the audit to confirm end-to-end wiring.
 *
 * This is what proves locked rows written AFTER deploy will carry the new
 * fields (existing pre-patch locked rows stay frozen and won't).
 */
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";
import { resolveMlbBestAngle } from "../../lib/services/predictionRecordService";
import type {
  GameSnapshot, TeamSnapshot, StarterSnapshot, MarketSnapshot, AutoModelOutput,
} from "../../lib/automodel/types";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) console.log(`✓ ${n}`);
  else { failures++; console.error(`✗ ${n}${d ? ` — ${d}` : ""}`); }
};

function team(o: Partial<TeamSnapshot>): TeamSnapshot {
  return { team_external_id: 1, abbreviation: "TST", bullpen_era_proxy: 4.1,
    season_runs_per_game: 4.45, team_avg_batter_ops: 0.72, team_avg_batter_ops_sample: 4000, ...o };
}
function starter(o: Partial<StarterSnapshot>): StarterSnapshot {
  return { player_external_id: 100, player_name: "P", throws: "R", season_era: 4.1, season_whip: 1.3,
    season_k_per_9: 8.5, last30_era: null, pitch_quality_score: 1.0, is_confirmed: true, is_scratched: false,
    first_inning_era: null, first_inning_starts: null, first_inning_whip: null,
    season_games_started: 15, season_games_pitched: 15, season_innings_pitched: 90, ...o };
}
function market(o: Partial<MarketSnapshot>): MarketSnapshot {
  return { listed_total: 9.0, home_ml_odds_american: -130, away_ml_odds_american: 120,
    over_odds_american: -110, under_odds_american: -110, has_pinnacle_total: true, ...o };
}
const v1: AutoModelOutput = {
  game_external_id: 1000, prediction_source: "auto_v1_mlb_rules", predicted_home_score: 4.5,
  predicted_away_score: 4.0, predicted_total: 8.5, predicted_ml_winner: "home", ml_confidence: 54,
  predicted_ou_side: "under", ou_confidence: 52, predicted_nrfi: true, nrfi_confidence: 58,
  sport_specific: {} as AutoModelOutput["sport_specific"],
};

// Overconfident home: ace starter + strong offense vs weak away, near-even market.
const snap: GameSnapshot = {
  game_external_id: 1000, slate_date: "2026-06-13", game_date: "2026-06-13T19:00:00Z",
  home_team: team({ team_external_id: 1, abbreviation: "HOM", team_avg_batter_ops: 0.810, bullpen_era_proxy: 3.0, season_runs_per_game: 5.4 }),
  away_team: team({ team_external_id: 2, abbreviation: "AWY", team_avg_batter_ops: 0.640, bullpen_era_proxy: 5.6, season_runs_per_game: 3.6 }),
  home_starter: starter({ player_external_id: 100, season_era: 2.1, season_whip: 0.92, season_k_per_9: 11.5, pitch_quality_score: 1.4 }),
  away_starter: starter({ player_external_id: 200, season_era: 5.7, season_whip: 1.62, season_k_per_9: 6.0, pitch_quality_score: 0.7 }),
  home_lineup_top8: [], away_lineup_top8: [],
  ballpark: { park_factor_runs: 1.0, is_dome: false },
  weather: { temperature_f: 72, humidity_pct: 50, wind_speed_mph: 5, wind_direction_degrees: 90, is_notable: false, notable_reason: null },
  market: market({}), sharp: null,
  active_injuries: { home_starter_out: false, away_starter_out: false, home_top3_hitters_injured_count: 0, away_top3_hitters_injured_count: 0 },
  data_quality: { starter_confirmed: true, lineup_confirmed: true, weather_available: true, season_stats_present: true },
};

const out = runMlbAutoModelV2_2(snap, v1, "morning_draft");
const a = out.v22Audit;
console.log(`ML raw=${a.ml_raw_model_prob.toFixed(3)} mkt=${a.ml_market_prob?.toFixed(3)} reg=${a.ml_regularized_model_prob.toFixed(3)} rawEdge=${a.ml_raw_edge_pct?.toFixed(1)} regEdge=${a.ml_edge_pct.toFixed(1)} cap=${a.ml_distance_cap_applied} reqConf=${a.ml_requires_market_confirmation}`);
console.log(`OU raw=${a.ou_raw_model_prob.toFixed(3)} mkt=${a.ou_market_prob?.toFixed(3)} reg=${a.ou_regularized_model_prob.toFixed(3)} regEdge=${a.ou_edge_pct?.toFixed(1)} cap=${a.ou_distance_cap_applied}`);

// New audit fields present + typed.
ok("ml_raw_model_prob is finite", Number.isFinite(a.ml_raw_model_prob));
ok("ml_regularized_model_prob === ml_model_prob (card-facing)", a.ml_regularized_model_prob === a.ml_model_prob);
ok("ml_regularized_edge_pct === ml_edge_pct", a.ml_regularized_edge_pct === a.ml_edge_pct);
ok("ml_raw_edge_pct preserved (number)", typeof a.ml_raw_edge_pct === "number");
ok("regularization_reason set", a.regularization_reason === "probability_space_regularization");
ok("ml_shrink_factor === 0.6", a.ml_shrink_factor === 0.6);
ok("ou_shrink_factor === 0.5", a.ou_shrink_factor === 0.5);
ok("ou audit fields present", typeof a.ou_raw_model_prob === "number" && typeof a.ou_distance_cap_applied === "boolean");

// Behaviour: regularized strictly closer to market than raw (market present).
if (a.ml_market_prob !== null) {
  ok("ML regularized closer to market than raw",
    Math.abs(a.ml_regularized_model_prob - a.ml_market_prob) <= Math.abs(a.ml_raw_model_prob - a.ml_market_prob));
  ok("ML regularized edge magnitude <= raw edge magnitude",
    Math.abs(a.ml_edge_pct) <= Math.abs(a.ml_raw_edge_pct ?? 0) + 1e-9);
}
ok("requires_confirmation is boolean", typeof a.ml_requires_market_confirmation === "boolean");
ok("if cap applied on a BA, confirmation is required",
  !(a.ml_distance_cap_applied && a.ml_best_angle_eligible) || a.ml_requires_market_confirmation === true);

// End-to-end writer resolution over the model output (toward-move confirms a capped BA).
const resolved = resolveMlbBestAngle({
  baseEligible: a.ml_best_angle_eligible,
  requiresConfirmation: a.ml_requires_market_confirmation,
  lineDirection: "toward_pick",
  opposingPublicMoney: false,
});
ok("writer resolves model output without error", typeof resolved.bestAngle === "boolean");

if (failures > 0) { console.error(`\n${failures} write-path smoke assertion(s) failed.`); process.exit(1); }
console.log("\nMLB-P0 model write-path smoke passed (new audit fields emitted + behave).");
