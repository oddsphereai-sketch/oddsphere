/**
 * Phase 7L Phase 3 — NHL → DailyEdgeResponse adapter (admin-safe).
 *
 * Lean adapter for v0. Produces a structurally-valid DailyEdgeResponse
 * so the existing DailyEdgeShell can render NHL games when sport='nhl',
 * but only fills the fields the v0 NHL pipeline actually has data for.
 * Mirrors the spirit of adaptNbaToDailyEdgeResponse.ts without copying
 * its 489 LOC — the NHL v0 has a simpler feature surface and we'll
 * polish field-by-field as we move toward member-facing launch.
 *
 * What we populate
 *   • Top-level: as_of, sport, date, requested_date, slate_status,
 *     slateState, games[].
 *   • Per game: teams, time, lock state, scheduled lock, status,
 *     predictions.{ml,total,nrfi}, markets.{moneyline,total,first_inning},
 *     decisionLine, breakdown, projected scores, sharpSignals [],
 *     result (null pre-grade), no homeStarter/awayStarter (NHL has none).
 *
 * What we leave as no-play / null
 *   • NRFI / first_inning markets — MLB-only concept, returned as no_play.
 *   • homeStarter / awayStarter — null (DailyEdgeShell already handles
 *     this via sport guards for non-MLB sports).
 *   • holdReason — null in v0 (no held markets).
 *
 * Admin-safe — this adapter only runs when sport='nhl' AND the route
 * caller is authenticated. SportRail still has NHL as live=false, so
 * member-facing access stays off until launch.
 */

import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeResponse,
  DailyEdgeTotalPredictionDto,
  MarketEdgeDto,
} from "../../../app/lab/lib/labTypes";
import type { Grade } from "../../types/domain/Grade";
import type { Verdict } from "../verdictDerivation";
import type { SharpReadKey } from "../sharpReadSelector";
import type {
  NhlFeatureSnapshot,
  NhlModelOutput,
  NhlVerdictKey,
} from "../../automodel/nhlAutoModelV0";

const NHL_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/nhl/500";

/** v0 verdict → MLB-style Verdict union. */
function verdictKeyMap(v: NhlVerdictKey): Verdict {
  switch (v) {
    case "best_angle": return "best_angle";
    case "lean":       return "lean";
    case "watchlist":  return "watchlist";
    case "pass":       return "no_play";
  }
}

function verdictLabelFromKey(v: Verdict): string {
  switch (v) {
    case "best_angle": return "Best Angle";
    case "lean":       return "Lean";
    case "watchlist":  return "Watchlist";
    case "caution":    return "Caution";
    case "no_play":    return "No Play";
  }
}

function gradeFromVerdict(v: NhlVerdictKey): Grade | null {
  switch (v) {
    case "best_angle": return "best_signal";
    case "lean":       return "model_only";
    case "watchlist":  return "market_watch";
    case "pass":       return null;
  }
}

function timeShortEt(utcIso: string | null): string {
  if (utcIso === null) return "tip tbd";
  try {
    const d = new Date(utcIso);
    return d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "tip tbd";
  }
}

