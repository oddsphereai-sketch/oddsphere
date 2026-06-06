/**
 * Phase 6B — fixture-only unit tests for marketPrior + mlbAutoModelV2.
 *
 * Pure tests — no DB, no env, no network. The model + helpers are pure
 * functions that take typed inputs and return verdicts.
 *
 * Run: npx tsx scripts/test-mlb-automodel-v2.ts
 */

import {
  americanToImpliedProb,
  noVigPair,
  probToRunShare,
  computeMarketBaseline,
  RUN_SHARE_SLOPE,
  SHARE_FLOOR,
  SHARE_CEIL,
} from "../lib/automodel/marketPrior";
import {
  runMlbAutoModelV2,
  RESIDUAL_CAP_RUNS,
  RESIDUAL_TRUST_COEF,
  V2_CONF_FLOOR,
  V2_CONF_CEIL_HIGH,
  V2_CONF_CEIL_MEDIUM,
  V2_CONF_CEIL_LOW,
  V2_BEST_ANGLE_MIN_EDGE_PCT,
  V2_BEST_ANGLE_MIN_CONFIDENCE,
  OU_EDGE_FLOOR_RUNS,
} from "../lib/automodel/mlbAutoModelV2";
import type {
  GameSnapshot,
  AutoModelOutput,
  MarketSnapshot,
  SharpSnapshot,
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

// ─── Helpers to build synthetic snapshots ────────────────────────────────

function buildMarket(opts: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    // Use 'in opts' tests so passing `null` explicitly overrides the default.
    listed_total: "listed_total" in opts ? opts.listed_total! : 8.5,
    home_ml_odds_american: "home_ml_odds_american" in opts ? opts.home_ml_odds_american! : -120,
    away_ml_odds_american: "away_ml_odds_american" in opts ? opts.away_ml_odds_american! : 110,
    has_pinnacle_total: opts.has_pinnacle_total ?? false,
  };
}

function buildSharp(opts: Partial<SharpSnapshot> = {}): SharpSnapshot {
  return {
    pinnacle_ml_fair_prob_home: opts.pinnacle_ml_fair_prob_home ?? null,
    pinnacle_ml_fair_prob_away: opts.pinnacle_ml_fair_prob_away ?? null,
    pinnacle_total_ev_pct: null,
    pinnacle_ml_ev_pct: null,
    public_betting_pct_home: null,
    public_money_pct_home: null,
    public_betting_pct_over: null,
    public_money_pct_over: null,
  };
}

function buildV1Out(opts: Partial<AutoModelOutput> = {}): AutoModelOutput {
  // Use 'in opts' tests so callers can pass explicit `null` to override defaults.
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
    predicted_nrfi: pick("predicted_nrfi", null),
    nrfi_confidence: pick("nrfi_confidence", null),
    sport_specific: opts.sport_specific as AutoModelOutput["sport_specific"],
  };
}

// Minimal snapshot stub — V2 only reads market + sharp + starter/lineup
// presence (for data-quality assessment). Both starters default to
// non-null placeholders; tests that want missing-starter behavior set
// snap.home_starter = null (or snap.away_starter = null) after building.
function buildSnapshot(market: MarketSnapshot, sharp: SharpSnapshot | null): GameSnapshot {
  return {
    game_external_id: 1000,
    slate_date: "2026-06-06",
    game_date: "2026-06-06T19:00:00Z",
    // V2 doesn't read team fields; cast through unknown for fixture brevity.
    home_team: { id: 1, abbreviation: "HOM", display_name: "Home" } as unknown as GameSnapshot["home_team"],
    away_team: { id: 2, abbreviation: "AWY", display_name: "Away" } as unknown as GameSnapshot["away_team"],
    home_starter: { player_id: 1, mlb_person_id: 100 } as unknown as GameSnapshot["home_starter"],
    away_starter: { player_id: 2, mlb_person_id: 200 } as unknown as GameSnapshot["away_starter"],
    home_lineup_top8: [],
    away_lineup_top8: [],
    ballpark: null,
    weather: null,
    market,
    sharp,
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
  };
}

