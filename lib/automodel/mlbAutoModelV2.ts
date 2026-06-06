/**
 * Phase 6B — mlbAutoModelV2 (full-game) — provisional-aware revision.
 *
 * Principle: "Market as prior, not prison."
 * Refinement (Daniel, 2026-06-06 mid-day): missing starter or other
 * incomplete inputs do NOT mean "no prediction." They mean "produce a
 * provisional prediction using market baseline + available signals,
 * capped at a lower confidence ceiling, excluded from Best Angles by
 * default, and clearly labeled so the next cron pass can update it
 * automatically when the missing info arrives."
 *
 * Architecture:
 *   1. Compute MarketBaseline (computeMarketBaseline).
 *      - missing → fall back to V1 verbatim (no market anchor possible).
 *      - degraded → V2 still runs with lighter drag + provisional flag.
 *      - ok → full V2 path.
 *   2. Assess data quality (assessDataQuality). Returns:
 *        - tier: "high" | "medium" | "low" | "fallback"
 *        - missingInputs: human-readable list
 *        - updateTriggers: which arrivals would refresh the prediction
 *      Driven by snapshot (starters present? lineups confirmed?) and
 *      market/V1 state.
 *   3. Compute residuals from V1's per-team scores. If V1 produced null
 *      scores (very rare — V1 holds even score generation sometimes),
 *      V2 uses market-implied baseline directly (residual = 0). Either
 *      way, V2 always produces a numeric prediction when the market
 *      baseline is ok.
 *   4. Apply confidence cap from the data-quality tier. A high-tier
 *      game uses V2_CONF_CEIL_HIGH (80). A medium-tier game caps at
 *      V2_CONF_CEIL_MEDIUM (58). A low-tier game caps at
 *      V2_CONF_CEIL_LOW (54). Edge-based confidence still drives the
 *      number; the cap just constrains the ceiling.
 *   5. Compute Best Angle eligibility (assessBestAngle). Strict — all
 *      gates must pass:
 *        - baseline ok (not degraded, not fallback)
 *        - data quality tier === "high"
 *        - !provisional
 *        - edge magnitude ≥ V2_BEST_ANGLE_MIN_EDGE_PCT (2.0)
 *        - confidence ≥ V2_BEST_ANGLE_MIN_CONFIDENCE (60)
 *      Data-limited games are excluded from Best Angles by default,
 *      regardless of how strong the edge looks.
 *
 * First-inning (NRFI/YRFI):
 *   V2.0 still passes through V1 FI. NRFI/YRFI market lines are not in
 *   the snapshot (MarketSnapshot has no `nrfi_*` fields). Adding FI
 *   market-prior support requires three upstream changes documented in
 *   §"FI extension requirements" below. Out of scope for this patch.
 *
 * Pure module: no DB, no env reads, no Date.now(). All knobs are exported
 * constants so calibration can tune without code changes.
 */

import type { GameSnapshot, AutoModelOutput, ModelStage } from "./types";
import { computeMarketBaseline, type MarketBaseline } from "./marketPrior";

// ─── Tunable knobs ───────────────────────────────────────────────────────

export const RESIDUAL_CAP_RUNS = 2.5;
export const RESIDUAL_TRUST_COEF = 0.6;
export const EDGE_TO_CONFIDENCE_SLOPE = 300;
export const OU_EDGE_FLOOR_RUNS = 0.3;
export const DEGRADED_DATA_DRAG = 5;

/**
 * Confidence ceilings by data-quality tier. Mid-50s for missing one
 * starter; low-50s for missing both. High-tier uses the design-doc
 * baseline of 80.
 */
export const V2_CONF_FLOOR = 50;
export const V2_CONF_CEIL_HIGH = 80;
export const V2_CONF_CEIL_MEDIUM = 58;
export const V2_CONF_CEIL_LOW = 54;

/** Best Angle gates — all must pass. */
export const V2_BEST_ANGLE_MIN_EDGE_PCT = 2.0;
export const V2_BEST_ANGLE_MIN_CONFIDENCE = 60;

