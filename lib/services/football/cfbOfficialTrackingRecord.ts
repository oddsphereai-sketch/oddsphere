import { computeSlateDate } from "@/lib/dates/slateDate";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  hashCfbForwardEvidencePayload,
  type CfbForwardEvidencePayload,
} from "./cfbForwardEvidence";
import {
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  CFB_V1_CALIBRATION_RELEASE,
  CFB_V1_DECISION_RELEASE,
  type CfbV1Market,
} from "./cfbV1Decision";
import { CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE } from "./cfbMarketSharpAwareShadow";
import { assertMarketScopedFootballDecisions, FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE } from "./footballMarketScopedTracking";

export const CFB_OFFICIAL_TRACKING_RECORD_RELEASE =
  "cfb_official_tracking_record_2026_09_04_r17_holistic_confidence" as const;

export function cfbTrackingMarketsForPayload(payload: CfbForwardEvidencePayload): CfbV1Market[] {
  const markets = new Set<CfbV1Market>(payload.decisions.evaluatedBets.map((decision) => decision.market));
  for (const heldMarket of payload.decisions.heldMarkets) {
    const outlook = payload.decisions.marketOutlooks?.[heldMarket.market] ?? null;
    if (outlook && (heldMarket.market === "moneyline" || outlook.line !== null)) markets.add(heldMarket.market);
  }
  return (["moneyline", "spread", "total"] as const).filter((market) => markets.has(market));
}
export function buildCfbOfficialTrackingRecords(args: { payload: CfbForwardEvidencePayload; gameId: number }): PredictionRecordRow[] {
  assertCfbTrackingPayload(args.payload);
  assertMarketScopedFootballDecisions(args.payload.decisions.evaluatedBets, "CFB tracking");
  const externalId = providerIntegerId(args.payload.game.providerGameId, "game");
  const evaluated = args.payload.decisions.evaluatedBets.map((decision): PredictionRecordRow => {
    const predictiveActionable = decision.grade === "Best Angle" || decision.grade === "Lean";
    const actionable = predictiveActionable && decision.expectedValue >= 0;
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
      best_angle: decision.grade === "Best Angle" && actionable,
      no_bet: !actionable,
      no_bet_reason: actionable ? null : predictiveActionable
        ? "displayed_quote_negative_expected_value_shop"
        : `grade_${playGrade}`,
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
        independent_forecast: args.payload.independentForecast,
        authoritative_forecast: args.payload.authoritativeForecast,
        operational_opening: args.payload.market.operationalOpening,
        current_books_at_lock: args.payload.market.currentBooks,
        quarterback_context_at_lock: args.payload.quarterbacks,
        coverage_at_lock: args.payload.coverage,
      },
      calibration_version: decision.calibrationRelease,
    };
  });
  const evaluatedMarkets = new Set(evaluated.map((record) => record.market));
  const held = args.payload.decisions.heldMarkets.flatMap((heldMarket) => {
    if (evaluatedMarkets.has(heldMarket.market)) return [];
    const outlook = args.payload.decisions.marketOutlooks?.[heldMarket.market] ?? null;
    if (!outlook || (heldMarket.market !== "moneyline" && outlook.line === null)) return [];
    return [buildHeldForecastRecord({
      payload: args.payload,
      gameId: args.gameId,
      externalId,
      market: heldMarket.market,
      reason: heldMarket.reason,
      reasonCodes: heldMarket.reasonCodes ?? [],
      outlook,
    })];
  });
  return [...evaluated, ...held].sort((a, b) =>
    ["moneyline", "spread", "total"].indexOf(a.market) - ["moneyline", "spread", "total"].indexOf(b.market));
}

