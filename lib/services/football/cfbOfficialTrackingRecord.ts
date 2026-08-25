import { computeSlateDate } from "@/lib/dates/slateDate";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { hashCfbForwardEvidencePayload, type CfbForwardEvidencePayload } from "./cfbForwardEvidence";

export const CFB_OFFICIAL_TRACKING_RECORD_RELEASE =
  "cfb_official_tracking_record_2026_08_25_r1_t60" as const;

export function buildCfbOfficialTrackingRecords(args: { payload: CfbForwardEvidencePayload; gameId: number }): PredictionRecordRow[] {
  if (!args.payload.decisions.trackingEnabled || args.payload.stage !== "t60") throw new Error("CFB tracking records require an eligible T-60 evidence payload.");
  if (args.payload.decisions.evaluatedBets.length !== 3) throw new Error("CFB tracking requires three complete exact-price markets.");
  const externalId = providerIntegerId(args.payload.game.providerGameId, "game");
  return args.payload.decisions.evaluatedBets.map((decision): PredictionRecordRow => {
    const actionable = decision.grade === "Best Angle" || decision.grade === "Lean";
    const playGrade = decision.grade.toLowerCase().replace(/\s+/g, "_");
    return {
      game_prediction_id: null,
      game_id: args.gameId,
      external_id: externalId,
      sport: "cfb",
      slate_date: computeSlateDate("cfb", args.payload.game.scheduledStart),
      game_date: args.payload.game.scheduledStart,
      matchup: `${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation}`,
      market: decision.market,
      pick: decision.side,
      side: canonicalSide(args.payload, decision.market, decision.side),
      line_value: decision.market === "moneyline" ? null : decision.evaluatedQuote.line,
      odds_american: decision.evaluatedQuote.price,
      odds_decimal: decision.evaluatedQuote.price > 0 ? 1 + decision.evaluatedQuote.price / 100 : 1 + 100 / Math.abs(decision.evaluatedQuote.price),
      model_used: decision.modelRelease,
      model_version: decision.decisionRelease,
      prediction_source: "cfb_forward_evidence_t60",
      confidence: decision.modelProbability * 100,
      model_probability: decision.modelProbability,
      market_probability: decision.marketFairProbability,
      edge: decision.edgePercentagePoints,
      expected_value: decision.expectedValue,
      play_grade: playGrade,
      prediction_type: decision.market,
      best_angle: decision.grade === "Best Angle",
      no_bet: !actionable,
      no_bet_reason: actionable ? null : `grade_${playGrade}`,
      market_aligned: Math.abs(decision.modelProbability - decision.marketFairProbability) <= 0.03,
      data_quality_tier: "high",
      source_quality: "named_book_target_excluded_multibook_consensus",
      provisional: false,
      held: false,
      hold_reason: null,
      launch_day: false,
      manual_outcome_expected: false,
      locked_at: decision.lockedAt,
      published_at: decision.evaluatedAt,
      snapshot_json: {
        cfb_tracking_record_release: CFB_OFFICIAL_TRACKING_RECORD_RELEASE,
        evidence_release: args.payload.schemaRelease,
        evidence_payload_sha256: hashCfbForwardEvidencePayload(args.payload),
        evidence_run_id: args.payload.runId,
        season: args.payload.season,
        week: args.payload.week,
        stage: args.payload.stage,
        t60_lag_minutes: args.payload.t60LagMinutes,
        decision_tuple: decision,
        forecast: args.payload.decisions.forecast,
        operational_opening: args.payload.market.operationalOpening,
        current_books_at_lock: args.payload.market.currentBooks,
        quarterback_context_at_lock: args.payload.quarterbacks,
        coverage_at_lock: args.payload.coverage,
      },
      calibration_version: decision.calibrationRelease,
    };
  });
}

export function cfbProviderIntegerId(value: string, label: string): number { return providerIntegerId(value, label); }

function canonicalSide(payload: CfbForwardEvidencePayload, market: "moneyline" | "spread" | "total", side: string): "home" | "away" | "over" | "under" {
  if (market === "total") {
    if (/^over\b/i.test(side)) return "over";
    if (/^under\b/i.test(side)) return "under";
  } else {
    const selected = side.trim().split(/\s+/)[0]?.toUpperCase();
    if (selected === payload.game.home.abbreviation) return "home";
    if (selected === payload.game.away.abbreviation) return "away";
  }
  throw new Error(`CFB ${market} side does not match the game: ${side}.`);
}

function providerIntegerId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`CFB ${label} provider id is invalid: ${value}.`);
  return parsed;
}