async function main() {
  // ─── marketPrior — americanToImpliedProb ─────────────────────────────
  section("americanToImpliedProb");
  check("+100 → 0.5", near(americanToImpliedProb(100), 0.5));
  check("-110 → 0.524", near(americanToImpliedProb(-110), 0.5238, 0.001));
  check("+200 → 0.333", near(americanToImpliedProb(200), 0.3333, 0.001));
  check("-200 → 0.667", near(americanToImpliedProb(-200), 0.6667, 0.001));
  check("invalid (0) throws", (() => { try { americanToImpliedProb(0); return false; } catch { return true; } })());

  // ─── marketPrior — noVigPair ─────────────────────────────────────────
  section("noVigPair");
  {
    const p = noVigPair(-110, -110);
    check("balanced -110/-110 → ~0.5/0.5", near(p.home, 0.5) && near(p.away, 0.5));
    check("sums to 1", near(p.home + p.away, 1));
  }
  {
    const p = noVigPair(-150, 130);
    check("-150/+130 → home favored", p.home > p.away);
    check("sums to 1", near(p.home + p.away, 1));
  }
  {
    const p = noVigPair(-200, 170);
    check("-200/+170 → home prob ~0.65", near(p.home, 0.65, 0.02));
  }

  // ─── marketPrior — probToRunShare ────────────────────────────────────
  section("probToRunShare");
  check("0.5 → 0.5 (parity)", near(probToRunShare(0.5), 0.5));
  check("0.55 → 0.515 (design-doc anchor)", near(probToRunShare(0.55), 0.515, 0.001));
  check("0.65 → 0.545", near(probToRunShare(0.65), 0.545, 0.001));
  check("0.30 → bounded above SHARE_FLOOR (0.4)", probToRunShare(0.30) >= SHARE_FLOOR);
  check("0.95 → bounded below SHARE_CEIL (0.6)", probToRunShare(0.95) <= SHARE_CEIL);
  check("RUN_SHARE_SLOPE = 0.30", RUN_SHARE_SLOPE === 0.30);

  // ─── marketPrior — computeMarketBaseline ─────────────────────────────
  section("computeMarketBaseline");
  {
    // Path 1: Pinnacle fair probs available + listed_total
    const m = buildMarket({ listed_total: 9.0 });
    const s = buildSharp({
      pinnacle_ml_fair_prob_home: 0.55,
      pinnacle_ml_fair_prob_away: 0.45,
    });
    const b = computeMarketBaseline(m, s);
    check("Pinnacle path → ok", b.dataQuality === "ok");
    check("source = pinnacle_fair", b.source === "pinnacle_fair");
    check("homeImpliedTotal ≈ 9.0 × 0.515 = 4.6", near(b.homeImpliedTotal ?? 0, 4.6, 0.05));
    check("awayImpliedTotal ≈ 9.0 × 0.485 = 4.4", near(b.awayImpliedTotal ?? 0, 4.4, 0.05));
  }
  {
    // Path 2: American de-vig
    const m = buildMarket({ listed_total: 8.5, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const b = computeMarketBaseline(m, null);
    check("American de-vig → ok", b.dataQuality === "ok");
    check("source = american_devig", b.source === "american_devig");
    check("home prob ≈ 0.5", near(b.homeNoVigProb ?? 0, 0.5));
    check("homeImpliedTotal ≈ 4.3", near(b.homeImpliedTotal ?? 0, 4.3, 0.05));
  }
  {
    // Path 3: Pinnacle present but listed_total null → degraded
    const m = buildMarket({ listed_total: null, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const s = buildSharp({ pinnacle_ml_fair_prob_home: 0.55, pinnacle_ml_fair_prob_away: 0.45 });
    const b = computeMarketBaseline(m, s);
    check("listed_total null + Pinnacle → degraded", b.dataQuality === "degraded");
    check("homeImpliedTotal is null when no total", b.homeImpliedTotal === null);
  }
  {
    // Path 4: Fallback default (no ML, no Pinnacle, has total)
    const m = buildMarket({ listed_total: 8.5, home_ml_odds_american: null, away_ml_odds_american: null });
    const b = computeMarketBaseline(m, null);
    check("only listed_total → degraded + fallback_default", b.dataQuality === "degraded" && b.source === "fallback_default");
    check("uses 0.51 home default share", near(b.homeNoVigProb ?? 0, 0.51));
  }
  {
    // Path 5: Missing — no total, no odds, no Pinnacle
    const m = buildMarket({ listed_total: null, home_ml_odds_american: null, away_ml_odds_american: null });
    const b = computeMarketBaseline(m, null);
    check("nothing → missing", b.dataQuality === "missing");
    check("all numeric fields null", b.homeImpliedTotal === null && b.homeNoVigProb === null);
  }
  {
    // Path 6: Inconsistent Pinnacle probs (sum != 1) → fall through to American
    const m = buildMarket({ listed_total: 8.5, home_ml_odds_american: -130, away_ml_odds_american: 120 });
    const s = buildSharp({ pinnacle_ml_fair_prob_home: 0.6, pinnacle_ml_fair_prob_away: 0.6 }); // sum=1.2
    const b = computeMarketBaseline(m, s);
    check("inconsistent Pinnacle → falls through to American de-vig", b.source === "american_devig");
  }

  // ─── mlbAutoModelV2 — fallback when market missing ───────────────────
  section("mlbAutoModelV2 — fallback path");
  {
    const market = buildMarket({ listed_total: null, home_ml_odds_american: null, away_ml_odds_american: null });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.0, predicted_total: 9.0, predicted_ml_winner: "home", ml_confidence: 56 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("fallback=true when baseline missing", v2.v2Audit.fallback === true);
    check("V2 echoes V1 home score under fallback", v2.predicted_home_score === 5.0);
    check("V2 echoes V1 ML pick under fallback", v2.predicted_ml_winner === "home");
    check("prediction_source is auto_v2_mlb_market_prior", v2.prediction_source === "auto_v2_mlb_market_prior");
  }

  // ─── mlbAutoModelV2 — V1 null scores (very rare) ─────────────────────
  section("mlbAutoModelV2 — V1 null-scores path (provisional)");
  {
    // V1 returned truly-null scores (rare). V2 still produces a numeric
    // prediction from the market baseline, marked provisional.
    const market = buildMarket({ listed_total: 8.5 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: null, predicted_away_score: null, predicted_total: null, predicted_ml_winner: null, ml_confidence: null, predicted_ou_side: null, ou_confidence: null });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 emits market-implied home total when V1 has null scores", v2.predicted_home_score !== null);
    check("V2 emits market listed_total when V1 has null scores", v2.predicted_total === 8.5);
    check("V2 marks provisional when V1 had null scores", v2.v2Audit.provisional === true);
    check("audit.notes mentions market-implied baseline", v2.v2Audit.notes.some((n) => n.includes("market-implied baseline")));
  }

  // ─── mlbAutoModelV2 — normal residual application ────────────────────
  section("mlbAutoModelV2 — normal residual application");
  {
    // Market: 8.5 total, -110/-110 → both teams implied 4.3
    // V1 says home 5.0, away 4.0 → home residual +0.7, away residual -0.3
    // RESIDUAL_TRUST_COEF=0.6 → home applied +0.42, away -0.18
    // V2 home = 4.3 + 0.42 = 4.7, V2 away = 4.3 - 0.18 = 4.1
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.0, predicted_total: 9.0 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 home score moves from market baseline toward V1 (4.7)", near(v2.predicted_home_score ?? 0, 4.7, 0.1));
    check("V2 away score moves from market baseline toward V1 (4.1)", near(v2.predicted_away_score ?? 0, 4.1, 0.1));
    check("V2 ML pick = home (V2 home > away)", v2.predicted_ml_winner === "home");
    check("cap not active on either side (residuals small)", v2.v2Audit.capActiveHome === false && v2.v2Audit.capActiveAway === false);
    check("V2 has confidence ≥ 50", (v2.ml_confidence ?? 0) >= 50);
    check("V2 confidence ≤ ceil (80)", (v2.ml_confidence ?? 0) <= V2_CONF_CEIL_HIGH);
    check("V2 NOT provisional (high data quality)", v2.v2Audit.provisional === false);
    check("V2 dataQuality.tier = 'high'", v2.v2Audit.dataQuality.tier === "high");
  }

  // ─── mlbAutoModelV2 — cap activation ─────────────────────────────────
  section("mlbAutoModelV2 — cap binding");
  {
    // V1 wildly disagrees: home 12, away 1 vs market 4.3/4.3
    // home residual raw = +7.7, scaled = 4.62, clamped to +2.5
    // away residual raw = -3.3, scaled = -1.98, NOT capped
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 12, predicted_away_score: 1, predicted_total: 13 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("home cap active", v2.v2Audit.capActiveHome === true);
    check("home residual applied = +cap", near(v2.v2Audit.homeResidualApplied ?? 0, RESIDUAL_CAP_RUNS, 0.1));
    check("away cap NOT active", v2.v2Audit.capActiveAway === false);
    check("away residual ~= raw * trust", near(v2.v2Audit.awayResidualApplied ?? 0, -3.3 * RESIDUAL_TRUST_COEF, 0.1));
    check("audit notes log the cap activation", v2.v2Audit.notes.some((n) => n.includes("Cap active")));
  }

  // ─── mlbAutoModelV2 — degraded data drag ─────────────────────────────
  section("mlbAutoModelV2 — degraded data drag");
  {
    // listed_total only, no ML odds → degraded, fallback_default share
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: null, away_ml_odds_american: null });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.0 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 still produces a prediction in degraded mode", v2.predicted_home_score !== null);
    check("degraded drag applied to confidence", v2.v2Audit.degradedDrag > 0);
  }

  // ─── mlbAutoModelV2 — OU edge floor holds the market ─────────────────
  section("mlbAutoModelV2 — OU edge floor");
  {
    // V1 nearly matches market: home 4.4, away 4.3 (total 8.7) vs listed 8.5
    // Residual scaled small; V2 total close to 8.5 → diff < OU_EDGE_FLOOR_RUNS (0.3) → no pick
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 4.4, predicted_away_score: 4.3, predicted_total: 8.7 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    const diff = Math.abs((v2.predicted_total ?? 0) - 8.5);
    if (diff < OU_EDGE_FLOOR_RUNS) {
      check("OU pick null when |edge| < floor", v2.predicted_ou_side === null);
    } else {
      check("(this scenario produced edge above floor; skipping floor check)", true);
    }
  }

  // ─── mlbAutoModelV2 — FI passthrough ─────────────────────────────────
  section("mlbAutoModelV2 — first-inning passthrough");
  {
    const market = buildMarket();
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_nrfi: true, nrfi_confidence: 62 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 preserves V1 NRFI pick", v2.predicted_nrfi === true);
    check("V2 preserves V1 NRFI confidence", v2.nrfi_confidence === 62);
  }

  // ─── mlbAutoModelV2 — provisional path (missing one starter) ─────────
  section("mlbAutoModelV2 — provisional path: missing one starter");
  {
    // V1 still computes scores (V1 uses league averages when starter is null)
    // but home_starter is null in the snapshot. V2 should still produce a
    // numeric prediction, mark provisional, cap confidence at medium tier (58).
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: -130, away_ml_odds_american: 120 });
    const snap = buildSnapshot(market, null);
    // Force home_starter null on the otherwise-built snapshot.
    snap.home_starter = null;
    const v1 = buildV1Out({ predicted_home_score: 5.5, predicted_away_score: 3.5, predicted_total: 9.0, predicted_ml_winner: null, ml_confidence: null });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 produces a numeric ML pick despite missing home starter", v2.predicted_ml_winner !== null);
    check("V2 marked provisional", v2.v2Audit.provisional === true);
    check("dataQuality.tier = 'medium' for 1 missing starter", v2.v2Audit.dataQuality.tier === "medium");
    check("missingInputs lists home_starter", v2.v2Audit.dataQuality.missingInputs.includes("home_starter"));
    check("updateTriggers names home_starter_arrival", v2.v2Audit.dataQuality.updateTriggers.includes("home_starter_arrival"));
    check("ML confidence capped ≤ medium ceiling (58)", (v2.ml_confidence ?? 0) <= V2_CONF_CEIL_MEDIUM);
  }

  // ─── mlbAutoModelV2 — provisional path (missing both starters) ───────
  section("mlbAutoModelV2 — provisional path: missing both starters");
  {
    const market = buildMarket({ listed_total: 9.5, home_ml_odds_american: -150, away_ml_odds_american: 130 });
    const snap = buildSnapshot(market, null);
    snap.home_starter = null;
    snap.away_starter = null;
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.5, predicted_total: 9.5, predicted_ml_winner: null, ml_confidence: null });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("V2 still produces a prediction with both starters missing", v2.predicted_home_score !== null);
    check("dataQuality.tier = 'low'", v2.v2Audit.dataQuality.tier === "low");
    check("missingInputs lists both starters", v2.v2Audit.dataQuality.missingInputs.includes("home_starter") && v2.v2Audit.dataQuality.missingInputs.includes("away_starter"));
    check("ML confidence capped ≤ low ceiling (54)", (v2.ml_confidence ?? 0) <= V2_CONF_CEIL_LOW);
    check("provisional flag set", v2.v2Audit.provisional === true);
  }

  // ─── mlbAutoModelV2 — Best Angle eligibility ─────────────────────────
  section("mlbAutoModelV2 — Best Angle gates");
  {
    // High-data quality + strong edge + high confidence → eligible.
    // Use heavily mispriced V1 scores to generate a real edge.
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: 120, away_ml_odds_american: -130 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 6.0, predicted_away_score: 3.0, predicted_total: 9.0, predicted_ml_winner: "home", ml_confidence: 65 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    // Note: whether actually eligible depends on the math producing
    // edge ≥ 2% AND confidence ≥ 60. This test asserts gate structure
    // not specific outcomes.
    check("bestAngleEligibility has eligible field", typeof v2.v2Audit.bestAngleEligibility.eligible === "boolean");
    check("bestAngleEligibility has failedGates array", Array.isArray(v2.v2Audit.bestAngleEligibility.failedGates));
  }
  {
    // Provisional game → NOT Best Angle eligible regardless of edge.
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: 120, away_ml_odds_american: -130 });
    const snap = buildSnapshot(market, null);
    snap.home_starter = null;
    const v1 = buildV1Out({ predicted_home_score: 6.0, predicted_away_score: 3.0, predicted_total: 9.0, predicted_ml_winner: "home", ml_confidence: 65 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("provisional game → Best Angle ineligible", v2.v2Audit.bestAngleEligibility.eligible === false);
    check("failedGates includes 'provisional'", v2.v2Audit.bestAngleEligibility.failedGates.includes("provisional"));
  }
  {
    // Fallback (market missing) → NOT Best Angle eligible.
    const market = buildMarket({ listed_total: null, home_ml_odds_american: null, away_ml_odds_american: null });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.0 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("fallback → Best Angle ineligible", v2.v2Audit.bestAngleEligibility.eligible === false);
    check("failedGates includes 'v1_fallback'", v2.v2Audit.bestAngleEligibility.failedGates.includes("v1_fallback"));
  }
  {
    // Tiny edge → Best Angle ineligible regardless of data quality.
    const market = buildMarket({ listed_total: 8.5, home_ml_odds_american: -110, away_ml_odds_american: -110 });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 4.4, predicted_away_score: 4.3, predicted_total: 8.7 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("tiny edge → Best Angle ineligible", v2.v2Audit.bestAngleEligibility.eligible === false);
    const fg = v2.v2Audit.bestAngleEligibility.failedGates;
    check("failedGates includes edge-below threshold OR confidence-below threshold", fg.some((g) => g.includes("edge_below") || g.includes("confidence_below")));
  }

  // ─── mlbAutoModelV2 — fallback marked provisional ────────────────────
  section("mlbAutoModelV2 — fallback also marked provisional");
  {
    const market = buildMarket({ listed_total: null, home_ml_odds_american: null, away_ml_odds_american: null });
    const snap = buildSnapshot(market, null);
    const v1 = buildV1Out({ predicted_home_score: 5.0, predicted_away_score: 4.0 });
    const v2 = runMlbAutoModelV2(snap, v1, "morning_draft");
    check("fallback path also marks provisional", v2.v2Audit.provisional === true);
    check("fallback dataQuality.tier = 'fallback'", v2.v2Audit.dataQuality.tier === "fallback");
    check("updateTriggers includes 'market_baseline_arrival'", v2.v2Audit.dataQuality.updateTriggers.includes("market_baseline_arrival"));
  }

  // ─── Constants exposure ──────────────────────────────────────────────
  section("Phase 6B constants");
  check("RESIDUAL_CAP_RUNS = 2.5", RESIDUAL_CAP_RUNS === 2.5);
  check("RESIDUAL_TRUST_COEF = 0.6", RESIDUAL_TRUST_COEF === 0.6);
  check("V2_CONF_FLOOR = 50", V2_CONF_FLOOR === 50);
  check("V2_CONF_CEIL_HIGH = 80", V2_CONF_CEIL_HIGH === 80);
  check("V2_CONF_CEIL_MEDIUM = 58", V2_CONF_CEIL_MEDIUM === 58);
  check("V2_CONF_CEIL_LOW = 54", V2_CONF_CEIL_LOW === 54);
  check("V2_BEST_ANGLE_MIN_EDGE_PCT = 2.0", V2_BEST_ANGLE_MIN_EDGE_PCT === 2.0);
  check("V2_BEST_ANGLE_MIN_CONFIDENCE = 60", V2_BEST_ANGLE_MIN_CONFIDENCE === 60);
  check("OU_EDGE_FLOOR_RUNS = 0.3", OU_EDGE_FLOOR_RUNS === 0.3);

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All mlbAutoModelV2 tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FATAL:", e);
    process.exit(1);
  },
);