function buildHeldForecastRecord(args: {
  payload: CfbForwardEvidencePayload;
  gameId: number;
  externalId: number;
  market: CfbV1Market;
  reason: string;
  reasonCodes: string[];
  outlook: NonNullable<NonNullable<CfbForwardEvidencePayload["decisions"]["marketOutlooks"]>[CfbV1Market]>;
}): PredictionRecordRow {
  const side = args.outlook.side;
  const team = side === "home" ? args.payload.game.home.abbreviation : args.payload.game.away.abbreviation;
  const pick = args.market === "moneyline"
    ? team
    : args.market === "spread"
      ? `${team} ${formatLine(args.outlook.line!)}`
      : `${side === "over" ? "Over" : "Under"} ${args.outlook.line}`;
  return {
    game_prediction_id: null,
    game_id: args.gameId,
    external_id: args.externalId,
    sport: "cfb",
    slate_date: computeSlateDate("cfb", args.payload.game.scheduledStart),
    game_date: args.payload.game.scheduledStart,
    matchup: `${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation}`,
    market: args.market,
    pick,
    side,
    line_value: args.market === "moneyline" ? null : args.outlook.line,
    odds_american: null,
    odds_decimal: null,
    model_used: args.payload.decisions.modelRelease,
    model_version: args.payload.decisions.decisionRelease,
    prediction_source: "cfb_forward_evidence_t60_held_forecast",
    confidence: args.outlook.independentProbability * 100,
    model_probability: args.outlook.independentProbability,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: "no_play",
    prediction_type: args.market,
    best_angle: false,
    no_bet: true,
    no_bet_reason: args.reason || "exact_price_market_unavailable",
    market_aligned: false,
    data_quality_tier: "held",
    source_quality: args.outlook.source,
    provisional: false,
    held: true,
    hold_reason: args.reason || "Exact-price market unavailable at T-60",
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: args.payload.capturedAt,
    published_at: args.payload.capturedAt,
    snapshot_json: {
      football_market_scoped_tracking_release: FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE,
      cfb_tracking_record_release: CFB_OFFICIAL_TRACKING_RECORD_RELEASE,
      evidence_release: args.payload.schemaRelease,
      evidence_payload_sha256: hashCfbForwardEvidencePayload(args.payload),
      evidence_run_id: args.payload.runId,
      season: args.payload.season,
      week: args.payload.week,
      stage: args.payload.stage,
      t60_lag_minutes: args.payload.t60LagMinutes,
      held_market: { market: args.market, reason: args.reason, reasonCodes: args.reasonCodes },
      forecast_outlook: args.outlook,
      forecast: args.payload.decisions.forecast,
      independent_forecast: args.payload.independentForecast,
      authoritative_forecast: args.payload.authoritativeForecast,
      operational_opening: args.payload.market.operationalOpening,
      current_books_at_lock: args.payload.market.currentBooks,
      coverage_at_lock: args.payload.coverage,
    },
    calibration_version: CFB_V1_CALIBRATION_RELEASE,
  };
}

function formatLine(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function assertCfbTrackingPayload(payload: CfbForwardEvidencePayload): void {
  if (
    payload.schemaRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    payload.memberRelease !== CFB_FORWARD_MEMBER_RELEASE ||
    payload.decisions.decisionRelease !== CFB_V1_DECISION_RELEASE ||
    payload.authoritativeForecast?.release !== CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE ||
    payload.authoritativeForecast.status !== "market_sharp_applied" ||
    !payload.decisions.publicationEnabled ||
    !payload.decisions.trackingEnabled ||
    payload.stage !== "t60" ||
    payload.captureTiming !== "on_time" ||
    payload.t60LagMinutes === null ||
    payload.t60LagMinutes < 0 ||
    payload.t60LagMinutes > CFB_T60_MAX_CAPTURE_LAG_MINUTES
  ) {
    throw new Error("CFB tracking records require an eligible on-time T-60 evidence payload.");
  }
  const capturedAt = Date.parse(payload.capturedAt);
  const gameStartsAt = Date.parse(payload.game.scheduledStart);
  const coherent = Number.isFinite(capturedAt) && Number.isFinite(gameStartsAt) &&
    payload.decisions.evaluatedBets.every((decision) =>
      decision.providerGameId === payload.game.providerGameId &&
      decision.stage === "t60_locked" &&
      decision.lockedAt !== null &&
      Date.parse(decision.lockedAt) === capturedAt &&
      Date.parse(decision.evaluatedAt) === capturedAt &&
      Date.parse(decision.gameStartsAt) === gameStartsAt &&
      Date.parse(decision.evaluatedQuote.observedAt) <= capturedAt &&
      decision.modelRelease === payload.decisions.modelRelease &&
      decision.policyRelease === payload.decisions.policyRelease &&
      decision.decisionRelease === payload.decisions.decisionRelease);
  if (!coherent) throw new Error("CFB tracking decision tuple is not coherent with its frozen evidence payload.");
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
