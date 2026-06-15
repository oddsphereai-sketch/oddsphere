/**
 * Soccer auto-model V1 orchestrator — WC-3.
 *
 * Pure pipeline. No DB. No HTTP. Caller supplies:
 *   • the Elo prior table (loaded from CSV snapshot)
 *   • a NormalizedBdlMatch (fixture metadata + team names + country codes)
 *   • normalized BDL+SharpAPI odds rows for this fixture
 *   • splits status (from SharpApiSoccerOddsProvider.probeSplits)
 *   • reconciliation kind for this fixture
 *
 * Returns: model output + per-market decisions + snapshot blob per
 * tracked market.
 *
 * Binding contracts honored:
 *   • Raw model probabilities derived from team strength + Dixon-Coles
 *     ONLY. Market input never touches §4 outputs.
 *   • Double Chance derived from match_result. Total from joint
 *     distribution. BTTS from joint distribution.
 *   • Market data used only for edge, agreement, confidence reductions,
 *     and hold triggers. Never overwrites the pick.
 *   • Best Angle structurally locked off (calibration_evidence_level
 *     guard enforced inside soccerConfidenceGrade.ts).
 */

import { EXTERNAL_PRIORS_V1 } from "./_externalPriorsV1";
import { computeLambda, bivariatePoissonScoreDistribution, expectedTotalFromDistribution, medianTotalFromDistribution, mostLikelyTotalFromDistribution } from "./dixonColes";
import { deriveSoccerMarketProbabilities, type SoccerMarketProbabilities } from "./soccerMarketProbabilities";
import { buildMarketProbabilityBundle, computeEdges, selectBestValueSidePerMarket, type EdgeRow } from "./soccerMarketComparison";
import { deriveMarketImpliedLambdas } from "./marketImpliedLambda";
import { deriveSoccerGrade, type SoccerGradeDecision } from "./soccerConfidenceGrade";
import { deriveHold, type HoldDecision } from "./soccerHoldLogic";
import { buildSoccerSnapshot, type SoccerPredictionSnapshot } from "./soccerSnapshotBuilder";
import {
  reconcileSoccerTotal,
  type SoccerTotalReconciliation,
} from "./soccerTotalProjectionReconciliation";
import {
  reconcileSoccerMatchResult,
  type SoccerMatchResultReconciliation,
} from "./soccerMatchResultProjectionReconciliation";
import type { EloPriorTable } from "./eloPrior";
import type { NormalizedSoccerOddsRecord } from "@/lib/providers/real_api/_soccerMarketNormalizer";
import type { NormalizedBdlMatch } from "@/lib/providers/real_api/BallDontLieFifaProvider";
import type { ReconciliationKind } from "@/lib/providers/real_api/_soccerReconciler";
import type { SoccerSplitsStatus } from "@/lib/providers/real_api/SharpApiSoccerOddsProvider";

export const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1" as const;

/** What the writer needs per fixture to assemble prediction_records rows. */
export type SoccerFixtureModelOutput = {
  /** Echo of fixture identity for the writer. */
  bdlMatchId: number | null;
  sharpEventId: string | null;
  /** Raw model bundle (auditor reads from snapshot in production). */
  marketProbs: SoccerMarketProbabilities;
  lambdaHome: number;
  lambdaAway: number;
  /** Per-market decision + snapshot. */
  perMarket: Array<{
    market: SoccerGradeDecision["market"];
    pick: string;
    line: number | null;
    grade: SoccerGradeDecision;
    hold: HoldDecision;
    snapshot: SoccerPredictionSnapshot;
  }>;
  /** Single hold reason at the fixture level — non-null when ALL markets held. */
  fixtureHoldReason: string | null;
};

export type RunAutoModelOptions = {
  eloTable: EloPriorTable;
  match: NormalizedBdlMatch;
  oddsRows: ReadonlyArray<NormalizedSoccerOddsRecord>;
  /** WC-MODEL-7: opener odds (earliest line per book) for line-movement
   * awareness. Optional/backward-compatible — when absent, movement is not
   * evaluated and grading is unchanged. */
  openerOddsRows?: ReadonlyArray<NormalizedSoccerOddsRecord>;
  splitsStatus: SoccerSplitsStatus;
  reconciliation: ReconciliationKind;
  /** Total line we'll grade on. WC-1 canonical: 2.5. */
  totalLine?: number;
  /** Lock timestamp; defaults to "now". */
  lockedAt?: string;
  /** Market freshness window — how recent is the freshest provider row, in seconds. */
  marketFreshnessSeconds?: number | null;
  /** Pre-calibration publish whitelist: markets allowed to publish under external_priors_only. */
  preCalibrationPublishWhitelist?: ReadonlyArray<"match_result" | "double_chance" | "total" | "btts">;
  /** Optional venue altitude in meters (for Estadio Azteca altitude bonus). */
  venueAltitudeMeters?: number | null;
};

