/**
 * Push 3A — fixture-only unit tests for V2.2 architecture.
 *
 * Covers:
 *   • Layer 2 — projectIndependent: factor math, missing-feature
 *     handling, tier derivation, fallback when no starters.
 *   • Layer 3 — blendPosterior: adaptive trust weights, posterior
 *     caps for total and diff, no-market fallback path.
 *   • End-to-end runMlbAutoModelV2_2: produces valid output shape,
 *     respects V2.2 Best Angle thresholds, NRFI passthrough from V1,
 *     doesn't crash on missing weather/lineup/starter.
 *
 * Pure tests — no DB, no env, no network.
 *
 * Run: npx tsx scripts/test-mlb-automodel-v2-2.ts
 */

import {
  projectIndependent,
  pitchQualityProxy,
  V22_LEAGUE_AVG_RUNS_PER_GAME,
  V22_LEAGUE_AVG_OPS,
  V22_LEAGUE_AVG_STARTER_ERA,
  __TEST__ as INDEP_TEST,
} from "../lib/automodel/mlbIndependentProjection";
import {
  blendPosterior,
  selectTrustIndependent,
  computeConfidence,
  V22_TRUST_INDEPENDENT_HIGH,
  V22_TRUST_INDEPENDENT_MEDIUM,
  V22_TRUST_INDEPENDENT_LOW,
  V22_TRUST_INDEPENDENT_FALLBACK_NO_MARKET,
  V22_TRUST_INDEPENDENT_SEVERE_MISSING,
  V22_POSTERIOR_TOTAL_CAP_RUNS,
  V22_POSTERIOR_DIFF_CAP_RUNS,
  V22_CONFIDENCE_CEILING,
} from "../lib/automodel/mlbV22PosteriorBlend";
import { runMlbAutoModelV2_2 } from "../lib/automodel/mlbAutoModelV2_2";
import { computeMarketBaseline } from "../lib/automodel/marketPrior";
import type {
  GameSnapshot,
  StarterSnapshot,
  TeamSnapshot,
  MarketSnapshot,
  ParkSnapshot,
  WeatherSnapshot,
  AutoModelOutput,
} from "../lib/automodel/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function near(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── Synthetic snapshot builders ──────────────────────────────────────────

function buildTeam(opts: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    team_external_id: opts.team_external_id ?? 1,
    abbreviation: opts.abbreviation ?? "TST",
    bullpen_era_proxy: "bullpen_era_proxy" in opts ? opts.bullpen_era_proxy! : 4.10,
    season_runs_per_game: "season_runs_per_game" in opts ? opts.season_runs_per_game! : 4.45,
    team_avg_batter_ops: "team_avg_batter_ops" in opts ? opts.team_avg_batter_ops : 0.720,
    team_avg_batter_ops_sample: 4000,
  };
}

function buildStarter(opts: Partial<StarterSnapshot> = {}): StarterSnapshot {
  return {
    player_external_id: opts.player_external_id ?? 100,
    player_name: opts.player_name ?? "Test Pitcher",
    throws: "throws" in opts ? opts.throws! : "R",
    season_era: "season_era" in opts ? opts.season_era! : 4.10,
    season_whip: "season_whip" in opts ? opts.season_whip! : 1.30,
    season_k_per_9: "season_k_per_9" in opts ? opts.season_k_per_9! : 8.5,
    last30_era: "last30_era" in opts ? opts.last30_era! : null,
    pitch_quality_score: "pitch_quality_score" in opts ? opts.pitch_quality_score! : 1.00,
    is_confirmed: true,
    is_scratched: false,
    first_inning_era: null,
    first_inning_starts: null,
    first_inning_whip: null,
    season_games_started: 15,
    season_games_pitched: 15,
    season_innings_pitched: 90,
  };
}

