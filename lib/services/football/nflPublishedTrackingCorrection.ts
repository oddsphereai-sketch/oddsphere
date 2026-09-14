import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "./nflForwardEvidence";
import { selectNflPredictionOwnedMoneylineEvaluation } from "./nflV1ProductionDecision";

export const NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE =
  "nfl_published_tracking_correction_2026_09_14_r1_prediction_owned_side" as const;
export const NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION =
  "nfl_tracking_prediction_side_correction_2026_09_14_r1" as const;

export type NflPublishedTrackingCorrectionMarker = {
  release: typeof NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE;
  supersedes_prediction_record_id: number;
  evidence_payload_sha256: string;
  outcome_blind: true;
  reason: "tracked_moneyline_side_differed_from_immutable_published_prediction";
};

export function nflTrackingCorrectionSupersededRecordId(args: {
  modelVersion?: string | null;
  correctionRelease?: unknown;
  supersedesPredictionRecordId?: unknown;
}): number | null {
  if (
    args.modelVersion !== NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION ||
    args.correctionRelease !== NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE ||
    typeof args.supersedesPredictionRecordId !== "number" ||
    !Number.isInteger(args.supersedesPredictionRecordId) ||
    args.supersedesPredictionRecordId < 1
  ) {
    return null;
  }
  return args.supersedesPredictionRecordId;
}

export function buildNflPublishedMoneylineTrackingCorrection(args: {
  source: PredictionRecordRow;
  payload: NflForwardEvidencePayload;
}): PredictionRecordRow {
  const sourceId = args.source.id;
  if (sourceId === undefined || args.source.sport !== "nfl" || args.source.market !== "moneyline") {
    throw new Error("NFL published tracking correction requires one persisted NFL moneyline record.");
  }
  if (args.source.locked_at === null || args.payload.stage !== "t60") {
    throw new Error(`NFL tracking record ${sourceId} is not backed by an immutable T-60 lock.`);
  }
  const evidenceSha256 = hashNflForwardEvidencePayload(args.payload);
  if (args.source.snapshot_json?.evidence_payload_sha256 !== evidenceSha256) {
    throw new Error(`NFL tracking record ${sourceId} evidence checksum does not match its stored reference.`);
  }
  const home = args.payload.outcomeForecast.homeWinProbability >= args.payload.outcomeForecast.awayWinProbability;
  const side = home ? "home" as const : "away" as const;
  const pick = home ? args.payload.game.home.abbreviation : args.payload.game.away.abbreviation;
  const modelProbability = home
    ? args.payload.outcomeForecast.homeWinProbability
    : args.payload.outcomeForecast.awayWinProbability;
  if (args.source.side === side && args.source.pick === pick) {
    throw new Error(`NFL tracking record ${sourceId} already matches the immutable published prediction.`);
  }
  const evaluation = selectNflPredictionOwnedMoneylineEvaluation({
    books: args.payload.market.comparableCurrentBooks,
    home,
    modelProbability,
    gameStartsAt: args.payload.game.scheduledStart,
  });
  if (evaluation === null) {
    throw new Error(`NFL tracking record ${sourceId} has no exact prediction-side T-60 moneyline tuple.`);
  }
  const playGrade = evaluation.grade.toLowerCase().replace(/\s+/g, "_");
  const actionable = evaluation.grade === "Lean";
  const originalTuple = args.source.snapshot_json?.decision_tuple;
  const tuple = originalTuple && typeof originalTuple === "object" && !Array.isArray(originalTuple)
    ? originalTuple as Record<string, unknown>
    : {};
  const correction: NflPublishedTrackingCorrectionMarker = {
    release: NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE,
    supersedes_prediction_record_id: sourceId,
    evidence_payload_sha256: evidenceSha256,
    outcome_blind: true,
    reason: "tracked_moneyline_side_differed_from_immutable_published_prediction",
  };
  return {
    game_prediction_id: args.source.game_prediction_id,
    game_id: args.source.game_id,
    external_id: args.source.external_id,
    sport: "nfl",
    slate_date: args.source.slate_date,
    game_date: args.source.game_date,
    matchup: args.source.matchup,
    market: "moneyline",
    pick,
    side,
    line_value: null,
    odds_american: evaluation.quote.price,
    odds_decimal: evaluation.quote.price > 0
      ? 1 + evaluation.quote.price / 100
      : 1 + 100 / Math.abs(evaluation.quote.price),
    model_used: args.source.model_used,
    model_version: NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION,
    prediction_source: "nfl_immutable_t60_published_side_correction",
    confidence: modelProbability * 100,
    model_probability: modelProbability,
    market_probability: evaluation.looFairProbability,
    edge: evaluation.edgePercentagePoints,
    expected_value: evaluation.expectedValue,
    play_grade: playGrade,
    prediction_type: "moneyline",
    best_angle: false,
    no_bet: !actionable,
    no_bet_reason: actionable ? null : `grade_${playGrade}`,
    market_aligned: Math.abs(modelProbability - evaluation.looFairProbability) <= 0.03,
    data_quality_tier: "high",
    source_quality: "immutable_t60_evidence_checksum_verified",
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: args.source.locked_at,
    published_at: args.source.published_at,
    snapshot_json: {
      ...(args.source.snapshot_json ?? {}),
      nfl_tracking_record_release: NFL_PUBLISHED_TRACKING_CORRECTION_RELEASE,
      decision_tuple: {
        ...tuple,
        side: pick,
        modelProbability,
        marketFairProbability: evaluation.looFairProbability,
        evaluatedQuote: evaluation.quote,
        expectedValue: evaluation.expectedValue,
        grade: evaluation.grade,
        decisionRelease: NFL_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION,
      },
      tracking_correction: correction,
      tracking_correction_release: correction.release,
      supersedes_prediction_record_id: correction.supersedes_prediction_record_id,
    },
    calibration_version: args.source.calibration_version,
  };
}