function lookupStrength(eloTable: EloPriorTable, countryCode: string, teamName: string) {
  const byCode = eloTable.lookupByCountryCode(countryCode);
  const row = byCode ?? eloTable.lookupByTeamName(teamName);
  if (row === null) return null;
  const z = eloTable.zScore(row.elo_rating);
  return {
    elo: row.elo_rating,
    z,
    att: z * EXTERNAL_PRIORS_V1.att_scale,
    def: z * EXTERNAL_PRIORS_V1.def_scale,
  };
}

function isHostTeam(countryCode: string): boolean {
  return (EXTERNAL_PRIORS_V1.host_countries as ReadonlyArray<string>).includes(countryCode.toUpperCase());
}

function isStaleByTimestamp(timestampIso: string, lockedAt: string, staleSeconds: number): boolean {
  const ts = Date.parse(timestampIso);
  const lock = Date.parse(lockedAt);
  if (!Number.isFinite(ts) || !Number.isFinite(lock)) return false;
  return Math.abs(lock - ts) / 1000 > staleSeconds;
}

/**
 * Per-provider MAIN total line picker (WC-MODEL-4).
 *
 * For each book, the "main" total is the line whose over/under prices are
 * closest to balanced (the line a book centers its market on) — NOT the
 * max or the median of every alt-ladder rung. The provider's main line is
 * the most common book main across all its books (mode; ties broken by the
 * median of the tied lines). Returns null when no book exposes a complete
 * two-sided total price.
 *
 * Exported for unit testing.
 */
export function pickProviderMainTotalLine(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
): number | null {
  // Collect decimal over/under prices per (book, line).
  const byBookLine = new Map<string, { over?: number; under?: number }>();
  for (const r of rows) {
    if (r.market !== "total" || r.line === null || r.sportsbook === null) continue;
    const dec =
      r.odds_decimal !== null && r.odds_decimal > 1
        ? r.odds_decimal
        : r.odds_american !== null
          ? r.odds_american > 0
            ? r.odds_american / 100 + 1
            : 100 / -r.odds_american + 1
          : null;
    if (dec === null || dec <= 1) continue;
    const key = `${r.sportsbook}::${r.line}`;
    const entry = byBookLine.get(key) ?? {};
    if (r.selection === "over") entry.over = dec;
    else if (r.selection === "under") entry.under = dec;
    byBookLine.set(key, entry);
  }
  // Per book, pick the line with the most balanced two-sided implied prices.
  const mainByBook = new Map<string, { line: number; imbalance: number }>();
  for (const [key, e] of byBookLine) {
    if (e.over === undefined || e.under === undefined) continue;
    const book = key.slice(0, key.lastIndexOf("::"));
    const line = Number(key.slice(key.lastIndexOf("::") + 2));
    if (!Number.isFinite(line)) continue;
    const imbalance = Math.abs(1 / e.over - 1 / e.under);
    const cur = mainByBook.get(book);
    if (cur === undefined || imbalance < cur.imbalance) {
      mainByBook.set(book, { line, imbalance });
    }
  }
  const mains = [...mainByBook.values()].map((m) => m.line);
  if (mains.length === 0) return null;
  // Mode of book main lines; ties → median of the tied lines.
  const counts = new Map<number, number>();
  for (const l of mains) counts.set(l, (counts.get(l) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, c]) => c === maxCount).map(([l]) => l).sort((a, b) => a - b);
  return tied[Math.floor(tied.length / 2)];
}