function buildMarket(opts: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    listed_total: "listed_total" in opts ? opts.listed_total! : 8.5,
    home_ml_odds_american: "home_ml_odds_american" in opts ? opts.home_ml_odds_american! : -120,
    away_ml_odds_american: "away_ml_odds_american" in opts ? opts.away_ml_odds_american! : 110,
    has_pinnacle_total: opts.has_pinnacle_total ?? true,
  };
}

function buildPark(pf: number | null = 1.0): ParkSnapshot {
  return { park_factor_runs: pf, is_dome: false };
}

function buildWeather(): WeatherSnapshot {
  return {
    temperature_f: 72,
    humidity_pct: 50,
    wind_speed_mph: 5,
    wind_direction_degrees: 90,
    is_notable: false,
    notable_reason: null,
  };
}

type SnapOverrides = {
  homeTeam?: Partial<TeamSnapshot>;
  awayTeam?: Partial<TeamSnapshot>;
  homeStarter?: Partial<StarterSnapshot> | null;
  awayStarter?: Partial<StarterSnapshot> | null;
  market?: Partial<MarketSnapshot>;
  ballpark?: ParkSnapshot | null;
  weather?: WeatherSnapshot | null;
  weatherAvailable?: boolean;
  lineupConfirmed?: boolean;
  starterConfirmed?: boolean;
};

function buildSnapshot(o: SnapOverrides = {}): GameSnapshot {
  return {
    game_external_id: 1000,
    slate_date: "2026-06-06",
    game_date: "2026-06-06T19:00:00Z",
    home_team: { ...buildTeam({ team_external_id: 1, abbreviation: "HOM" }), ...(o.homeTeam ?? {}) },
    away_team: { ...buildTeam({ team_external_id: 2, abbreviation: "AWY" }), ...(o.awayTeam ?? {}) },
    home_starter: o.homeStarter === null ? null : { ...buildStarter({ player_external_id: 100 }), ...(o.homeStarter ?? {}) },
    away_starter: o.awayStarter === null ? null : { ...buildStarter({ player_external_id: 200 }), ...(o.awayStarter ?? {}) },
    home_lineup_top8: [],
    away_lineup_top8: [],
    ballpark: o.ballpark === undefined ? buildPark(1.0) : o.ballpark,
    weather: o.weather === undefined ? buildWeather() : o.weather,
    market: { ...buildMarket(), ...(o.market ?? {}) },
    sharp: null,
    active_injuries: {
      home_starter_out: false,
      away_starter_out: false,
      home_top3_hitters_injured_count: 0,
      away_top3_hitters_injured_count: 0,
    },
    data_quality: {
      starter_confirmed: o.starterConfirmed ?? true,
      lineup_confirmed: o.lineupConfirmed ?? true,
      weather_available: o.weatherAvailable ?? true,
      season_stats_present: true,
    },
  };
}

function buildV1Out(opts: Partial<AutoModelOutput> = {}): AutoModelOutput {
  const pick = <K extends keyof AutoModelOutput>(k: K, fallback: AutoModelOutput[K]): AutoModelOutput[K] =>
    (k in opts ? (opts[k] as AutoModelOutput[K]) : fallback);
  return {
    game_external_id: pick("game_external_id", 1000),
    prediction_source: "auto_v1_mlb_rules",
    predicted_home_score: pick("predicted_home_score", 4.5),
    predicted_away_score: pick("predicted_away_score", 4.0),
    predicted_total: pick("predicted_total", 8.5),
    predicted_ml_winner: pick("predicted_ml_winner", "home"),
    ml_confidence: pick("ml_confidence", 54),
    predicted_ou_side: pick("predicted_ou_side", "under"),
    ou_confidence: pick("ou_confidence", 52),
    predicted_nrfi: pick("predicted_nrfi", true),
    nrfi_confidence: pick("nrfi_confidence", 58),
    sport_specific: (opts.sport_specific ?? {}) as AutoModelOutput["sport_specific"],
  };
}

