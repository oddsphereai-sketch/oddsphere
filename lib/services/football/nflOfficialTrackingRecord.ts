import { computeSlateDate } from "@/lib/dates/slateDate";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "./nflForwardEvidence";
import {
  assertMarketScopedFootballDecisions,
  FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE,
} from "./footballMarketScopedTracking";

export const NFL_OFFICIAL_TRACKING_RECORD_RELEASE =
  "nfl_official_tracking_record_2026_09_03_r5_target_excluded_forecast" as const;

export function buildNflOfficialTrackingRecords(args: {
  payload: NflForwardEvidencePayload;
  gameId: number;
}): PredictionRecordRow[] {
  if (!args.payload.decisions.trackingEnabled || args.payload.stage !== "t60") {
    throw new Error("NFL tracking records require an eligible T-60 evidence payload.");
  }
  const externalId = integerId(args.payload.game.providerGameId, "game");
  assertMarketScopedFootballDecisions(
    args.payload.decisions.evaluatedBets,
    `NFL tracking for ${externalId}`,
  );
  return args.payload.decisions.evaluatedBets.map((decision): PredictionRecordRow => {
    const side = canonicalSide(args.payload, decision.market, decision.side);
    const actionable = decision.grade === "Best Angle" || decision.grade === "Lean";
    const playGrade = decision.grade.toLowerCase().replace(/\s+/g, "_");
    return {
      game_prediction_id: null,
      game_id: args.gameId,
      external_id: externalId,
      sport: "nfl",
      slate_date: computeSlateDate("nfl", args.payload.game.scheduledStart),
      game_date: args.payload.game.scheduledStart,
      matchup: `${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation}`,
      market: decision.market,
      pick: decision.side,
      side,
      line_value: decision.market === "moneyline" ? null : decision.evaluatedQuote.line,
      odds_american: decision.evaluatedQuote.price,
      odds_decimal: americanToDecimal(decision.evaluatedQuote.price),
      model_used: decision.modelRelease,
      model_version: decision.decisionRelease,
      prediction_source: "nfl_forward_evidence_t60",
      confidence: decision.modelProbability * 100,
      model_probability: decision.modelProbability,
      market_probability: decision.marketFairProbability,
      edge: (decision.modelProbability - decision.marketFairProbability) * 100,
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
        football_market_scoped_tracking_release: FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE,
        nfl_tracking_record_release: NFL_OFFICIAL_TRACKING_RECORD_RELEASE,
        evidence_release: args.payload.schemaRelease,
        evidence_payload_sha256: hashNflForwardEvidencePayload(args.payload),
        evidence_run_id: args.payload.runId,
        season: args.payload.season,
        week: args.payload.week,
        stage: args.payload.stage,
        t60_lag_minutes: args.payload.t60LagMinutes,
        decision_tuple: decision,
        outcome_confidence: args.payload.decisions.outcomeConfidence,
        operational_opening: args.payload.market.operationalOpening,
        current_books_at_lock: args.payload.market.currentBooks,
        comparable_books_at_lock: args.payload.market.comparableCurrentBooks,
        quarterback_status_at_lock: {
          away: args.payload.startersAndDepth.away.starterStatus,
          home: args.payload.startersAndDepth.home.starterStatus,
        },
        coverage_at_lock: args.payload.coverage,
      },
      calibration_version: decision.calibrationRelease,
    };
  });
}

export function nflProviderIntegerId(value: string, label: string): number {
  return integerId(value, label);
}

function canonicalSide(
  payload: NflForwardEvidencePayload,
  market: "moneyline" | "spread" | "total",
  side: string,
): "home" | "away" | "over" | "under" {
  if (market === "total") {
    if (/^over\b/i.test(side)) return "over";
    if (/^under\b/i.test(side)) return "under";
    throw new Error(`NFL total side is not canonical: ${side}.`);
  }
  const selected = side.trim().split(/\s+/)[0]?.toUpperCase();
  if (selected === payload.game.home.abbreviation) return "home";
  if (selected === payload.game.away.abbreviation) return "away";
  throw new Error(`NFL ${market} side does not match either team: ${side}.`);
}

function americanToDecimal(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function integerId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`NFL ${label} provider id is invalid: ${value}.`);
  return parsed;
}
