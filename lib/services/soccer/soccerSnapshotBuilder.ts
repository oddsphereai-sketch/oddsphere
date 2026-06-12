/**
 * Snapshot / provenance builder for soccer predictions — WC-3 pure.
 *
 * Pure. No DB. No HTTP. Assembles the JSON blob written into
 * `prediction_records.snapshot_json` per project-wc-model-standard §6 and
 * the WC-3 design report §8.
 *
 * One snapshot per (fixture, market) decision. Auditor (WC-5) reads
 * these fields to answer the §7 binding questions in
 * project-wc-model-standard.
 */

import type {
  SoccerMarketProbabilities,
} from "./soccerMarketProbabilities";
import type { SoccerGradeDecision, ConfidenceReduction } from "./soccerConfidenceGrade";
import type { HoldDecision } from "./soccerHoldLogic";
import type { SoccerTotalReconciliation } from "./soccerTotalProjectionReconciliation";
import type { ReconciliationKind } from "@/lib/providers/real_api/_soccerReconciler";
import type { SoccerSplitsStatus } from "@/lib/providers/real_api/SharpApiSoccerOddsProvider";
import type { NormalizedSoccerOddsRecord } from "@/lib/providers/real_api/_soccerMarketNormalizer";
import type { EloSnapshotMeta } from "./eloPrior";

export type SoccerPredictionSnapshot = {
  /** Stable identifiers. */
  model_version: string;
  calibration_version: string;
  calibration_source: string;
  calibration_evidence_level: string;
  regulation_window: "regulation_90";
  locked_at: string;

  /** Model layer — raw probabilities + parameters. NO market influence. */
  model: {
    elo_snapshot: EloSnapshotMeta;
    team_strength: {
      home: { elo: number; z: number; att: number; def: number };
      away: { elo: number; z: number; att: number; def: number };
    };
    host_adjustment: { home: number; away: number };
    venue_adjustment: number;
    lambda_home: number;
    lambda_away: number;
    expected_total: number;
    raw_probabilities: {
      match_result: { home: number; draw: number; away: number };
      double_chance: { home_or_draw: number; away_or_draw: number; home_or_away: number };
      total_at_canonical: { line: number; over: number; under: number; push: number };
      btts: { yes: number; no: number };
    };
  };

  /** Market layer — separate from model. NEVER displayed as "model %". */
  market: {
    bdl_input_count: number;
    sharpapi_input_count: number;
    implied_probabilities: Record<string, number>;
    devigged_probabilities: Record<string, number>;
    edge_pp: Record<string, number | null>;
    book_counts: Record<string, number>;
    main_line_only: boolean;
    market_freshness_seconds: number | null;
    is_stale_pregame_price: boolean;
    model_market_agreement: boolean;
    model_far_from_market: boolean;
  };

  /** Splits binding contract per WC-2. */
  splits: SoccerSplitsStatus & { snapshot_rows: number | null };

  /** Reconciliation kind from the BDL ↔ SharpAPI reconciler. */
  reconciliation: { kind: ReconciliationKind; bdl_match_id: number | null; sharp_event_id: string | null };

  /** Decision derived for the market being predicted. */
  decision: {
    market: SoccerGradeDecision["market"];
    pick: string;
    confidence: number;
    confidence_cap_default: number;
    confidence_cap_effective: number;
    confidence_reductions: ConfidenceReduction[];
    grade: SoccerGradeDecision["grade"];
    best_angle: boolean;
    no_bet: boolean;
    no_bet_reason: string | null;
    market_data_changed_grade_or_confidence: boolean;
    market_data_changed_pick: boolean;
    market_data_was_display_only: boolean;
    uses_split_derived_claim: boolean;
    /**
     * WC-MODEL-2/3 (2026-06-12) — side-policy provenance.
     *
     *   model_side:    argmax(model_probability) within the market.
     *                  Equals `pick` in production today (the customer
     *                  pick is the model side per the approved policy).
     *   value_side:    argmax(edge_pp) within the market. null when no
     *                  selection in the market has a non-null edge.
     *   displayed_side: the side actually rendered in the card. Equals
     *                  model_side under the Option-1 policy ("do not
     *                  publish disagreement as an actionable pick" —
     *                  disagreement clamps the grade, never the pick).
     *   side_selection_reason: short stable code describing why the
     *                  displayed_side equals model_side; "agreement"
     *                  when model_side == value_side, "model_only"
     *                  when value_side is null, and
     *                  "disagree_keep_model" when they differ.
     *   mean_direction_side: for totals only — the direction implied by
     *                  E[total]=λ_H+λ_A vs. the listed line. null for
     *                  non-totals and for totals when E[total] == line.
     *   side_disagree_flags: stable codes carried alongside the soft
     *                  caps for auditor + UI reads.
     */
    model_side: string;
    value_side: string | null;
    displayed_side: string;
    side_selection_reason: "agreement" | "model_only" | "disagree_keep_model";
    mean_direction_side: "over" | "under" | null;
    side_disagree_flags: ReadonlyArray<string>;
    /**
     * 2026-06-12 — WC totals projection / side reconciliation blob.
     * Present ONLY on the `total` market row. NULL on Match Result /
     * Double Chance / BTTS rows (those markets don't have a
     * projection-vs-line coherence invariant). Same shape as the MLB
     * blob — see
     * lib/services/soccer/soccerTotalProjectionReconciliation.ts.
     */
    total_projection_reconciliation: SoccerTotalReconciliation | null;
  };
};

