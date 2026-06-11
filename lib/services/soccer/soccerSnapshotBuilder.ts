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
  } = input;

  const bdlCount = oddsRows.filter((r) => r.provider === "bdl").length;
  const sharpCount = oddsRows.filter((r) => r.provider === "sharpapi").length;
  const expectedTotal = lambdaHome + lambdaAway;

  const noBet = holdDecision.hold;
  const noBetReason = holdDecision.hold ? `${holdDecision.code}: ${holdDecision.reason}` : null;

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
    },
  };
}
