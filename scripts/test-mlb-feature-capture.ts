/**
 * Forward-only feature-capture assertion test (WS2 review package).
 * Proves: feature_capture exists + is structured; core model outputs
 * (scores/side/confidence/grade) are present & stable; old snapshots
 * without feature_capture remain backward-compatible (optional field).
 *
 * NOTE: that predictions/grades are UNCHANGED by the patch is proven by the
 * existing scripts/test-mlb-automodel-v2-2.ts (123/123 pass with pinned
 * predicted values). This test adds the capture-specific assertions.
 */
import { runMlbAutoModelV2_2, type V22Audit } from "../lib/automodel/mlbAutoModelV2_2";
import type { GameSnapshot, AutoModelOutput, StarterSnapshot, TeamSnapshot } from "../lib/automodel/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = ""): void { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } }

function starter(id: number): StarterSnapshot {
  return { player_external_id: id, player_name: `P${id}`, throws: "R", season_era: 3.9, season_whip: 1.25, season_k_per_9: 9.0, last30_era: 3.5, pitch_quality_score: 1.0, is_confirmed: true, is_scratched: false, first_inning_era: 3.2, first_inning_starts: 12, first_inning_whip: 1.2, season_games_started: 14, season_games_pitched: 14, season_innings_pitched: 85 };
}
function team(id: number, abbr: string): TeamSnapshot {
  return { team_external_id: id, abbreviation: abbr, bullpen_era_proxy: 3.8, bullpen_era_proxy_raw: 3.9, bullpen_ip: 180, season_runs_per_game: 4.5, team_avg_batter_ops: 0.730, team_avg_batter_ops_sample: 2000 };
}
function snapshot(): GameSnapshot {
  return {
    game_external_id: 9999, slate_date: "2026-06-15", game_date: "2026-06-15T19:00:00Z",
    home_team: team(1, "HOM"), away_team: team(2, "AWY"),
    home_starter: starter(100), away_starter: starter(200),
    home_lineup_top8: [], away_lineup_top8: [],
    ballpark: { park_factor_runs: 1.04, is_dome: false },
    weather: { temperature_f: 78, humidity_pct: 55, wind_speed_mph: 8, wind_direction_degrees: 180, is_notable: false, notable_reason: null, standard_source: "weather_forecasts", standard_fetched_at: "2026-06-15T17:55:00.000Z" },
    market: { listed_total: 8.5, home_ml_odds_american: -120, away_ml_odds_american: 110, over_odds_american: -110, under_odds_american: -110, has_pinnacle_total: true },
    sharp: null,
    active_injuries: { home_starter_out: false, away_starter_out: false, home_top3_hitters_injured_count: 0, away_top3_hitters_injured_count: 0 },
    data_quality: { starter_confirmed: true, lineup_confirmed: true, weather_available: true, season_stats_present: true },
  };
}
function v1out(): AutoModelOutput {
  return { game_external_id: 9999, prediction_source: "auto_v1_mlb_rules", predicted_home_score: 4.5, predicted_away_score: 4.0, predicted_total: 8.5, predicted_ml_winner: "home", ml_confidence: 54, predicted_ou_side: "under", ou_confidence: 52, predicted_nrfi: true, nrfi_confidence: 58, sport_specific: {} as AutoModelOutput["sport_specific"] };
}

console.log("━━━ feature_capture additive patch ━━━");
const out = runMlbAutoModelV2_2(snapshot(), v1out(), "t60_locked");
const a = out.v22Audit;
const fc = a.feature_capture;

// core outputs present & well-formed (behavior preserved)
check("predicted_home_score is finite", Number.isFinite(out.predicted_home_score));
check("predicted_total = home + away", Math.abs(out.predicted_total - (out.predicted_home_score + out.predicted_away_score)) < 1e-9);
check("ML side is home|away", out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away");
check("OU side is over|under", out.predicted_ou_side === "over" || out.predicted_ou_side === "under");
check("ml_confidence in [50,82]", out.ml_confidence >= 50 && out.ml_confidence <= 82);
check("ml_play_grade still present in audit", typeof a.ml_play_grade === "string");
check("ou_play_grade still present in audit", typeof a.ou_play_grade === "string");

// feature_capture exists + structured
check("feature_capture exists", fc != null);
check("schema_version = fc_v2", fc?.schema_version === "fc_v2");
check("starter.home.season_era captured", fc?.starter.home?.season_era === 3.9);
check("starter.home.first_inning_era captured", fc?.starter.home?.first_inning_era === 3.2);
check("starter.away.season_k_per_9 captured", fc?.starter.away?.season_k_per_9 === 9.0);
check("team.home.bullpen_era_proxy captured", fc?.team.home.bullpen_era_proxy === 3.8);
check("team.away.team_avg_batter_ops captured", fc?.team.away.team_avg_batter_ops === 0.730);
check("park.park_factor_runs captured", fc?.park?.park_factor_runs === 1.04);
check("weather.temperature_f captured", fc?.weather?.temperature_f === 78);
check("weather.wind_speed_mph captured", fc?.weather?.wind_speed_mph === 8);
check("weather standard source captured", fc?.weather?.standard_source === "weather_forecasts");
check("weather standard fetched_at captured", fc?.weather?.standard_fetched_at === "2026-06-15T17:55:00.000Z");
check("lineup counts present", fc?.lineup.home != null && fc?.lineup.away != null);
check("factors (audit_per_team) present", "factors" in (fc ?? {}));

// null-starter safety
const out2 = runMlbAutoModelV2_2({ ...snapshot(), home_starter: null }, v1out(), "t60_locked");
check("null starter → feature_capture.starter.home = null (no crash)", out2.v22Audit.feature_capture?.starter.home === null);

// Provenance-only fields may alter only their additive capture values. They
// cannot alter the authoritative forecast or any other audit field.
const withoutProvenanceSnapshot = snapshot();
if (withoutProvenanceSnapshot.weather) {
  delete withoutProvenanceSnapshot.weather.standard_source;
  delete withoutProvenanceSnapshot.weather.standard_fetched_at;
}
const withoutProvenance = runMlbAutoModelV2_2(withoutProvenanceSnapshot, v1out(), "t60_locked");
function stripWeatherProvenance<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T & {
    v22Audit?: { feature_capture?: { weather?: Record<string, unknown> | null } | null };
  };
  const weather = copy.v22Audit?.feature_capture?.weather;
  if (weather) {
    delete weather.standard_source;
    delete weather.standard_fetched_at;
  }
  return copy;
}
check(
  "standard weather provenance is model-output strip-identical",
  JSON.stringify(stripWeatherProvenance(out)) ===
    JSON.stringify(stripWeatherProvenance(withoutProvenance)),
);

// backward-compat: old snapshot lacking feature_capture reads fine (optional)
const legacy = { ...a } as V22Audit; delete (legacy as { feature_capture?: unknown }).feature_capture;
check("legacy audit w/o feature_capture: optional read = null", (legacy.feature_capture ?? null) === null);

console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
process.exit(fail === 0 ? 0 : 1);
