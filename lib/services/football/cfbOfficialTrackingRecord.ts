import { createHash } from "node:crypto";
import { computeSlateDate } from "@/lib/dates/slateDate";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  CFB_FORWARD_PRICE_PREVIOUS_MEMBER_RELEASE,
  buildCfbForwardMarketOutlooks,
  hashCfbForwardEvidencePayload,
  type CfbForwardEvidencePayload,
} from "./cfbForwardEvidence";
import {
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  CFB_V1_CALIBRATION_RELEASE,
  CFB_V1_DECISION_RELEASE,
  type CfbV1Market,
} from "./cfbV1Decision";
import type { CfbV1Forecast } from "./cfbV1Decision";
import type { CfbEspnReferenceLine } from "./cfbEspnReferenceLine";
import {
  CFB_MARKET_SHARP_AWARE_PREVIOUS_PRODUCTION_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
} from "./cfbMarketSharpAwareShadow";
import { assertMarketScopedFootballDecisions, FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE } from "./footballMarketScopedTracking";

export const CFB_OFFICIAL_TRACKING_RECORD_RELEASE =
  "cfb_official_tracking_record_2026_09_20_r24_reference_coverage_cursor" as const;

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
    return [buildNoPlayForecastRecord({
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

/**
 * Recover an accuracy denominator from the exact immutable forecast that was
 * published before the game's T-60 boundary when the separate T-60 tracking
 * writer missed its run. These records are deliberately No Play predictions:
 * they do not reconstruct a price, edge, EV, recommendation, stake, or ROI.
 */
export function buildCfbPublishedCutoffRecoveryRecords(args: {
  payload: CfbForwardEvidencePayload;
  gameId: number;
}): PredictionRecordRow[] {
  assertCfbPublishedCutoffRecoveryPayload(args.payload);
  const externalId = providerIntegerId(args.payload.game.providerGameId, "game");
  const outlooks = args.payload.decisions.marketOutlooks;
  if (!outlooks) throw new Error("CFB published-cutoff recovery requires immutable market outlooks.");
  return (["moneyline", "spread", "total"] as const).flatMap((market) => {
    const immutableDecision = args.payload.decisions.evaluatedBets.find((decision) => decision.market === market) ?? null;
    const outlook = outlooks[market] ?? (immutableDecision ? {
      market,
      side: canonicalSide(args.payload, market, immutableDecision.side),
      line: market === "moneyline" ? null : immutableDecision.evaluatedQuote.line,
      independentProbability: immutableDecision.modelProbability,
      source: market === "moneyline" ? "authoritative_pmf" as const : "authoritative_pmf_at_named_book_line" as const,
      contextObservedAt: immutableDecision.evaluatedQuote.observedAt,
    } : null);
    if (!outlook || (market !== "moneyline" && outlook.line === null)) return [];
    return [buildNoPlayForecastRecord({
      payload: args.payload,
      gameId: args.gameId,
      externalId,
      market,
      reason: "t60_tracking_writer_missed_accuracy_only",
      reasonCodes: ["published_before_t60_cutoff", "no_reconstructed_betting_economics"],
      outlook,
      predictionSource: "cfb_forward_evidence_published_cutoff_accuracy_recovery",
      recovery: true,
      recoveryDetails: immutableDecision ? {
        source: "immutable_published_exact_price_decision",
        original_decision: immutableDecision,
      } : { source: "immutable_published_market_outlook" },
    })];
  });
}

export function buildCfbEspnOpeningRecoveryRecords(args: {
  payload: CfbForwardEvidencePayload;
  gameId: number;
  referenceLine: CfbEspnReferenceLine;
  replayForecast: CfbV1Forecast;
}): PredictionRecordRow[] {
  assertCfbPublishedCutoffRecoveryPayload(args.payload);
  assertCfbIndependentReplay(args.payload, args.replayForecast);
  if (args.payload.authoritativeForecast?.status !== "market_anchor_unavailable_hold") {
    throw new Error("CFB ESPN recovery requires a held independent authoritative forecast.");
  }
  const outlooks = buildCfbForwardMarketOutlooks({
    forecast: args.replayForecast,
    playbookLine: null,
    espnReferenceLine: args.referenceLine,
  });
  const externalId = providerIntegerId(args.payload.game.providerGameId, "game");
  return (["spread", "total"] as const).map((market) => buildNoPlayForecastRecord({
    payload: args.payload,
    gameId: args.gameId,
    externalId,
    market,
    reason: "t60_reference_line_unavailable_accuracy_recovery",
    reasonCodes: ["published_before_t60_cutoff", "strict_espn_event_identity", "draftkings_opening_reference", "no_reconstructed_betting_economics"],
    outlook: outlooks[market]!,
    predictionSource: "cfb_forward_evidence_espn_opening_accuracy_recovery",
    recovery: true,
    recoveryDetails: {
      source: "espn_pickcenter_draftkings_opening",
      reference_line_release: args.referenceLine.release,
      provider_event_id: args.referenceLine.providerEventId,
      provider: args.referenceLine.provider,
      sportsbook: args.referenceLine.sportsbook,
      line_type: args.referenceLine.lineType,
      recovered_at: args.referenceLine.capturedAt,
      immutable_independent_pmf_sha256: createHash("sha256").update(JSON.stringify(args.replayForecast.pmf)).digest("hex"),
    },
  }));
}

function buildNoPlayForecastRecord(args: {
  payload: CfbForwardEvidencePayload;
  gameId: number;
  externalId: number;
  market: CfbV1Market;
  reason: string;
  reasonCodes: string[];
  outlook: NonNullable<NonNullable<CfbForwardEvidencePayload["decisions"]["marketOutlooks"]>[CfbV1Market]>;
  predictionSource?: string;
  recovery?: boolean;
  recoveryDetails?: Record<string, unknown>;
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
    prediction_source: args.predictionSource ?? "cfb_forward_evidence_t60_no_play_forecast",
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
    data_quality_tier: "published_forecast",
    source_quality: args.outlook.source,
    provisional: false,
    held: false,
    hold_reason: null,
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
      no_play_market: { market: args.market, reason: args.reason, reasonCodes: args.reasonCodes },
      forecast_outlook: args.outlook,
      forecast: args.payload.decisions.forecast,
      independent_forecast: args.payload.independentForecast,
      authoritative_forecast: args.payload.authoritativeForecast,
      operational_opening: args.payload.market.operationalOpening,
      current_books_at_lock: args.payload.market.currentBooks,
      coverage_at_lock: args.payload.coverage,
      ...(args.recovery ? {
        published_cutoff_recovery: {
          accuracy_only: true,
          original_capture_timing: args.payload.captureTiming,
          original_forecast_release: args.payload.authoritativeForecast?.release ?? null,
          selected_at_or_before_cutoff: new Date(Date.parse(args.payload.game.scheduledStart) - 60 * 60_000).toISOString(),
          excludes: ["odds", "edge", "expected_value", "recommendation", "stake", "roi"],
          ...(args.recoveryDetails ? { details: args.recoveryDetails } : {}),
        },
      } : {}),
    },
    calibration_version: CFB_V1_CALIBRATION_RELEASE,
  };
}

function assertCfbPublishedCutoffRecoveryPayload(payload: CfbForwardEvidencePayload): void {
  const forecastRelease = payload.authoritativeForecast?.release as string | undefined;
  const capturedAt = Date.parse(payload.capturedAt);
  const cutoffAt = Date.parse(payload.game.scheduledStart) - 60 * 60_000;
  const supportedForecastRelease = forecastRelease === CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE ||
    forecastRelease === CFB_MARKET_SHARP_AWARE_PREVIOUS_PRODUCTION_RELEASE;
  if (
    !((String(payload.schemaRelease) === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_MEMBER_RELEASE) ||
      (String(payload.schemaRelease) === CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_PRICE_PREVIOUS_MEMBER_RELEASE)) ||
    payload.decisions.decisionRelease !== CFB_V1_DECISION_RELEASE ||
    !payload.decisions.publicationEnabled ||
    !supportedForecastRelease ||
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(cutoffAt) ||
    capturedAt > cutoffAt
  ) {
    throw new Error("CFB published-cutoff recovery requires a supported immutable pre-cutoff prediction payload.");
  }
}

function assertCfbIndependentReplay(payload: CfbForwardEvidencePayload, replay: CfbV1Forecast): void {
  const expected = payload.contextualEvidenceCapture?.prior.outcome;
  const actualHash = createHash("sha256").update(JSON.stringify(replay.pmf)).digest("hex");
  const exact = (first: number, second: number) => Math.abs(first - second) <= 1e-12;
  const pair = (first: readonly [number, number], second: readonly [number, number]) =>
    exact(first[0], second[0]) && exact(first[1], second[1]);
  if (
    !expected ||
    expected.pmf.sha256 !== actualHash ||
    expected.pmf.cells !== replay.pmf.length ||
    !exact(expected.homeWin, replay.homeWinProbability) ||
    !exact(expected.expected[0], replay.expectedAwayPoints) ||
    !exact(expected.expected[1], replay.expectedHomePoints) ||
    expected.representative[0] !== replay.representativeScore.away ||
    expected.representative[1] !== replay.representativeScore.home ||
    !pair(expected.interval80.away, replay.interval80.away) ||
    !pair(expected.interval80.home, replay.interval80.home) ||
    !pair(expected.interval80.marginHome, replay.interval80.marginHome) ||
    !pair(expected.interval80.total, replay.interval80.total)
  ) {
    throw new Error("CFB ESPN recovery immutable independent PMF replay mismatch.");
  }
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
