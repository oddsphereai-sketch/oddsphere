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
import {
  NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  NFL_V1_PRODUCTION_DECISION_RELEASE,
} from "./nflV1ProductionDecision";
import type { NflRegularDecisionMarket, NflRegularOutcomeConfidence } from "./nflRegularDecisionEvidence";

export const NFL_OFFICIAL_TRACKING_RECORD_RELEASE =
  "nfl_official_tracking_record_2026_09_04_r6_complete_prediction_denominators" as const;

const NFL_TRACKED_MARKETS = ["moneyline", "spread", "total"] as const;

export function nflTrackingMarketsForPayload(payload: NflForwardEvidencePayload): NflRegularDecisionMarket[] {
  const markets = new Set<NflRegularDecisionMarket>(payload.decisions.evaluatedBets.map((decision) => decision.market));
  for (const forecast of payload.decisions.outcomeConfidence) {
    if (forecast.likelySide.trim().length > 0 && referenceLine(payload, forecast.market) !== undefined) {
      markets.add(forecast.market);
    }
  }
  return NFL_TRACKED_MARKETS.filter((market) => markets.has(market));
}

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
  const evaluated = args.payload.decisions.evaluatedBets.map((decision): PredictionRecordRow => {
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
  const evaluatedMarkets = new Set(evaluated.map((record) => record.market));
  const held = args.payload.decisions.outcomeConfidence.flatMap((forecast) => {
    if (evaluatedMarkets.has(forecast.market)) return [];
    const line = referenceLine(args.payload, forecast.market);
    if (line === undefined) return [];
    return [buildHeldForecastRecord({ payload: args.payload, gameId: args.gameId, externalId, forecast, line })];
  });
  return [...evaluated, ...held].sort((a, b) =>
    NFL_TRACKED_MARKETS.indexOf(a.market as NflRegularDecisionMarket) - NFL_TRACKED_MARKETS.indexOf(b.market as NflRegularDecisionMarket));
}

function buildHeldForecastRecord(args: {
  payload: NflForwardEvidencePayload;
  gameId: number;
  externalId: number;
  forecast: NflRegularOutcomeConfidence;
  line: number | null;
}): PredictionRecordRow {
  const side = canonicalSide(args.payload, args.forecast.market, args.forecast.likelySide);
  const team = side === "home" ? args.payload.game.home.abbreviation : args.payload.game.away.abbreviation;
  const pick = args.forecast.market === "moneyline"
    ? team
    : args.forecast.market === "spread"
      ? `${team} ${formatLine(args.line!)}`
      : `${side === "over" ? "Over" : "Under"} ${args.line}`;
  return {
    game_prediction_id: null,
    game_id: args.gameId,
    external_id: args.externalId,
    sport: "nfl",
    slate_date: computeSlateDate("nfl", args.payload.game.scheduledStart),
    game_date: args.payload.game.scheduledStart,
    matchup: `${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation}`,
    market: args.forecast.market,
    pick,
    side,
    line_value: args.forecast.market === "moneyline" ? null : args.line,
    odds_american: null,
    odds_decimal: null,
    model_used: args.forecast.modelRelease,
    model_version: NFL_V1_PRODUCTION_DECISION_RELEASE,
    prediction_source: "nfl_forward_evidence_t60_held_forecast",
    confidence: args.forecast.probability * 100,
    model_probability: args.forecast.probability,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: "no_play",
    prediction_type: args.forecast.market,
    best_angle: false,
    no_bet: true,
    no_bet_reason: "exact_price_market_unavailable",
    market_aligned: false,
    data_quality_tier: "held",
    source_quality: "model_forecast_without_exact_price",
    provisional: false,
    held: true,
    hold_reason: "Exact-price market unavailable at T-60",
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: args.payload.capturedAt,
    published_at: args.payload.capturedAt,
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
      forecast_outlook: args.forecast,
      outcome_forecast: args.payload.outcomeForecast,
      operational_opening: args.payload.market.operationalOpening,
      current_books_at_lock: args.payload.market.currentBooks,
      comparable_books_at_lock: args.payload.market.comparableCurrentBooks,
      coverage_at_lock: args.payload.coverage,
    },
    calibration_version: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  };
}

function referenceLine(payload: NflForwardEvidencePayload, market: NflRegularDecisionMarket): number | null | undefined {
  if (market === "moneyline") return null;
  if (market === "total") return payload.market.current.total?.line;
  const selected = payload.decisions.outcomeConfidence.find((forecast) => forecast.market === market)?.likelySide
    .trim().split(/\s+/)[0]?.toUpperCase();
  if (selected === payload.game.home.abbreviation.toUpperCase()) return payload.market.current.spread?.homeLine;
  if (selected === payload.game.away.abbreviation.toUpperCase()) return payload.market.current.spread?.awayLine;
  return undefined;
}

function formatLine(value: number): string {
  return value > 0 ? `+${value}` : String(value);
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