/** Backwards-compat alias for tests that imported the legacy names. */
export const V2_CONFIDENCE_FLOOR = V2_CONF_FLOOR;
export const V2_CONFIDENCE_CEIL = V2_CONF_CEIL_HIGH;

// ─── Output shapes ───────────────────────────────────────────────────────

export interface V2Output {
  game_external_id: number;
  prediction_source: "auto_v2_mlb_market_prior";
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null;
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  /** V2.0 preserves V1 FI verbatim (no market FI data ingested yet). */
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  v2Audit: V2Audit;
}

export interface V2Audit {
  marketBaseline: MarketBaseline;
  v1HomeScore: number | null;
  v1AwayScore: number | null;
  v1Total: number | null;
  v1MlPick: "home" | "away" | null;
  v1OuPick: "over" | "under" | null;
  homeResidualRaw: number | null;
  homeResidualApplied: number | null;
  awayResidualRaw: number | null;
  awayResidualApplied: number | null;
  capActiveHome: boolean;
  capActiveAway: boolean;
  edgePct: number | null;
  ouEdgeRuns: number | null;
  /** V1 fallback (market baseline was missing entirely). */
  fallback: boolean;
  fallbackReason: string | null;
  degradedDrag: number;
  /** Data-quality assessment driving the confidence cap. */
  dataQuality: DataQualityAssessment;
  /** Best Angle eligibility — strict; data-limited games excluded. */
  bestAngleEligibility: BestAngleEligibility;
  /** True when prediction is data-limited (missing starter / degraded / fallback). */
  provisional: boolean;
  notes: string[];
}

export interface DataQualityAssessment {
  score: number;
  tier: "high" | "medium" | "low" | "fallback";
  missingInputs: string[];
  updateTriggers: string[];
}