export function runSoccerAutoModelV1(opts: RunAutoModelOptions): SoccerFixtureModelOutput {
  const totalLine = opts.totalLine ?? 2.5;
  const lockedAt = opts.lockedAt ?? new Date().toISOString();
  const venueAdj =
    opts.venueAltitudeMeters !== null &&
    opts.venueAltitudeMeters !== undefined &&
    opts.venueAltitudeMeters >= EXTERNAL_PRIORS_V1.altitude_threshold_meters
      ? EXTERNAL_PRIORS_V1.altitude_goal_adjustment
      : 0;
  const preCalibrationWhitelist = opts.preCalibrationPublishWhitelist ?? [];

  // ─── 1. Team strength (Elo prior) — may be absent for some teams ──
  const homeStrength = lookupStrength(opts.eloTable, opts.match.home_team_country_code, opts.match.home_team_name);
  const awayStrength = lookupStrength(opts.eloTable, opts.match.away_team_country_code, opts.match.away_team_name);
  const eloPresent = homeStrength !== null && awayStrength !== null;

  // ─── 1b. De-vig market bundle + market-implied λ (calibrated prior) ─
  // WC Tier-0: the de-vigged market is the only per-fixture CALIBRATED
  // scoring source — invert it to per-team λ (separate attack/defense),
  // blend it ahead of the (conservative, symmetric) Elo λ, and use it as
  // the fallback when a team is missing from the Elo snapshot so a fixture
  // with odds NEVER silently vanishes.
  const bundle = buildMarketProbabilityBundle(opts.oddsRows, totalLine);
  const marketLambdas = deriveMarketImpliedLambdas({
    pHome: bundle.devig["match_result|home"] ?? null,
    pAway: bundle.devig["match_result|away"] ?? null,
    totalLine,
    tau: EXTERNAL_PRIORS_V1.tau,
  });

  // ─── 2. Host / venue adjustments (apply to the Elo-λ only) ────────
  const stadiumCountry = opts.match.stadium_country ?? "";
  const hostAdjHome = isHostTeam(opts.match.home_team_country_code) && stadiumCountry === opts.match.home_team_country_code
    ? EXTERNAL_PRIORS_V1.host_goal_adjustment
    : 0;
  const hostAdjAway = isHostTeam(opts.match.away_team_country_code) && stadiumCountry === opts.match.away_team_country_code
    ? EXTERNAL_PRIORS_V1.host_goal_adjustment
    : 0;
  // Neutral-venue safety: host bump only applies to the actual host at home;
  // every other (neutral) WC game gets 0 home advantage above.
  const venueAdjHome = venueAdj > 0 && opts.match.home_team_country_code.toUpperCase() === "MEX" ? venueAdj : 0;

  // ─── 3. Elo-model λ (only when BOTH teams have an Elo rating) ──────
  let eloLambdaHome: number | null = null;
  let eloLambdaAway: number | null = null;
  if (eloPresent) {
    eloLambdaHome = computeLambda({ att: homeStrength!.att, def: awayStrength!.def, alpha: EXTERNAL_PRIORS_V1.alpha, ownHostAdj: hostAdjHome, opposingHostAdj: hostAdjAway, venueAdj: venueAdjHome });
    eloLambdaAway = computeLambda({ att: awayStrength!.att, def: homeStrength!.def, alpha: EXTERNAL_PRIORS_V1.alpha, ownHostAdj: hostAdjAway, opposingHostAdj: hostAdjHome, venueAdj: 0 });
  }

  // ─── 4. Blend market + Elo (grounded but autonomous) / fallback / hold ─
  const wm = EXTERNAL_PRIORS_V1.market_lambda_blend_weight;
  const we = EXTERNAL_PRIORS_V1.elo_lambda_blend_weight;
  let lambdaHome: number;
  let lambdaAway: number;
  let ratingSource: "elo_market_blend" | "market_implied_fallback" | "elo_only";
  if (marketLambdas.ok && eloPresent) {
    lambdaHome = wm * marketLambdas.lambdaHome! + we * eloLambdaHome!;
    lambdaAway = wm * marketLambdas.lambdaAway! + we * eloLambdaAway!;
    ratingSource = "elo_market_blend";
  } else if (marketLambdas.ok) {
    // Missing-Elo (e.g. Haiti) → pure market-implied λ. Flagged + capped.
    lambdaHome = marketLambdas.lambdaHome!;
    lambdaAway = marketLambdas.lambdaAway!;
    ratingSource = "market_implied_fallback";
  } else if (eloPresent) {
    lambdaHome = eloLambdaHome!;
    lambdaAway = eloLambdaAway!;
    ratingSource = "elo_only";
  } else {
    // Neither Elo nor market — genuine hold WITH a reason (auditor-visible).
    const reason = `No usable strength source: Elo missing (home=${homeStrength === null ? opts.match.home_team_name : "ok"}, away=${awayStrength === null ? opts.match.away_team_name : "ok"}) AND no market-implied λ (${marketLambdas.reason}).`;
    return buildHeldFixtureOutput(opts, totalLine, lockedAt, reason);
  }
  const isMarketFallback = ratingSource === "market_implied_fallback";

  // Dominant-favorite goal compounding (see EXTERNAL_PRIORS_V1.mismatch_boost_*).
  // The linear blend under-predicts the total in extreme mismatches; add a
  // convex boost to the favorite's λ once the projected gap is large. Normal
  // games (gap below threshold) are untouched; skipped for the market-implied
  // fallback (the market already prices the total there).
  if (!isMarketFallback) {
    const lamGap = Math.abs(lambdaHome - lambdaAway);
    if (lamGap > EXTERNAL_PRIORS_V1.mismatch_boost_gap_threshold) {
      const boost = Math.min(
        EXTERNAL_PRIORS_V1.mismatch_boost_max,
        EXTERNAL_PRIORS_V1.mismatch_boost_k * (lamGap - EXTERNAL_PRIORS_V1.mismatch_boost_gap_threshold),
      );
      if (lambdaHome >= lambdaAway) lambdaHome += boost;
      else lambdaAway += boost;
    }
  }

  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, EXTERNAL_PRIORS_V1.tau);

  // ─── 5. Market probabilities (model-only, no market input) ───────
  const marketProbs = deriveSoccerMarketProbabilities({ joint, totalLine });

  // ─── 6. Market comparison (de-vig + edge) — bundle built above ────
  // WC-MODEL-7: opener consensus for line-movement awareness. When provided,
  // we compare each pick's de-vigged market probability NOW vs at open; a
  // pick the market has steadily moved against gets a confidence haircut.
  const openerBundle =
    opts.openerOddsRows !== undefined && opts.openerOddsRows.length > 0
      ? buildMarketProbabilityBundle(opts.openerOddsRows, totalLine)
      : null;
  const devigKeyFor = (mkt: string, sel: string): string =>
    mkt === "total" ? `total|${sel}|${totalLine}` : `${mkt}|${sel}`;
  // WC-MODEL-9 (2026-06-13). BTTS is derived from the SAME score distribution as
  // match-result and total — coherent with the projection. Earlier it carried an
  // extra 60%-market blend to damp a Poisson BTTS over-prediction, but that was a
  // symptom of the un-scaled model (att/def 0.12); with the calibrated 0.28 scale
  // the joint BTTS is sensible (e.g. SCO@HAI Haiti 0.76 xG → ~53% to score →
  // BTTS-No ~53%, which is correct). Double-grounding it to the market (once via
  // the λ blend, again here) made BTTS inconsistent with the other markets. Now
  // it's the raw projection BTTS; computeEdges grades it vs the de-vigged market
  // like every other market, and the ladder's ceiling catches any genuine
  // over-prediction.
  const edges = computeEdges({
    modelMatchResult: marketProbs.match_result,
    modelDoubleChance: marketProbs.double_chance,
    modelTotal: marketProbs.total,
    modelBtts: marketProbs.btts,
    marketBundle: bundle,
  });

  // Pre-compute provider-state flags shared across markets.
  const bdlRows = opts.oddsRows.filter((r) => r.provider === "bdl");
  const sharpRows = opts.oddsRows.filter((r) => r.provider === "sharpapi");
  const isSingleSource = bdlRows.length === 0 || sharpRows.length === 0;
  const staleSecs = EXTERNAL_PRIORS_V1.hold_thresholds.stale_seconds;
  const bothStaleSecs = EXTERNAL_PRIORS_V1.hold_thresholds.both_providers_stale_seconds;
  const bdlNewest = bdlRows.reduce((acc, r) => Math.max(acc, Date.parse(r.fetched_at) || 0), 0);
  const sharpNewest = sharpRows.reduce((acc, r) => Math.max(acc, Date.parse(r.fetched_at) || 0), 0);
  const isStaleMarket =
    (bdlRows.length > 0 && isStaleByTimestamp(new Date(bdlNewest).toISOString(), lockedAt, staleSecs)) ||
    (sharpRows.length > 0 && isStaleByTimestamp(new Date(sharpNewest).toISOString(), lockedAt, staleSecs));
  const bothProvidersStale =
    bdlRows.length > 0 &&
    sharpRows.length > 0 &&
    isStaleByTimestamp(new Date(bdlNewest).toISOString(), lockedAt, bothStaleSecs) &&
    isStaleByTimestamp(new Date(sharpNewest).toISOString(), lockedAt, bothStaleSecs);

  // Diverging total lines between providers.
  //
  // WC-MODEL-4 (2026-06-12) — interim fix to the previous comparator.
  //
  // The original implementation compared `Math.max(...bdlTotalLines)`
  // against `Math.max(...sharpTotalLines)`. For books that publish an
  // alt-totals ladder (e.g. 2.5 / 3.0 / 3.5), the max captures the
  // alt-ladder tail rather than the main line. A book with only 2.5
  // and a book with 2.5, 3.0, 3.5 would have looked divergent (3.5
  // vs 2.5 → diverge=true) even though both books' MAIN total is 2.5.
  //
  // WC-MODEL-4 (2026-06-12) — real per-book MAIN-LINE picker, replacing the
  // median-of-distinct-lines interim. The old comparator deduped to distinct
  // lines and took the median, so a book with a deep alt-ladder (2.5 → 4.5)
  // looked divergent vs a book carrying a thin slice even when BOTH books'
  // MAIN total was 2.5. Now: for each book, the main line is the one whose
  // over/under pricing is closest to balanced (the de-vig-neutral line a
  // book actually centers on); the provider main line is the most common
  // book main (mode; ties → median); compare main vs main.
  const bdlMain = pickProviderMainTotalLine(bdlRows);
  const sharpMain = pickProviderMainTotalLine(sharpRows);
  const totalLinesDiverge =
    bdlMain !== null && sharpMain !== null && Math.abs(bdlMain - sharpMain) >= 1.0;

  // ─── 6. Per-market decisions ─────────────────────────────────────
  const argmaxPickByMarket = new Map<string, EdgeRow>();
  for (const e of edges) {
    const existing = argmaxPickByMarket.get(e.market);
    if (existing === undefined || e.model_p > existing.model_p) argmaxPickByMarket.set(e.market, e);
  }
  // WC-MODEL-2 (2026-06-12) — compute value side per market alongside
  // the existing model side. The value side is argmax(edge_pp) per
  // market, skipping rows with null edge. This does NOT change the
  // displayed pick (which remains the model_side). It is used in the
  // hold-logic to detect (model_side, value_side) disagreement and
  // clamp the grade ladder. Customer-facing rule (Daniel, 2026-06-12):
  // "Do not publish disagreement as an actionable pick."
  const valueSideByMarket = new Map<string, EdgeRow>();
  for (const row of selectBestValueSidePerMarket(edges)) {
    valueSideByMarket.set(row.market, row);
  }

  const perMarket: SoccerFixtureModelOutput["perMarket"] = [];
  for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
    const best = argmaxPickByMarket.get(market);
    if (best === undefined) continue;

    const edge_pp = best.edge_pp;
    const isFarFromMarket = edge_pp !== null && Math.abs(edge_pp) > EXTERNAL_PRIORS_V1.edge_thresholds.far_from_market_hard_hold;
    const marketOddsMissing = (bundle.book_counts[market] ?? 0) === 0;

    // Short-price DC guardrail: triggered when implied market prob > 0.82.
    const dcImpliedKey = `double_chance|${best.selection}`;
    const dcMarketImpliedP = bundle.implied[dcImpliedKey] ?? null;
    const isShortPriceDc = market === "double_chance" && dcMarketImpliedP !== null && dcMarketImpliedP > 0.82;

    // WC-MODEL-2/3 (2026-06-12) — side policy inputs.
    //
    // model_side: argmax(model_probability) within market. Already in
    //   `best.selection`, but we name it explicitly so the snapshot
    //   reads cleanly.
    // value_side: argmax(edge_pp) within market — pulled from the
    //   precomputed valueSideByMarket map. Will be undefined when no
    //   row in the market has a non-null edge (e.g. market odds
    //   missing on every selection).
    // mean_direction_side: only meaningful for totals. expected_total
    //   = λ_home + λ_away; compare against the listed total line.
    //   null when the totals are exactly at the line (vanishingly rare
    //   in practice).
    const modelSide = best.selection;
    const valueSide = valueSideByMarket.get(market)?.selection;
    const expectedTotal = lambdaHome + lambdaAway;
    const meanDirectionSide: "over" | "under" | null = market === "total"
      ? (expectedTotal > totalLine ? "over" : expectedTotal < totalLine ? "under" : null)
      : null;

    const holdCtx = {
      market,
      market_odds_missing: marketOddsMissing,
      reconciliation: opts.reconciliation,
      has_unresolved_placeholder: false,
      both_providers_stale: bothProvidersStale,
      total_lines_diverge: totalLinesDiverge,
      splits_falsely_claimed: false,
      splits_status: opts.splitsStatus.status,
      edge_pp,
      is_far_from_market_hard: edge_pp !== null && Math.abs(edge_pp) > EXTERNAL_PRIORS_V1.edge_thresholds.far_from_market_hard_hold,
      predicted_total: expectedTotal,
      listed_total_line: market === "total" ? totalLine : null,
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      joint,
      calibration_evidence_level: EXTERNAL_PRIORS_V1.calibration_evidence_level,
      pre_calibration_publish_whitelist: preCalibrationWhitelist,
      model_side: modelSide,
      value_side: valueSide,
      mean_direction_side: meanDirectionSide,
    } as const;
    const hold = deriveHold(holdCtx);
    // Pass 2: soft caps from hold-logic clamp the grade ladder. They
    // only fire on the non-hold branch and never elevate a grade.
    const softCapsFromHold = hold.hold === false ? hold.soft_caps ?? [] : [];

    // ─── WC totals: projection / side reconciliation ─────────────────
    //
    // 2026-06-12 — direct port of the MLB v1 contract (see
    // lib/services/soccer/soccerTotalProjectionReconciliation.ts).
    // Holistic weighted vote across mean / probability / value /
    // market-pressure decides the customer-facing side. V1 market
    // pressure is null because WC sharp_signals are empty_as_of_probe.
    // When the holistic vote disagrees with mean direction the side
    // reverts to mean direction and the grade caps to no_play (the
    // coherence guard).
    //
    // For totals where reconciled side differs from best.selection
    // (the model's argmax-prob pick), we substitute the reconciled
    // side into the snapshot pick + look up its edge row so the
    // grade derivation sees the reconciled side's probability and
    // edge, not the original argmax side's.
    let totalReconciliation: SoccerTotalReconciliation | null = null;
    let bestForGrading = best;
    let edgePpForGrading = edge_pp;
    let softCapsCombined = softCapsFromHold;
    if (market === "total") {
      const overRow = edges.find((e) => e.market === "total" && e.selection === "over");
      const underRow = edges.find((e) => e.market === "total" && e.selection === "under");
      // Dixon-Coles raw P(over) at canonical line — pulled from the
      // marketProbs (model layer), NOT the edge row's model_p which is
      // already side-specific.
      const rawProbabilityOver = marketProbs.total.over;
      // No-vig market P(over). The edge bundle's devig has these per
      // selection key; we read off the canonical line.
      const marketImpliedOver = bundle.devig[`total|over|${totalLine}`] ?? null;
      totalReconciliation = reconcileSoccerTotal({
        rawProjectedAwayGoals: lambdaAway,
        rawProjectedHomeGoals: lambdaHome,
        rawProjectedTotal: expectedTotal,
        marketTotal: totalLine,
        rawProbabilityOver,
        marketImpliedOver,
        // Descriptive distribution stats from the SAME joint — shown next to
        // the mean so the right-skew is explained on the card. Do not drive
        // the side (the side follows raw_probability_side).
        medianTotal: medianTotalFromDistribution(joint),
        mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
        // V1: market_pressure is null — WC sharp_signals are
        // empty_as_of_probe per project-wc-launch-contract.
        marketPressureSide: null,
        // Lock state — same convention as MLB. The snapshot writer
        // exposes locked_at; in V1 we treat the row as unlocked at
        // model-run time because the orchestrator runs pre-lock.
        // The pregame-sweep lock invariant is enforced at persistence
        // time by the writer (it skips locked side/total fields).
        isLocked: false,
        lockedReconciliation: null,
      });
      // Substitute the reconciled side's edge row so the grade
      // derivation operates on the displayed side's statistics.
      const reconciledRow = totalReconciliation.reconciled_total_side === "over" ? overRow : underRow;
      if (reconciledRow !== undefined) {
        bestForGrading = reconciledRow;
        edgePpForGrading = reconciledRow.edge_pp;
      }
      // Translate reconciliation grade_cap into a soft cap so the
      // grade ladder is correctly clamped. The reconciler's "no_play"
      // is the strongest soft cap available in the WC grade ladder
      // (we map no_play → Caution; the verdict layer + confidence
      // floor surface the No Play state when conviction is below the
      // playable floor).
      if (hold.hold === false && totalReconciliation.grade_cap !== null) {
        const cap_at = totalReconciliation.grade_cap === "watchlist" ? "Watchlist" : "Caution";
        softCapsCombined = [
          ...softCapsCombined,
          {
            code: `total_projection_reconciliation_${totalReconciliation.grade_cap}`,
            cap_at,
            reason:
              `Totals reconciliation cap: ${totalReconciliation.side_selection_reason}. ` +
              `displayed_side=${totalReconciliation.displayed_total_side}; ` +
              `reconciled_confidence=${totalReconciliation.reconciled_confidence_pct}%.`,
          },
        ];
      }
    }

    // ─── WC match_result: projection / pick reconciliation ───────────
    //
    // 2026-06-14 (Daniel) — sibling of the totals reconciliation above,
    // applying the SAME score↔pick coherence invariant to the 3-way
    // market. The displayed match_result pick follows the projected
    // scoreline (margin draw-band → DRAW in the group stage; the
    // projected favorite in knockout), never an argmax-prob flip that
    // contradicts the projected score. See
    // soccerMatchResultProjectionReconciliation.ts. This is what finally
    // lets the model "call a draw" on an even group-stage projection.
    let matchResultReconciliation: SoccerMatchResultReconciliation | null = null;
    if (market === "match_result") {
      // drawPickable = group stage. Mirror the seeder's stage mapping
      // (deriveSeasonType): null or "group…" → group → draws callable;
      // any knockout stage name → no bare draw pick.
      const stageName = opts.match.stage_name;
      const drawPickable = stageName === null || stageName.toLowerCase().includes("group");
      matchResultReconciliation = reconcileSoccerMatchResult({
        lambdaHome,
        lambdaAway,
        modelHome: marketProbs.match_result.home,
        modelDraw: marketProbs.match_result.draw,
        modelAway: marketProbs.match_result.away,
        marketHome: bundle.devig["match_result|home"] ?? null,
        marketDraw: bundle.devig["match_result|draw"] ?? null,
        marketAway: bundle.devig["match_result|away"] ?? null,
        drawPickable,
        // Locked rows are preserved by the writer (skips locked pick
        // fields), same convention as totals — run unlocked here.
        isLocked: false,
        lockedReconciliation: null,
      });
      const reconciledRow = edges.find(
        (e) => e.market === "match_result" && e.selection === matchResultReconciliation!.reconciled_outcome,
      );
      if (reconciledRow !== undefined) {
        bestForGrading = reconciledRow;
        edgePpForGrading = reconciledRow.edge_pp;
      }
      if (hold.hold === false && matchResultReconciliation.grade_cap !== null) {
        const cap_at = matchResultReconciliation.grade_cap === "watchlist" ? "Watchlist" : "Caution";
        softCapsCombined = [
          ...softCapsCombined,
          {
            code: `match_result_projection_reconciliation_${matchResultReconciliation.grade_cap}`,
            cap_at,
            reason:
              `Match-result reconciliation cap: ${matchResultReconciliation.selection_reason}. ` +
              `displayed=${matchResultReconciliation.displayed_outcome}; ` +
              `confidence=${matchResultReconciliation.reconciled_confidence_pct}%.`,
          },
        ];
      }
    }

    const lambdaMin = Math.min(lambdaHome, lambdaAway);
    // WC-MODEL-5: is the Match Result pick the MARKET FAVORITE? (highest
    // de-vigged implied prob among home/draw/away, excluding the draw).
    // Selects the lower favorite edge ladder; everything else (draw,
    // longshot, non-MR) uses the higher bar. Defaults false when market
    // data is absent (conservative).
    const isMatchFavorite = ((): boolean => {
      if (market !== "match_result") return false;
      const sel = bestForGrading.selection;
      if (sel === "draw") return false;
      const picked = bundle.devig[`match_result|${sel}`] ?? null;
      if (picked === null) return false;
      const sides = ["home", "draw", "away"]
        .map((s) => bundle.devig[`match_result|${s}`] ?? null)
        .filter((x): x is number => x !== null);
      return sides.every((o) => picked >= o);
    })();
    // WC-MODEL-7: did the market move AGAINST this pick since open? Compare
    // the pick's de-vigged market prob now vs at open. A drop ≥ threshold
    // means the market has steadily soured on our side → confidence haircut.
    const movePickKey = devigKeyFor(market, bestForGrading.selection);
    const curDevig = bundle.devig[movePickKey] ?? null;
    const openDevig = openerBundle?.devig[movePickKey] ?? null;
    const lineMovePp = curDevig !== null && openDevig !== null ? (curDevig - openDevig) * 100 : null;
    const marketMovingAgainst =
      lineMovePp !== null && lineMovePp <= -EXTERNAL_PRIORS_V1.hold_thresholds.line_move_against_pp;
    const grade = deriveSoccerGrade({
      market,
      selection: bestForGrading.selection,
      model_p: bestForGrading.model_p,
      edge_pp: edgePpForGrading,
      model_market_agreement: bestForGrading.model_market_agreement,
      ctx: {
        calibration_evidence_level: EXTERNAL_PRIORS_V1.calibration_evidence_level,
        market_supports_pick: false, // EV substrate not consulted at launch
        is_stale_market: isStaleMarket,
        is_single_source: isSingleSource,
        is_far_from_market: isFarFromMarket,
        is_short_price_dc: isShortPriceDc,
        short_price_dc_market_implied_p: dcMarketImpliedP,
        splits_provider_error: opts.splitsStatus.status === "error",
        is_draw_pick: market === "match_result" && bestForGrading.selection === "draw",
        lambda_total: lambdaHome + lambdaAway,
        is_btts_yes_pick: market === "btts" && best.selection === "yes",
        lambda_min: lambdaMin,
        is_match_favorite: isMatchFavorite,
        market_moving_against_pick: marketMovingAgainst,
      },
      soft_caps: softCapsCombined,
    });

    const snapshot = buildSoccerSnapshot({
      marketProbs,
      oddsRows: opts.oddsRows,
      splitsStatus: opts.splitsStatus,
      reconciliationKind: opts.reconciliation,
      bdlMatchId: opts.match.provider_match_id,
      sharpEventId: null,
      gradeDecision: grade,
      holdDecision: hold,
      eloMeta: opts.eloTable.meta,
      homeTeamStrength: homeStrength,
      awayTeamStrength: awayStrength,
      ratingSource,
      hostAdjHome,
      hostAdjAway,
      venueAdj: venueAdjHome,
      lambdaHome,
      lambdaAway,
      marketFreshnessSeconds: opts.marketFreshnessSeconds ?? null,
      marketImplied: bundle.implied,
      marketDevig: bundle.devig,
      marketEdgePp: Object.fromEntries(edges.map((e) => {
        const sel = e.market === "total" ? `${e.market}|${e.selection}|${totalLine}` : `${e.market}|${e.selection}`;
        return [sel, e.edge_pp];
      })),
      marketBookCounts: bundle.book_counts,
      isStalePregamePrice: isStaleMarket,
      isFarFromMarket,
      calibrationVersion: EXTERNAL_PRIORS_V1.calibration_version,
      calibrationSource: EXTERNAL_PRIORS_V1.calibration_source,
      calibrationEvidenceLevel: EXTERNAL_PRIORS_V1.calibration_evidence_level,
      modelVersion: SOCCER_MODEL_VERSION,
      lockedAt,
      totalLine,
      modelSide,
      valueSide: valueSide ?? null,
      meanDirectionSide,
      totalReconciliation,
      matchResultReconciliation,
    });

    // For totals: the customer-facing pick is the reconciled side.
    // For all other markets: bestForGrading === best (unchanged).
    perMarket.push({
      market,
      pick: bestForGrading.selection,
      line: market === "total" ? totalLine : null,
      grade,
      hold,
      snapshot,
    });
  }

  return {
    bdlMatchId: opts.match.provider_match_id,
    sharpEventId: null,
    marketProbs,
    lambdaHome,
    lambdaAway,
    perMarket,
    fixtureHoldReason: perMarket.every((p) => p.hold.hold) ? "all_markets_held" : null,
  };
}

function buildHeldFixtureOutput(
  opts: RunAutoModelOptions,
  totalLine: number,
  lockedAt: string,
  reason: string,
): SoccerFixtureModelOutput {
  return {
    bdlMatchId: opts.match.provider_match_id,
    sharpEventId: null,
    marketProbs: {
      match_result: { home: 0, draw: 0, away: 0 },
      double_chance: { home_or_draw: 0, away_or_draw: 0, home_or_away: 0 },
      total: { line: totalLine, over: 0, under: 0, push: 0 },
      btts: { yes: 0, no: 0 },
    },
    lambdaHome: 0,
    lambdaAway: 0,
    perMarket: [],
    fixtureHoldReason: reason,
  };
}
