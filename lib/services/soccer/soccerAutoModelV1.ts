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
import { computeLambda, bivariatePoissonScoreDistribution, expectedTotalFromDistribution } from "./dixonColes";
import { deriveSoccerMarketProbabilities, type SoccerMarketProbabilities } from "./soccerMarketProbabilities";
import { buildMarketProbabilityBundle, computeEdges, selectBestValueSidePerMarket, type EdgeRow } from "./soccerMarketComparison";
import { deriveSoccerGrade, type SoccerGradeDecision } from "./soccerConfidenceGrade";
import { deriveHold, type HoldDecision } from "./soccerHoldLogic";
import { buildSoccerSnapshot, type SoccerPredictionSnapshot } from "./soccerSnapshotBuilder";
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

  // ─── 1. Team strength lookup ─────────────────────────────────────
  const homeStrength = lookupStrength(opts.eloTable, opts.match.home_team_country_code, opts.match.home_team_name);
  const awayStrength = lookupStrength(opts.eloTable, opts.match.away_team_country_code, opts.match.away_team_name);

  if (homeStrength === null || awayStrength === null) {
    // Hold every market on this fixture — no source-backed prior.
    const reason = `Team strength missing from Elo snapshot: home=${homeStrength === null ? opts.match.home_team_name : "ok"} away=${awayStrength === null ? opts.match.away_team_name : "ok"}`;
    return buildHeldFixtureOutput(opts, totalLine, lockedAt, reason);
  }

  // ─── 2. Host / venue adjustments ─────────────────────────────────
  // We only apply host_goal_adjustment when the team is a host AND the
  // venue country matches their country.
  const stadiumCountry = opts.match.stadium_country ?? "";
  const hostAdjHome = isHostTeam(opts.match.home_team_country_code) && stadiumCountry === opts.match.home_team_country_code
    ? EXTERNAL_PRIORS_V1.host_goal_adjustment
    : 0;
  const hostAdjAway = isHostTeam(opts.match.away_team_country_code) && stadiumCountry === opts.match.away_team_country_code
    ? EXTERNAL_PRIORS_V1.host_goal_adjustment
    : 0;
  // Altitude bonus only applies when Mexico is the home team at Azteca.
  const venueAdjHome = venueAdj > 0 && opts.match.home_team_country_code.toUpperCase() === "MEX" ? venueAdj : 0;

  // ─── 3. Lambdas + score distribution ─────────────────────────────
  const lambdaHome = computeLambda({
    att: homeStrength.att,
    def: awayStrength.def,
    alpha: EXTERNAL_PRIORS_V1.alpha,
    ownHostAdj: hostAdjHome,
    opposingHostAdj: hostAdjAway,
    venueAdj: venueAdjHome,
  });
  const lambdaAway = computeLambda({
    att: awayStrength.att,
    def: homeStrength.def,
    alpha: EXTERNAL_PRIORS_V1.alpha,
    ownHostAdj: hostAdjAway,
    opposingHostAdj: hostAdjHome,
    venueAdj: 0,
  });
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, EXTERNAL_PRIORS_V1.tau);

  // ─── 4. Market probabilities (model-only, no market input) ───────
  const marketProbs = deriveSoccerMarketProbabilities({ joint, totalLine });

  // ─── 5. Market comparison (de-vig + edge) ────────────────────────
  const bundle = buildMarketProbabilityBundle(opts.oddsRows, totalLine);
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
  // Interim fix below: compare the MEDIAN of distinct lines per
  // provider instead of the max. Median is robust to the alt-ladder
  // tail because adding lines at either end pulls the median less.
  //
  // The full main-line picker (per-book main line, closest to
  // balanced -110/-110 pricing) is scoped as a follow-up PR — see
  // expert's WC-MODEL-4 specification: prefer pair closest to
  // balanced no-vig, prefer most common line across books, compare
  // median main line per provider.
  const bdlTotalLines = new Set(bdlRows.filter((r) => r.market === "total" && r.line !== null).map((r) => r.line as number));
  const sharpTotalLines = new Set(sharpRows.filter((r) => r.market === "total" && r.line !== null).map((r) => r.line as number));
  function medianOf(values: ReadonlyArray<number>): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  const totalLinesDiverge = bdlTotalLines.size > 0 && sharpTotalLines.size > 0 && (() => {
    const bdlMed = medianOf([...bdlTotalLines]);
    const sharpMed = medianOf([...sharpTotalLines]);
    return Math.abs(bdlMed - sharpMed) >= 1.0;
  })();

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

    const lambdaMin = Math.min(lambdaHome, lambdaAway);
    const grade = deriveSoccerGrade({
      market,
      selection: best.selection,
      model_p: best.model_p,
      edge_pp,
      model_market_agreement: best.model_market_agreement,
      ctx: {
        calibration_evidence_level: EXTERNAL_PRIORS_V1.calibration_evidence_level,
        market_supports_pick: false, // EV substrate not consulted at launch
        is_stale_market: isStaleMarket,
        is_single_source: isSingleSource,
        is_far_from_market: isFarFromMarket,
        is_short_price_dc: isShortPriceDc,
        short_price_dc_market_implied_p: dcMarketImpliedP,
        splits_provider_error: opts.splitsStatus.status === "error",
        is_draw_pick: market === "match_result" && best.selection === "draw",
        lambda_total: lambdaHome + lambdaAway,
        is_btts_yes_pick: market === "btts" && best.selection === "yes",
        lambda_min: lambdaMin,
      },
      soft_caps: softCapsFromHold,
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
    });

    perMarket.push({
      market,
      pick: best.selection,
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