function startMinutesEt(utcIso: string | null): number {
  if (utcIso === null) return 0;
  try {
    const d = new Date(utcIso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const h = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return h * 60 + m;
  } catch {
    return 0;
  }
}

function logoFor(abbr: string): string {
  return `${NHL_LOGO_BASE}/${abbr.toLowerCase()}.png`;
}

function buildPredictionDto(
  market: NhlModelOutput["moneyline"],
): DailyEdgePredictionDto {
  return {
    pick: market.pick,
    confidence: market.confidence,
    sharpStatus: "mixed",
    grade: gradeFromVerdict(market.verdict),
    signalType: null,
    marketSignal: null,
  };
}

function buildTotalDto(
  market: NhlModelOutput["total"],
  modelTotal: number,
): DailyEdgeTotalPredictionDto {
  return {
    ...buildPredictionDto(market),
    line: modelTotal,
  };
}

function noPlayPrediction(): DailyEdgePredictionDto {
  return {
    pick: "No Play",
    confidence: 0,
    sharpStatus: "mixed",
    grade: null,
    signalType: null,
    marketSignal: null,
  };
}

function buildMarketEdge(
  market: NhlModelOutput["moneyline"],
  slot: "ml" | "total",
  modelTotal: number,
  marketLine: number | null,
  priceAmerican: number | null,
): MarketEdgeDto {
  const verdict = verdictKeyMap(market.verdict);
  const held = market.verdict === "pass";
  return {
    pick: market.pick,
    confidence: market.confidence,
    grade: gradeFromVerdict(market.verdict),
    signalType: null,
    marketSignal: null,
    sharpStatus: "mixed",
    held,
    verdict: { key: verdict, label: verdictLabelFromKey(verdict) },
    guidedGuide: held ? "Model is not picking this market tonight." : `Model lean: ${market.pick}`,
    guidedWatchOut: market.notes[0] ?? "",
    whyLine: market.notes.slice(1).join(" ") || (market.notes[0] ?? ""),
    riskLine: "v0 calibration phase — verdict capped at Lean.",
    modelProb: market.probability,
    marketFairProb: market.model_market_gap_pct !== null
      ? market.probability - market.model_market_gap_pct
      : null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican,
    lineOpenAmerican: null,
    modelTotal: slot === "total" && !held ? modelTotal : null,
    marketTotal: slot === "total" ? marketLine : null,
    line: slot === "ml" ? null : marketLine,
    keyStats: [],
    modelTrustPct: held ? null : market.confidence,
    marketImpliedPct: null,
    modelMarketGapPct: market.model_market_gap_pct !== null
      ? market.model_market_gap_pct * 100
      : null,
    recommendationConfidence: held ? null : market.confidence,
    marketSource: null,
    marketDataQuality: priceAmerican !== null ? "single_book" : "unavailable",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
}

function noPlayMarketEdge(): MarketEdgeDto {
  return {
    pick: "No Play",
    confidence: 0,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "mixed",
    held: false,
    verdict: { key: "no_play", label: "No Play" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: null,
    marketFairProb: null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: null,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
    modelTrustPct: null,
    marketImpliedPct: null,
    modelMarketGapPct: null,
    recommendationConfidence: null,
    marketSource: null,
    marketDataQuality: "unavailable",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
}

export type NhlAdapterGameInput = {
  /** games.id (DB primary key). */
  gameId: number;
  /** games.external_id (NHL game id). */
  externalId: number;
  homeAbbr: string;
  awayAbbr: string;
  /** ISO UTC game start. */
  gameDateIso: string;
  /** NHL gameState (FUT / LIVE / FINAL / OFF / etc.). */
  status: string;
  /** Final score; null pre-game. */
  homeScore: number | null;
  awayScore: number | null;
  /** Per-game model output (already run via nhlAutoModelV0). */
  model: NhlModelOutput;
  /** From featureSnapshot. */
  snapshot: NhlFeatureSnapshot;
  /** Best ML price for the picked side; null when unavailable. */
  mlPriceAmerican: number | null;
  /** Best Total price for the picked side; null when unavailable. */
  totalPriceAmerican: number | null;
  /** Market total line (median from lines). */
  marketTotalLine: number | null;
  /** locked_at from prediction_records, if any. Null when not yet written. */
  lockedAt: string | null;
};

export function adaptNhlGameToDto(input: NhlAdapterGameInput): DailyEdgeGameDto {
  const { model } = input;
  const homeWinProjected = model.expected_goal_diff >= 0;
  const halfGoals = Math.abs(model.expected_goal_diff) / 2;
  const baseTotal = model.expected_total_goals / 2;
  const projectedHome = Math.max(0, baseTotal + (homeWinProjected ? halfGoals : -halfGoals));
  const projectedAway = Math.max(0, baseTotal + (homeWinProjected ? -halfGoals : halfGoals));

  const verdict = verdictKeyMap(model.moneyline.verdict);
  const lockState: "open" | "locking" | "locked" =
    input.lockedAt !== null
      ? "locked"
      : (input.status === "LIVE" || input.status === "CRIT" || input.status === "FINAL" || input.status === "OFF")
        ? "locked"
        : "open";

  return {
    id: `nhl-${input.externalId}`,
    sport: "nhl",
    external_id: input.externalId,
    awayTeam: input.awayAbbr,
    awayTeamLogo: logoFor(input.awayAbbr),
    homeTeam: input.homeAbbr,
    homeTeamLogo: logoFor(input.homeAbbr),
    gameTime: timeShortEt(input.gameDateIso),
    gameStartMinutes: startMinutesEt(input.gameDateIso),
    scheduledLockAt: input.gameDateIso,
    lockState,
    lockedAt: input.lockedAt,
    updatedAt: new Date().toISOString(),
    generatedAt: null,
    holdReason: null,
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: buildPredictionDto(model.moneyline),
      total: buildTotalDto(model.total, model.expected_total_goals),
      nrfi: noPlayPrediction(),
    },
    markets: {
      moneyline: buildMarketEdge(model.moneyline, "ml", model.expected_total_goals, null, input.mlPriceAmerican),
      total: buildMarketEdge(model.total, "total", model.expected_total_goals, input.marketTotalLine, input.totalPriceAmerican),
      first_inning: noPlayMarketEdge(),
    },
    decisionLine: `Tonight's read: ${model.moneyline.pick} · ${verdictLabelFromKey(verdict)}`,
    projected: {
      away: Math.round(projectedAway * 10) / 10,
      home: Math.round(projectedHome * 10) / 10,
    },
    sharpSignals: [],
    status: {
      lineupConfirmed: null,
      linesLocked: lockState === "locked",
      sharpSignalPending: false,
      marketDataLimited: false,
    },
    result: (input.status === "FINAL" || input.status === "OFF") && input.homeScore !== null && input.awayScore !== null
      ? {
          finalScore: { away: input.awayScore, home: input.homeScore },
          markets: {
            moneyline: { pickResult: null, gradeUnits: null },
            total: { pickResult: null, gradeUnits: null },
            first_inning: { pickResult: null, gradeUnits: null },
          },
        }
      : null,
    breakdown: {
      verdict: { key: verdict, label: verdictLabelFromKey(verdict) },
      sharpRead: {
        key: "wait_no_edge_clean" as SharpReadKey,
        sentence: model.moneyline.notes[0] ?? "Calibration phase — verdict reserved until v0 has graded outcomes.",
      },
      modelBreakdown: [
        `${input.awayAbbr} @ ${input.homeAbbr} ${model.inputs_summary.series ? `(${model.inputs_summary.series})` : ""}.`,
        `Model expected goal diff (home - away): ${model.expected_goal_diff.toFixed(2)} from team xG, goalie, special teams, rest, home ice, and series layers.`,
        `Expected total goals: ${model.expected_total_goals.toFixed(2)}.`,
        `Moneyline: ${model.moneyline.pick} at ${(model.moneyline.probability * 100).toFixed(1)}% (verdict ${model.moneyline.verdict}).`,
        `Total: ${model.total.pick} (verdict ${model.total.verdict}).`,
      ].join(" "),
    },
  };
}

/**
 * Wrap one or more NHL game DTOs into the full DailyEdgeResponse.
 */
export function buildNhlDailyEdgeResponse(opts: {
  date: string;
  requestedDate: string;
  games: DailyEdgeGameDto[];
}): DailyEdgeResponse {
  return {
    as_of: new Date().toISOString(),
    sport: "nhl",
    date: opts.date,
    requested_date: opts.requestedDate,
    fallback_used: false,
    slateState: opts.games.length === 0 ? "no_data" : "today_published",
    slate_status: opts.games.length === 0 ? null : "published",
    last_slate_update_at: opts.games.length === 0 ? null : new Date().toISOString(),
    games: opts.games,
  };
}