export type BuildSnapshotInput = {
  /** Per-market output from the auto-model. */
  marketProbs: SoccerMarketProbabilities;
  /** Raw provider inputs (already normalized). */
  oddsRows: ReadonlyArray<NormalizedSoccerOddsRecord>;
  /** Splits status as returned by SharpApiSoccerOddsProvider.probeSplits. */
  splitsStatus: SoccerSplitsStatus;
  /** Reconciliation kind for this fixture. */
  reconciliationKind: ReconciliationKind;
  bdlMatchId: number | null;
  sharpEventId: string | null;
  /** Decision for this snapshot row. */
  gradeDecision: SoccerGradeDecision;
  /** Hold decision (may be {hold:false}). */
  holdDecision: HoldDecision;
  /** Elo snapshot metadata. */
  eloMeta: EloSnapshotMeta;
  /** Team-strength inputs. */
  homeTeamStrength: { elo: number; z: number; att: number; def: number };
  awayTeamStrength: { elo: number; z: number; att: number; def: number };
  /** Adjustments. */
  hostAdjHome: number;
  hostAdjAway: number;
  venueAdj: number;
  /** Lambdas. */
  lambdaHome: number;
  lambdaAway: number;
  /** Market freshness (seconds since latest provider timestamp). */
  marketFreshnessSeconds: number | null;
  /** Implied + devig + edge bundle from soccerMarketComparison. */
  marketImplied: Record<string, number>;
  marketDevig: Record<string, number>;
  marketEdgePp: Record<string, number | null>;
  marketBookCounts: Record<string, number>;
  isStalePregamePrice: boolean;
  isFarFromMarket: boolean;
  /** Constants from EXTERNAL_PRIORS_V1. */
  calibrationVersion: string;
  calibrationSource: string;
  calibrationEvidenceLevel: string;
  modelVersion: string;
  /** Lock time. */
  lockedAt: string;
  /** Total line used. */
  totalLine: number;
  /**
   * WC-MODEL-2/3 (2026-06-12) — side-policy provenance carried from
   * the orchestrator. See the SoccerPredictionSnapshot.decision doc
   * comment for definitions. modelSide always set. valueSide null
   * when no row in the market has a non-null edge. meanDirectionSide
   * null for non-totals and for totals when E[total] equals the line.
   */
  modelSide: string;
  valueSide: string | null;
  meanDirectionSide: "over" | "under" | null;
  /**
   * 2026-06-12 — totals reconciliation blob from the orchestrator
   * (null for Match Result / DC / BTTS rows). When present on a
   * totals row, drives the `displayed_side` and is persisted into
   * the decision substructure.
   */
  totalReconciliation: SoccerTotalReconciliation | null;
};