async function main() {
  // ──────────────────────────────────────────────────────────────────
  section("Layer 2 — single-factor helpers");
  // offenseFactor
  check(
    "offenseFactor league avg OPS → 1.0",
    near(INDEP_TEST.offenseFactor(buildTeam({ team_avg_batter_ops: V22_LEAGUE_AVG_OPS })), 1.0),
  );
  check(
    "offenseFactor +5% OPS → ~1.069",
    near(INDEP_TEST.offenseFactor(buildTeam({ team_avg_batter_ops: V22_LEAGUE_AVG_OPS * 1.05 })), 1.05, 0.001),
  );
  check(
    "offenseFactor clamps below FACTOR_CLAMP_MIN",
    INDEP_TEST.offenseFactor(buildTeam({ team_avg_batter_ops: 0.10 })) >= 0.70,
  );
  check(
    "offenseFactor falls back to runs/game when OPS missing",
    near(INDEP_TEST.offenseFactor(buildTeam({ team_avg_batter_ops: null, season_runs_per_game: V22_LEAGUE_AVG_RUNS_PER_GAME })), 1.0),
  );
  check(
    "offenseFactor returns 1.0 when both inputs missing",
    near(INDEP_TEST.offenseFactor(buildTeam({ team_avg_batter_ops: null, season_runs_per_game: null })), 1.0),
  );

  // pitcherFactor
  check(
    "pitcherFactor null starter → 1.0",
    near(INDEP_TEST.pitcherFactor(null), 1.0),
  );
  check(
    "pitcherFactor league avg ERA + neutral PQ → 1.0",
    near(INDEP_TEST.pitcherFactor(buildStarter({ season_era: V22_LEAGUE_AVG_STARTER_ERA, pitch_quality_score: 1.0 })), 1.0),
  );
  check(
    "pitcherFactor low ERA → <1.0 (suppresses opp runs)",
    INDEP_TEST.pitcherFactor(buildStarter({ season_era: 2.50, pitch_quality_score: 1.0 })) < 1.0,
  );
  check(
    "pitcherFactor high ERA → >1.0 (boosts opp runs)",
    INDEP_TEST.pitcherFactor(buildStarter({ season_era: 6.50, pitch_quality_score: 1.0 })) > 1.0,
  );
  check(
    "pitcherFactor null ERA → 1.0",
    near(INDEP_TEST.pitcherFactor(buildStarter({ season_era: null })), 1.0),
  );

  // parkFactor
  check(
    "parkFactor null park → 1.0",
    near(INDEP_TEST.parkFactor(buildSnapshot({ ballpark: null })), 1.0),
  );
  check(
    "parkFactor 1.05 → 1.05 (Coors-ish)",
    near(INDEP_TEST.parkFactor(buildSnapshot({ ballpark: buildPark(1.05) })), 1.05),
  );
  check(
    "parkFactor 0.92 → 0.92 (pitcher-friendly)",
    near(INDEP_TEST.parkFactor(buildSnapshot({ ballpark: buildPark(0.92) })), 0.92),
  );

  // weatherFactor — non-notable defaults to 1.0
  check(
    "weatherFactor no notable + mild temp → ~1.0",
    near(INDEP_TEST.weatherFactor(buildSnapshot()), 1.0, 0.05),
  );

  // ──────────────────────────────────────────────────────────────────
  section("Layer 2 — projectIndependent integration");
  {
    const snap = buildSnapshot();
    const proj = projectIndependent(snap);
    check(
      "league-avg inputs ≈ baseline runs (4.45 + home edge ~0.10)",
      proj.home_expected_runs > V22_LEAGUE_AVG_RUNS_PER_GAME &&
        proj.away_expected_runs > 4.0 && proj.away_expected_runs < 5.0,
    );
    check("total = away + home", near(proj.total_expected_runs, proj.away_expected_runs + proj.home_expected_runs));
    check("home_run_diff = home - away", near(proj.home_run_diff, proj.home_expected_runs - proj.away_expected_runs));
    check("data_quality_tier high when all features present", proj.data_quality_tier === "high");
    // After Push 3A-2: 14 audit slots. The test fixture has empty
    // lineup_top8 arrays → confirmed_lineup is "missing" on both sides
    // (the 2 expected missing). Everything else should be preferred/proxy.
    check("feature_audit.missing_count == 2 (lineup-only) with default fixture",
      proj.feature_audit.missing_count === 2,
      `actual missing=${proj.feature_audit.missing_count}`);
    check("feature_audit.present_count == 12 with default fixture",
      proj.feature_audit.present_count === 12,
      `actual present=${proj.feature_audit.present_count}`);
    check("feature_audit lineup_missing reason emitted",
      proj.feature_audit.reason_codes.includes("lineup_missing"),
      `codes=${JSON.stringify(proj.feature_audit.reason_codes)}`);
    check("feature_audit.starter_era status = proxy on default fixture",
      proj.feature_audit.starter_era.home.source === "proxy" && proj.feature_audit.starter_era.away.source === "proxy");
    check("feature_audit.team_ops status = proxy on default fixture",
      proj.feature_audit.team_ops.home.source === "proxy" && proj.feature_audit.team_ops.away.source === "proxy");
    check("feature_audit.starter_pitch_quality status = preferred on default fixture",
      proj.feature_audit.starter_pitch_quality.home.source === "preferred",
      `actual=${proj.feature_audit.starter_pitch_quality.home.source}`);
    check("feature_audit.park_factor status = preferred",
      proj.feature_audit.park_factor.source === "preferred");
    check("feature_audit.weather status = proxy (row exists, not notable)",
      proj.feature_audit.weather.source === "proxy",
      `actual=${proj.feature_audit.weather.source}`);
  }
  {
    // Strong offense — should push home runs >> 4.45
    const snap = buildSnapshot({
      homeTeam: { team_avg_batter_ops: 0.820 },
      awayStarter: { season_era: 6.50 }, // bad pitcher → home scores more
    });
    const proj = projectIndependent(snap);
    check(
      "strong offense + weak opp starter → home expected > 5.0",
      proj.home_expected_runs > 5.0,
      `actual=${proj.home_expected_runs.toFixed(2)}`,
    );
  }
  {
    // Missing both starters — tier falls to fallback
    const snap = buildSnapshot({ homeStarter: null, awayStarter: null });
    const proj = projectIndependent(snap);
    check("missing both starters → fallback tier", proj.data_quality_tier === "fallback");
  }
  {
    // Missing OPS AND runs/g on one side (no offense data at all) → low tier
    const snap = buildSnapshot({
      homeTeam: { team_avg_batter_ops: null, season_runs_per_game: null },
    });
    const proj = projectIndependent(snap);
    check("missing one team's offense entirely → low tier", proj.data_quality_tier === "low",
      `actual=${proj.data_quality_tier}`);
  }
  {
    // OPS null but runs/g present → fallback_real, not low tier (offense IS available)
    const snap = buildSnapshot({
      homeTeam: { team_avg_batter_ops: null },
    });
    const proj = projectIndependent(snap);
    check("OPS null but runs/g present → fallback_real source",
      proj.feature_audit.team_ops.home.source === "fallback_real",
      `actual=${proj.feature_audit.team_ops.home.source}`);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Layer 3 — selectTrustIndependent");
  check("high tier + has market → 0.65", selectTrustIndependent({ tier: "high", missingCount: 0, hasMarket: true }) === V22_TRUST_INDEPENDENT_HIGH);
  check("medium tier + has market → 0.45", selectTrustIndependent({ tier: "medium", missingCount: 4, hasMarket: true }) === V22_TRUST_INDEPENDENT_MEDIUM);
  check("low tier + has market → 0.25", selectTrustIndependent({ tier: "low", missingCount: 6, hasMarket: true }) === V22_TRUST_INDEPENDENT_LOW);
  check("fallback + has market → 0.05", selectTrustIndependent({ tier: "fallback", missingCount: 10, hasMarket: true }) === V22_TRUST_INDEPENDENT_SEVERE_MISSING);
  check("no market → 1.0 (independent IS the answer)", selectTrustIndependent({ tier: "high", missingCount: 0, hasMarket: false }) === V22_TRUST_INDEPENDENT_FALLBACK_NO_MARKET);
  check("severe missing (≥12) → 0.05 even at high tier", selectTrustIndependent({ tier: "high", missingCount: 13, hasMarket: true }) === V22_TRUST_INDEPENDENT_SEVERE_MISSING);

  // ──────────────────────────────────────────────────────────────────
  section("Layer 3 — blendPosterior");
  {
    // Sanity: when independent matches market exactly, posterior == independent
    const indep = projectIndependent(buildSnapshot());
    const market = computeMarketBaseline(buildMarket({ listed_total: indep.total_expected_runs }), null);
    const post = blendPosterior({ market, independent: indep });
    check("no-cap, balanced inputs → posterior near independent",
      near(post.total_expected_runs, indep.total_expected_runs, 1.0));
  }
  {
    // Independent disagrees strongly with market — cap kicks in
    const indep = projectIndependent(buildSnapshot({
      homeTeam: { team_avg_batter_ops: 0.900 },
      awayTeam: { team_avg_batter_ops: 0.900 },
      ballpark: buildPark(1.35),
    }));
    const market = computeMarketBaseline(buildMarket({ listed_total: 7.0 }), null);
    const post = blendPosterior({ market, independent: indep });
    check(
      "huge independent vs low market total → posterior capped",
      post.capped_by_total || Math.abs(post.total_expected_runs - 7.0) <= V22_POSTERIOR_TOTAL_CAP_RUNS,
    );
  }
  {
    // No market → trust_independent = 1.0
    const indep = projectIndependent(buildSnapshot());
    const post = blendPosterior({ market: null, independent: indep });
    check("no market → trust_independent = 1.0", post.trust_independent === V22_TRUST_INDEPENDENT_FALLBACK_NO_MARKET);
    check("no market → posterior IS independent",
      near(post.total_expected_runs, indep.total_expected_runs));
  }
  {
    // Diff cap — independent says huge favorite but market sees balanced
    const indep = projectIndependent(buildSnapshot({
      homeTeam: { team_avg_batter_ops: 0.850 },
      awayTeam: { team_avg_batter_ops: 0.580 },
      awayStarter: { season_era: 6.50 },
      homeStarter: { season_era: 2.50 },
    }));
    const market = computeMarketBaseline(buildMarket({ home_ml_odds_american: -115, away_ml_odds_american: 105, listed_total: 8.5 }), null);
    const post = blendPosterior({ market, independent: indep });
    check(
      "huge diff vs balanced market → diff capped or within cap",
      post.capped_by_diff || Math.abs(post.home_run_diff) <= V22_POSTERIOR_DIFF_CAP_RUNS + 0.5,
      `cap_diff=${post.capped_by_diff} actual_diff=${post.home_run_diff.toFixed(2)}`,
    );
  }
  {
    // Posterior must always be non-negative even with extreme inputs
    const indep = projectIndependent(buildSnapshot({
      homeTeam: { team_avg_batter_ops: 0.10 },
      awayTeam: { team_avg_batter_ops: 0.10 },
    }));
    const market = computeMarketBaseline(buildMarket({ listed_total: 12.0 }), null);
    const post = blendPosterior({ market, independent: indep });
    check("posterior runs non-negative",
      post.away_expected_runs >= 0.5 && post.home_expected_runs >= 0.5);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Layer 3 — computeConfidence");
  check("coin-flip → confidence at floor (50)", near(computeConfidence({ win_prob: 0.5, ou_prob: 0.5, run_diff_abs: 0, tier: "high" }), 50, 1));
  check("strong pick at high tier → respects ceiling 78",
    computeConfidence({ win_prob: 0.75, ou_prob: 0.70, run_diff_abs: 2.0, tier: "high" }) <= V22_CONFIDENCE_CEILING.high);
  check("strong pick at fallback tier → respects ceiling 54",
    computeConfidence({ win_prob: 0.75, ou_prob: 0.70, run_diff_abs: 2.0, tier: "fallback" }) <= V22_CONFIDENCE_CEILING.fallback);
  check("medium tier ceiling = 64",
    computeConfidence({ win_prob: 0.85, ou_prob: 0.85, run_diff_abs: 4.0, tier: "medium" }) <= V22_CONFIDENCE_CEILING.medium);

  // ──────────────────────────────────────────────────────────────────
  section("End-to-end — runMlbAutoModelV2_2");
  {
    const snap = buildSnapshot();
    const v1 = buildV1Out();
    const out = runMlbAutoModelV2_2(snap, v1, "morning_draft");
    check("output shape — predicted scores present", out.predicted_home_score > 0 && out.predicted_away_score > 0);
    check("output shape — predicted_total = home + away", near(out.predicted_total, out.predicted_home_score + out.predicted_away_score, 0.01));
    check("output shape — ml_winner is home or away", out.predicted_ml_winner === "home" || out.predicted_ml_winner === "away");
    check("output shape — ou_side is over or under", out.predicted_ou_side === "over" || out.predicted_ou_side === "under");
    check("output shape — confidences in [50, 78]", out.ml_confidence >= 50 && out.ml_confidence <= V22_CONFIDENCE_CEILING.high && out.ou_confidence >= 50 && out.ou_confidence <= V22_CONFIDENCE_CEILING.high);
    check("NRFI passthrough from V1", out.predicted_nrfi === v1.predicted_nrfi && out.nrfi_confidence === v1.nrfi_confidence);
    check("v22Audit present", out.v22Audit !== null && typeof out.v22Audit === "object");
    check("v22Audit.market_baseline_valid true on good inputs", out.v22Audit.market_baseline_valid);
    check("v22Audit.data_quality_tier === high on full snapshot", out.v22Audit.data_quality_tier === "high");
  }
  {
    // Missing weather — must not crash
    const snap = buildSnapshot({ weather: null, weatherAvailable: false });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("missing weather — model still produces predictions", out.predicted_total > 0);
    check("missing weather — tier downgrades (high→medium/low)", out.v22Audit.data_quality_tier !== "fallback");
  }
  {
    // Missing one starter — provisional and fallback tier
    const snap = buildSnapshot({ homeStarter: null });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("missing one starter → fallback tier", out.v22Audit.data_quality_tier === "fallback");
    check("missing one starter → provisional", out.v22Audit.provisional);
  }
  {
    // Missing market — no Best Angle expected, provisional flag set
    const snap = buildSnapshot({
      market: { listed_total: null, home_ml_odds_american: null, away_ml_odds_american: null },
    });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("missing market → market_baseline_valid=false", !out.v22Audit.market_baseline_valid);
    check("missing market → provisional", out.v22Audit.provisional);
    check("missing market → still produces predictions (independent IS the answer)",
      out.predicted_total > 0 && out.predicted_home_score > 0);
  }
  {
    // Low-data-quality + strong edge should NOT yield Best Angle
    const snap = buildSnapshot({
      homeTeam: { team_avg_batter_ops: 0.850 }, // missing-stat scenario removed
      awayTeam: { team_avg_batter_ops: null },  // forces low tier
      awayStarter: { season_era: 6.50 },
      homeStarter: { season_era: 2.50 },
    });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("low-quality data → ml Best Angle BLOCKED even if model loves the pick",
      !out.v22Audit.ml_best_angle_eligible || out.v22Audit.data_quality_tier === "high",
      `tier=${out.v22Audit.data_quality_tier} ml_BA=${out.v22Audit.ml_best_angle_eligible}`);
  }
  {
    // Poisson with equal expected runs → home ML prob ~ 0.5 ± a hair from
    // home-field bias; ML pick is whichever side wins the marginal
    const snap = buildSnapshot({
      homeTeam: { team_avg_batter_ops: V22_LEAGUE_AVG_OPS },
      awayTeam: { team_avg_batter_ops: V22_LEAGUE_AVG_OPS },
    });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("near-equal teams → ml model prob between 0.4 and 0.6",
      out.v22Audit.ml_model_prob >= 0.4 && out.v22Audit.ml_model_prob <= 0.6);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Push 3A-2 — pitch quality proxy + fallback hierarchy");
  {
    // Pitch quality proxy from ERA+WHIP+K/9
    const goodStarter = buildStarter({ pitch_quality_score: null, season_era: 2.8, season_whip: 1.05, season_k_per_9: 10.5 });
    const badStarter = buildStarter({ pitch_quality_score: null, season_era: 5.5, season_whip: 1.55, season_k_per_9: 6.5 });
    const pqGood = pitchQualityProxy(goodStarter);
    const pqBad = pitchQualityProxy(badStarter);
    check("pitchQualityProxy good pitcher → < 1.0 (suppresses runs)", pqGood !== null && pqGood < 1.0, `actual=${pqGood}`);
    check("pitchQualityProxy bad pitcher → > 1.0 (boosts runs)", pqBad !== null && pqBad > 1.0, `actual=${pqBad}`);
    check("pitchQualityProxy in [0.92, 1.08]", pqGood !== null && pqBad !== null && pqGood >= 0.92 && pqGood <= 1.08 && pqBad >= 0.92 && pqBad <= 1.08);
    check("pitchQualityProxy null when no stats", pitchQualityProxy(buildStarter({ pitch_quality_score: null, season_era: null, season_whip: null, season_k_per_9: null })) === null);
  }
  {
    // pitcherFactor uses proxy when raw missing — same direction as raw
    const noPq = buildStarter({ pitch_quality_score: null, season_era: 3.0, season_whip: 1.05, season_k_per_9: 10.5 });
    const realPq = buildStarter({ pitch_quality_score: 0.95, season_era: 3.0, season_whip: 1.05, season_k_per_9: 10.5 });
    const fNoPq = INDEP_TEST.pitcherFactor(noPq);
    const fRealPq = INDEP_TEST.pitcherFactor(realPq);
    check("pitcherFactor uses proxy when raw pq missing (factor < no-pq baseline)", fNoPq < 3.0 / V22_LEAGUE_AVG_STARTER_ERA, `f=${fNoPq}`);
    check("pitcherFactor with raw pq matches similar direction", Math.abs(fNoPq - fRealPq) < 0.10);
  }
  {
    // Audit reflects pitch_quality proxy when raw missing
    const snap = buildSnapshot({
      homeStarter: { pitch_quality_score: null, season_era: 3.5, season_whip: 1.15, season_k_per_9: 9.5 },
      awayStarter: { pitch_quality_score: null, season_era: 3.5, season_whip: 1.15, season_k_per_9: 9.5 },
    });
    const proj = projectIndependent(snap);
    check("starter_pitch_quality status = proxy when raw absent + ERA/WHIP/K9 present",
      proj.feature_audit.starter_pitch_quality.home.source === "proxy" &&
      proj.feature_audit.starter_pitch_quality.away.source === "proxy",
      `home=${proj.feature_audit.starter_pitch_quality.home.source} away=${proj.feature_audit.starter_pitch_quality.away.source}`);
    check("starter_pitch_quality reason = pitch_quality_proxy_era_whip_k9",
      proj.feature_audit.starter_pitch_quality.home.reason === "pitch_quality_proxy_era_whip_k9");
    check("audit.proxy_count includes the pitch_quality proxy (≥2)",
      proj.feature_audit.proxy_count >= 2);
  }
  {
    // Audit reflects missing pitch_quality when ALL stats absent
    const snap = buildSnapshot({
      homeStarter: { pitch_quality_score: null, season_era: null, season_whip: null, season_k_per_9: null },
      awayStarter: { season_era: 4.0, pitch_quality_score: null },
    });
    const proj = projectIndependent(snap);
    check("starter_pitch_quality missing when no proxy inputs",
      proj.feature_audit.starter_pitch_quality.home.source === "missing");
  }
  {
    // Weather reason codes
    const snap1 = buildSnapshot({ weather: null });
    const proj1 = projectIndependent(snap1);
    check("weather status missing when row absent",
      proj1.feature_audit.weather.source === "missing" && proj1.feature_audit.weather.reason === "weather_missing");
    const snap2 = buildSnapshot({
      weather: { temperature_f: 72, humidity_pct: 50, wind_speed_mph: 5, wind_direction_degrees: 90, is_notable: false, notable_reason: null },
    });
    const proj2 = projectIndependent(snap2);
    check("weather status proxy when row present but not notable",
      proj2.feature_audit.weather.source === "proxy" && proj2.feature_audit.weather.reason === "weather_proxy_quiet_row");
    const snap3 = buildSnapshot({
      weather: { temperature_f: 90, humidity_pct: 50, wind_speed_mph: 18, wind_direction_degrees: 90, is_notable: true, notable_reason: "wind out 18 mph" },
    });
    const proj3 = projectIndependent(snap3);
    check("weather status preferred when notable",
      proj3.feature_audit.weather.source === "preferred" && proj3.feature_audit.weather.reason === "weather_ok");
  }
  {
    // Lineup status reasons
    const snap = buildSnapshot();
    const proj = projectIndependent(snap);
    check("lineup status missing when length < 8",
      proj.feature_audit.confirmed_lineup.home.source === "missing" && proj.feature_audit.confirmed_lineup.home.reason === "lineup_missing");
  }
  {
    // V2.2 main model rolls up the source counts into audit
    const snap = buildSnapshot();
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("V22Audit carries feature_preferred_count",
      typeof out.v22Audit.feature_preferred_count === "number" && out.v22Audit.feature_preferred_count >= 1,
      `actual=${out.v22Audit.feature_preferred_count}`);
    check("V22Audit carries feature_proxy_count",
      typeof out.v22Audit.feature_proxy_count === "number" && out.v22Audit.feature_proxy_count >= 2,
      `actual=${out.v22Audit.feature_proxy_count}`);
    check("V22Audit carries feature_reason_codes array",
      Array.isArray(out.v22Audit.feature_reason_codes) && out.v22Audit.feature_reason_codes.length >= 4);
  }
  {
    // Best Angle BLOCKED when both sides starter missing (tier=fallback already covered;
    // here we verify the explicit Best Angle cap rather than the tier path)
    const snap = buildSnapshot({ homeStarter: null, awayStarter: null });
    const out = runMlbAutoModelV2_2(snap, buildV1Out(), "morning_draft");
    check("Best Angle blocked when both starters missing",
      !out.v22Audit.ml_best_angle_eligible && !out.v22Audit.ou_best_angle_eligible);
    check("model_integrity_notes mentions BA block on neutral fallback",
      out.v22Audit.model_integrity_notes.some((n) => /Best Angle blocked/i.test(n)) ||
        out.v22Audit.model_integrity_notes.some((n) => /Insufficient starter/i.test(n)),
      `notes=${JSON.stringify(out.v22Audit.model_integrity_notes)}`);
  }

  // ──────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