export interface BestAngleEligibility {
  eligible: boolean;
  reason: string;
  failedGates: string[];
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function runMlbAutoModelV2(
  snapshot: GameSnapshot,
  v1Output: AutoModelOutput,
  _stage: ModelStage,
): V2Output {
  const baseline = computeMarketBaseline(snapshot.market, snapshot.sharp);
  const notes: string[] = [];

  // FI always passes through V1 in V2.0.
  const fi: Pick<V2Output, "predicted_nrfi" | "nrfi_confidence"> = {
    predicted_nrfi: v1Output.predicted_nrfi,
    nrfi_confidence: v1Output.nrfi_confidence,
  };

  // ── Path 1: Market baseline missing → fallback to V1 verbatim. ──────
  if (baseline.dataQuality === "missing") {
    const dq: DataQualityAssessment = {
      score: 0,
      tier: "fallback",
      missingInputs: ["market_baseline"],
      updateTriggers: ["market_baseline_arrival"],
    };
    notes.push("Market baseline missing; V2 echoes V1 verbatim. Provisional + Best-Angle ineligible.");
    return {
      game_external_id: v1Output.game_external_id,
      prediction_source: "auto_v2_mlb_market_prior",
      predicted_home_score: v1Output.predicted_home_score,
      predicted_away_score: v1Output.predicted_away_score,
      predicted_total: v1Output.predicted_total,
      predicted_ml_winner: v1Output.predicted_ml_winner,
      ml_confidence: v1Output.ml_confidence,
      predicted_ou_side: v1Output.predicted_ou_side,
      ou_confidence: v1Output.ou_confidence,
      ...fi,
      v2Audit: {
        marketBaseline: baseline,
        v1HomeScore: v1Output.predicted_home_score,
        v1AwayScore: v1Output.predicted_away_score,
        v1Total: v1Output.predicted_total,
        v1MlPick: v1Output.predicted_ml_winner,
        v1OuPick: v1Output.predicted_ou_side,
        homeResidualRaw: null,
        homeResidualApplied: null,
        awayResidualRaw: null,
        awayResidualApplied: null,
        capActiveHome: false,
        capActiveAway: false,
        edgePct: null,
        ouEdgeRuns: null,
        fallback: true,
        fallbackReason: baseline.reason,
        degradedDrag: 0,
        dataQuality: dq,
        bestAngleEligibility: {
          eligible: false,
          reason: "Fallback to V1 (no market baseline available)",
          failedGates: ["v1_fallback"],
        },
        provisional: true,
        notes,
      },
    };
  }

  // ── Path 2: Market baseline ok or degraded → produce V2 prediction. ──
  const dq = assessDataQuality(snapshot, v1Output, baseline);

  const marketHome = baseline.homeImpliedTotal ?? 0;
  const marketAway = baseline.awayImpliedTotal ?? 0;

  // V1 may produce numeric scores even when ML/OU picks are held (V1
  // computes scores from league averages when a starter is null). When
  // V1 returns truly-null scores (rare), V2 uses market baseline as the
  // independent signal (residual = 0).
  const v1Home = v1Output.predicted_home_score;
  const v1Away = v1Output.predicted_away_score;
  let homeResRaw: number;
  let awayResRaw: number;
  if (v1Home !== null && v1Away !== null) {
    homeResRaw = v1Home - marketHome;
    awayResRaw = v1Away - marketAway;
  } else {
    homeResRaw = 0;
    awayResRaw = 0;
    notes.push("V1 returned null scores; V2 emits market-implied baseline directly (residual = 0).");
  }

  // Trust + clamp.
  const homeResScaled = homeResRaw * RESIDUAL_TRUST_COEF;
  const awayResScaled = awayResRaw * RESIDUAL_TRUST_COEF;
  const homeResApplied = clamp(homeResScaled, -RESIDUAL_CAP_RUNS, RESIDUAL_CAP_RUNS);
  const awayResApplied = clamp(awayResScaled, -RESIDUAL_CAP_RUNS, RESIDUAL_CAP_RUNS);
  const capActiveHome = Math.abs(homeResScaled) > RESIDUAL_CAP_RUNS;
  const capActiveAway = Math.abs(awayResScaled) > RESIDUAL_CAP_RUNS;
  if (capActiveHome) notes.push(`Cap active: home residual ${homeResScaled.toFixed(2)} clamped to ±${RESIDUAL_CAP_RUNS}.`);
  if (capActiveAway) notes.push(`Cap active: away residual ${awayResScaled.toFixed(2)} clamped to ±${RESIDUAL_CAP_RUNS}.`);

  const v2Home = round1(marketHome + homeResApplied);
  const v2Away = round1(marketAway + awayResApplied);
  const v2Total = round1(v2Home + v2Away);

  // ML pick.
  let v2MlPick: "home" | "away" | null = null;
  if (v2Home > v2Away) v2MlPick = "home";
  else if (v2Away > v2Home) v2MlPick = "away";

  // Confidence: edge-based with data-quality cap.
  const confCeil = confCeilForTier(dq.tier);
  let v2MlConf: number | null = null;
  let edgePct: number | null = null;
  if (v2MlPick !== null && baseline.homeNoVigProb !== null && v2Total > 0) {
    const v2HomeShare = v2Home / v2Total;
    const v2ImpliedHomeProb = clamp(((v2HomeShare - 0.5) / 0.30) + 0.5, 0.01, 0.99);
    const v2PickProb = v2MlPick === "home" ? v2ImpliedHomeProb : 1 - v2ImpliedHomeProb;
    const marketPickProb = v2MlPick === "home" ? baseline.homeNoVigProb : (1 - baseline.homeNoVigProb);
    const edge = v2PickProb - marketPickProb;
    edgePct = round1(edge * 100);
    const rawConf = V2_CONF_FLOOR + Math.max(0, edge) * EDGE_TO_CONFIDENCE_SLOPE;
    const dragged = rawConf - (baseline.dataQuality === "degraded" ? DEGRADED_DATA_DRAG : 0);
    v2MlConf = round1(clamp(dragged, V2_CONF_FLOOR, confCeil));
  }

  // O/U pick.
  let v2OuSide: "over" | "under" | null = null;
  let v2OuConf: number | null = null;
  let ouEdgeRuns: number | null = null;
  if (baseline.listedTotal !== null) {
    const totalDiff = v2Total - baseline.listedTotal;
    ouEdgeRuns = round1(totalDiff);
    if (Math.abs(totalDiff) >= OU_EDGE_FLOOR_RUNS) {
      v2OuSide = totalDiff > 0 ? "over" : "under";
      const ouConfRaw = V2_CONF_FLOOR + Math.abs(totalDiff) * 5;
      const dragged = ouConfRaw - (baseline.dataQuality === "degraded" ? DEGRADED_DATA_DRAG : 0);
      v2OuConf = round1(clamp(dragged, V2_CONF_FLOOR, confCeil));
    }
  }

  // Provisional flag: data quality not high, baseline degraded, or V1 had no scores.
  const provisional =
    dq.tier !== "high" ||
    baseline.dataQuality === "degraded" ||
    v1Home === null ||
    v1Away === null;
  if (provisional && dq.tier !== "fallback") {
    notes.push(`Provisional prediction — data quality tier=${dq.tier}; confidence capped at ${confCeil}.`);
  }

  // Best Angle eligibility — strict.
  const bestAngle = assessBestAngle({
    baselineQuality: baseline.dataQuality,
    dataQualityTier: dq.tier,
    provisional,
    fallback: false,
    edgePct,
    mlConfidence: v2MlConf,
  });

  return {
    game_external_id: v1Output.game_external_id,
    prediction_source: "auto_v2_mlb_market_prior",
    predicted_home_score: v2Home,
    predicted_away_score: v2Away,
    predicted_total: v2Total,
    predicted_ml_winner: v2MlPick,
    ml_confidence: v2MlConf,
    predicted_ou_side: v2OuSide,
    ou_confidence: v2OuConf,
    ...fi,
    v2Audit: {
      marketBaseline: baseline,
      v1HomeScore: v1Home,
      v1AwayScore: v1Away,
      v1Total: v1Output.predicted_total,
      v1MlPick: v1Output.predicted_ml_winner,
      v1OuPick: v1Output.predicted_ou_side,
      homeResidualRaw: round1(homeResRaw),
      homeResidualApplied: round1(homeResApplied),
      awayResidualRaw: round1(awayResRaw),
      awayResidualApplied: round1(awayResApplied),
      capActiveHome,
      capActiveAway,
      edgePct,
      ouEdgeRuns,
      fallback: false,
      fallbackReason: null,
      degradedDrag: baseline.dataQuality === "degraded" ? DEGRADED_DATA_DRAG : 0,
      dataQuality: dq,
      bestAngleEligibility: bestAngle,
      provisional,
      notes,
    },
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────

/**
 * Assess what data the snapshot is missing and what would trigger a
 * refresh on the next cron pass. Score is 0-100; tier is a coarse
 * grouping used to pick the confidence ceiling.
 *
 * Today's tier mapping:
 *   high   (score ≥ 85) — both starters present, lineups confirmed, market ok
 *   medium (score 55-84) — exactly one starter missing OR lineup unconfirmed
 *                          OR baseline degraded
 *   low    (score 25-54) — both starters missing
 *   fallback             — only when market baseline is missing entirely
 *                          (handled in Path 1, not here)
 */
function assessDataQuality(
  snapshot: GameSnapshot,
  _v1Output: AutoModelOutput,
  baseline: MarketBaseline,
): DataQualityAssessment {
  const missingInputs: string[] = [];
  const updateTriggers: string[] = [];

  const homeMissing = snapshot.home_starter === null;
  const awayMissing = snapshot.away_starter === null;
  if (homeMissing) {
    missingInputs.push("home_starter");
    updateTriggers.push("home_starter_arrival");
  }
  if (awayMissing) {
    missingInputs.push("away_starter");
    updateTriggers.push("away_starter_arrival");
  }
  if (!snapshot.data_quality.lineup_confirmed) {
    missingInputs.push("lineup_not_confirmed");
    updateTriggers.push("lineup_confirmation");
  }
  if (!snapshot.data_quality.season_stats_present) {
    missingInputs.push("season_stats_partial");
    updateTriggers.push("season_stats_refresh");
  }
  if (baseline.dataQuality === "degraded") {
    missingInputs.push("market_baseline_degraded");
    updateTriggers.push("market_lines_refresh");
  }

  // Score: start at 100, subtract per missing input.
  let score = 100;
  if (homeMissing) score -= 25;
  if (awayMissing) score -= 25;
  if (!snapshot.data_quality.lineup_confirmed) score -= 8;
  if (!snapshot.data_quality.season_stats_present) score -= 5;
  if (baseline.dataQuality === "degraded") score -= 15;
  score = Math.max(0, Math.min(100, score));

  let tier: DataQualityAssessment["tier"];
  if (score >= 85) tier = "high";
  else if (score >= 55) tier = "medium";
  else tier = "low";

  return { score, tier, missingInputs, updateTriggers };
}

function confCeilForTier(tier: DataQualityAssessment["tier"]): number {
  switch (tier) {
    case "high": return V2_CONF_CEIL_HIGH;
    case "medium": return V2_CONF_CEIL_MEDIUM;
    case "low": return V2_CONF_CEIL_LOW;
    case "fallback": return V2_CONF_CEIL_LOW;
  }
}

function assessBestAngle(opts: {
  baselineQuality: MarketBaseline["dataQuality"];
  dataQualityTier: DataQualityAssessment["tier"];
  provisional: boolean;
  fallback: boolean;
  edgePct: number | null;
  mlConfidence: number | null;
}): BestAngleEligibility {
  const failedGates: string[] = [];
  if (opts.fallback) failedGates.push("v1_fallback");
  if (opts.baselineQuality !== "ok") failedGates.push("baseline_not_ok");
  if (opts.dataQualityTier !== "high") failedGates.push("data_quality_below_high");
  if (opts.provisional) failedGates.push("provisional");
  if (opts.edgePct === null || Math.abs(opts.edgePct) < V2_BEST_ANGLE_MIN_EDGE_PCT) {
    failedGates.push(`edge_below_${V2_BEST_ANGLE_MIN_EDGE_PCT}pct`);
  }
  if (opts.mlConfidence === null || opts.mlConfidence < V2_BEST_ANGLE_MIN_CONFIDENCE) {
    failedGates.push(`confidence_below_${V2_BEST_ANGLE_MIN_CONFIDENCE}`);
  }
  if (failedGates.length === 0) {
    return { eligible: true, reason: "All Best Angle gates passed.", failedGates };
  }
  return {
    eligible: false,
    reason: `Best Angle gates failed: ${failedGates.join(", ")}`,
    failedGates,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── FI extension requirements (documentation only) ──────────────────────
//
// To extend Phase 6B's "market as prior" principle to first-inning
// (NRFI/YRFI/F5), three upstream changes are required (none implemented
// in this patch):
//
//   1. MarketSnapshot (lib/automodel/types.ts) gains optional fields:
//        - nrfi_listed_odds_american: number | null
//        - yrfi_listed_odds_american: number | null
//        - f5_listed_total: number | null
//        - f5_home_ml_odds_american: number | null
//        - f5_away_ml_odds_american: number | null
//      (or a structured nested type, e.g., `firstInning: { nrfi: {...}, f5: {...} }`)
//
//   2. featureSnapshot.ts gains a join on whichever table holds NRFI/F5
//      lines (today: `game_lines` only stores full-game; NRFI lines are
//      not yet ingested by linesService). Either extend `game_lines` to
//      include `market_type='nrfi'` rows, or stand up a parallel
//      `game_lines_first_inning` table.
//
//   3. lib/services/linesService.ts gains pass(es) that fetch NRFI/F5
//      lines from SharpAPI (`/opportunities/ev` carries them when
//      enabled). The current refresh fetches only full-game markets.
//
// Until #1-#3 land, FI/NRFI remains V1 verbatim in V2 — preserving the
// existing Phase 4D.1 5-zone NRFI logic. Once FI market is in the
// snapshot, V2 can apply the same market-prior + residual + cap pattern
// to FI: market-implied FI run share → expected FI runs → V1's NRFI
// computation as residual signal → confidence gated by data quality.