export function buildSoccerSnapshot(input: BuildSnapshotInput): SoccerPredictionSnapshot {
  const {
    marketProbs,
    oddsRows,
    splitsStatus,
    reconciliationKind,
    bdlMatchId,
    sharpEventId,
    gradeDecision,
    holdDecision,
    eloMeta,
    homeTeamStrength,
    awayTeamStrength,
    hostAdjHome,
    hostAdjAway,
    venueAdj,
    lambdaHome,
    lambdaAway,
    marketImplied,
    marketDevig,
    marketEdgePp,
    marketBookCounts,
    isStalePregamePrice,
    isFarFromMarket,
    marketFreshnessSeconds,
    calibrationVersion,
    calibrationSource,
    calibrationEvidenceLevel,
    modelVersion,
    lockedAt,
    totalLine,
    modelSide,
    valueSide,
    meanDirectionSide,
    totalReconciliation,
  } = input;

  const bdlCount = oddsRows.filter((r) => r.provider === "bdl").length;
  const sharpCount = oddsRows.filter((r) => r.provider === "sharpapi").length;
  const expectedTotal = lambdaHome + lambdaAway;

  const noBet = holdDecision.hold;
  const noBetReason = holdDecision.hold ? `${holdDecision.code}: ${holdDecision.reason}` : null;

  // WC-MODEL-2 (2026-06-12) — derive side-selection reason.
  //   • value_side === null   → "model_only" (no edge data for any selection)
  //   • model_side == value_side → "agreement"
  //   • otherwise             → "disagree_keep_model"  (Option-1 policy)
  // The displayed_side ALWAYS equals model_side under the Option-1
  // contract: disagreement is reflected in the grade ladder (soft cap
  // to Watchlist) rather than by swapping the pick.
  const sideSelectionReason: "agreement" | "model_only" | "disagree_keep_model" =
    valueSide === null ? "model_only" : valueSide === modelSide ? "agreement" : "disagree_keep_model";
  const displayedSide = modelSide;
  const sideDisagreeFlags: string[] = [];
  if (holdDecision.hold === false && holdDecision.soft_caps !== undefined) {
    for (const cap of holdDecision.soft_caps) {
      if (
        cap.code === "model_value_side_disagree" ||
        cap.code === "model_side_negative_edge" ||
        cap.code === "total_mean_probability_split"
      ) {
        sideDisagreeFlags.push(cap.code);
      }
    }
  }
  if (holdDecision.hold === true && holdDecision.code === "TOTAL_DIRECTION_CONFLICT") {
    sideDisagreeFlags.push("total_direction_conflict_hold");
  }

  return {
    model_version: modelVersion,
    calibration_version: calibrationVersion,
    calibration_source: calibrationSource,
    calibration_evidence_level: calibrationEvidenceLevel,
    regulation_window: "regulation_90",
    locked_at: lockedAt,
    model: {
      elo_snapshot: eloMeta,
      team_strength: { home: homeTeamStrength, away: awayTeamStrength },
      host_adjustment: { home: hostAdjHome, away: hostAdjAway },
      venue_adjustment: venueAdj,
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      expected_total: expectedTotal,
      raw_probabilities: {
        match_result: marketProbs.match_result,
        double_chance: marketProbs.double_chance,
        total_at_canonical: { line: totalLine, over: marketProbs.total.over, under: marketProbs.total.under, push: marketProbs.total.push },
        btts: marketProbs.btts,
      },
    },
    market: {
      bdl_input_count: bdlCount,
      sharpapi_input_count: sharpCount,
      implied_probabilities: marketImplied,
      devigged_probabilities: marketDevig,
      edge_pp: marketEdgePp,
      book_counts: marketBookCounts,
      main_line_only: true,
      market_freshness_seconds: marketFreshnessSeconds,
      is_stale_pregame_price: isStalePregamePrice,
      model_market_agreement: gradeDecision.model_market_agreement,
      model_far_from_market: isFarFromMarket,
    },
    splits: { ...splitsStatus, snapshot_rows: splitsStatus.row_count > 0 ? splitsStatus.row_count : null },
    reconciliation: { kind: reconciliationKind, bdl_match_id: bdlMatchId, sharp_event_id: sharpEventId },
    decision: {
      market: gradeDecision.market,
      pick: gradeDecision.selection,
      confidence: gradeDecision.confidence,
      confidence_cap_default: gradeDecision.confidence_cap_default,
      confidence_cap_effective: gradeDecision.confidence_cap_effective,
      confidence_reductions: gradeDecision.confidence_reductions,
      grade: gradeDecision.grade,
      best_angle: gradeDecision.best_angle,
      no_bet: noBet,
      no_bet_reason: noBetReason,
      market_data_changed_grade_or_confidence: gradeDecision.confidence_reductions.length > 0 || gradeDecision.model_market_agreement,
      market_data_changed_pick: false,
      market_data_was_display_only: !gradeDecision.model_market_agreement,
      uses_split_derived_claim: false,
      model_side: modelSide,
      value_side: valueSide,
      displayed_side: totalReconciliation !== null
        ? totalReconciliation.displayed_total_side
        : displayedSide,
      side_selection_reason: sideSelectionReason,
      mean_direction_side: meanDirectionSide,
      side_disagree_flags: sideDisagreeFlags,
      total_projection_reconciliation: totalReconciliation,
    },
  };
}
