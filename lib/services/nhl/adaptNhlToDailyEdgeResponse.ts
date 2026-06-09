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
  KeyStatRow,
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
import type { SharpNhlSplitsEvent } from "../../providers/nhl/_sharpApiNhlClient";
import { americanToImplied } from "../../utils/odds";

/**
 * Per-market best-of-book bundle the pipeline assembles and the adapter
 * consumes. Each bundle covers one slot (ML / Total / Puck Line) and
 * carries every "live market context" field we surface for that market.
 */
export type NhlPerMarketBest = {
  /** Best (highest American) price on the picked side; null when none. */
  priceAmerican: number | null;
  /** Sportsbook quoting the best price; null when none. */
  sportsbook: string | null;
  /** First-observed price for this (market, picked side) from line_history. */
  openAmerican: number | null;
  /** Pinnacle / cross-book EV % from SharpAPI opportunities; null when none. */
  pinnacleEvPct: number | null;
  /** No-vig fair probability from SharpAPI opportunities; null when none. */
  fairProbability: number | null;
};

/** Multiply a fractional pct (0..1) by 100 for display; null-safe. */
function pctTo100(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v * 100;
}

/**
 * Build the two-row publicSplits array (pick side first, other side
 * second) for a market, mirroring NBA's pattern. Returns [] when the
 * SharpAPI splits payload doesn't carry usable data for this market.
 */
function buildPublicSplits(
  market: "ml" | "total" | "puckline",
  pickIsHome: boolean,
  pickIsOver: boolean,
  splits: SharpNhlSplitsEvent | null,
  homeAbbr: string,
  awayAbbr: string,
): MarketEdgeDto["publicSplits"] {
  if (!splits) return [];
  const arr: MarketEdgeDto["publicSplits"] = [];
  if (market === "total" && splits.total) {
    const t = splits.total;
    const overBets = pctTo100(t.bets_pct?.over ?? null);
    const overHandle = pctTo100(t.handle_pct?.over ?? null);
    const underBets = pctTo100(t.bets_pct?.under ?? null);
    const underHandle = pctTo100(t.handle_pct?.under ?? null);
    if (overBets === null && underBets === null && overHandle === null && underHandle === null) return [];
    arr.push({
      side: pickIsOver ? "over" : "under",
      label: pickIsOver ? "Over" : "Under",
      moneyPct: pickIsOver ? overHandle : underHandle,
      betsPct: pickIsOver ? overBets : underBets,
    });
    arr.push({
      side: pickIsOver ? "under" : "over",
      label: pickIsOver ? "Under" : "Over",
      moneyPct: pickIsOver ? underHandle : overHandle,
      betsPct: pickIsOver ? underBets : overBets,
    });
    return arr;
  }
  const block = market === "ml" ? splits.moneyline : splits.spread;
  if (!block) return [];
  const homeBets = pctTo100(block.bets_pct?.home ?? null);
  const homeHandle = pctTo100(block.handle_pct?.home ?? null);
  const awayBets = pctTo100(block.bets_pct?.away ?? null);
  const awayHandle = pctTo100(block.handle_pct?.away ?? null);
  if (homeBets === null && awayBets === null && homeHandle === null && awayHandle === null) return [];
  arr.push({
    side: pickIsHome ? "home" : "away",
    label: pickIsHome ? homeAbbr : awayAbbr,
    moneyPct: pickIsHome ? homeHandle : awayHandle,
    betsPct: pickIsHome ? homeBets : awayBets,
  });
  arr.push({
    side: pickIsHome ? "away" : "home",
    label: pickIsHome ? awayAbbr : homeAbbr,
    moneyPct: pickIsHome ? awayHandle : homeHandle,
    betsPct: pickIsHome ? awayBets : homeBets,
  });
  return arr;
}

/**
 * Build the keyStats rows for a market from the model's feature
 * snapshot. Same per-team away/home shape MLB + NBA use, so the
 * reader's KeyStats section renders consistently for hockey games.
 */
function buildKeyStats(
  market: "ml" | "total" | "puckline",
  snap: NhlFeatureSnapshot,
  model: NhlModelOutput,
): KeyStatRow[] {
  const rows: KeyStatRow[] = [];
  const fmtPct = (v: number | null) => v === null ? null : `${(v * 100).toFixed(1)}%`;
  const fmtRate = (v: number | null) => v === null ? null : v.toFixed(2);
  const fmtSigned = (v: number | null) =>
    v === null ? null : (v >= 0 ? "+" : "") + v.toFixed(2);

  // Shared across all three markets: team xG% (5v5 strength).
  rows.push({
    label: "Expected goal share (xG%)",
    awayValue: fmtPct(snap.away.xgoals_pct),
    homeValue: fmtPct(snap.home.xgoals_pct),
    source: "feature_snapshot",
  });

  if (market === "ml" || market === "puckline") {
    rows.push({
      label: "Goalie xGSAA / 60",
      awayValue: fmtSigned(snap.away.goalie_xgsaa_per_60),
      homeValue: fmtSigned(snap.home.goalie_xgsaa_per_60),
      source: "feature_snapshot",
    });
    rows.push({
      label: "Power play xG%",
      awayValue: fmtPct(snap.away.pp_xgoals_pct),
      homeValue: fmtPct(snap.home.pp_xgoals_pct),
      source: "feature_snapshot",
    });
    rows.push({
      label: "Penalty kill xG%",
      awayValue: fmtPct(snap.away.pk_xgoals_pct),
      homeValue: fmtPct(snap.home.pk_xgoals_pct),
      source: "feature_snapshot",
    });
    rows.push({
      label: "Rest (days)",
      awayValue: snap.away.rest_days !== null ? String(snap.away.rest_days) : null,
      homeValue: snap.home.rest_days !== null ? String(snap.home.rest_days) : null,
      source: "feature_snapshot",
    });
    if (market === "puckline") {
      rows.push({
        label: "Projected goal diff",
        awayValue: null,
        homeValue: fmtSigned(model.expected_goal_diff),
        source: "computed",
      });
    }
  }

  if (market === "total") {
    rows.push({
      label: "xG for / 60",
      awayValue: fmtRate(snap.away.x_goals_for_per_60),
      homeValue: fmtRate(snap.home.x_goals_for_per_60),
      source: "feature_snapshot",
    });
    rows.push({
      label: "xG against / 60",
      awayValue: fmtRate(snap.away.x_goals_against_per_60),
      homeValue: fmtRate(snap.home.x_goals_against_per_60),
      source: "feature_snapshot",
    });
    rows.push({
      label: "Goalie xGSAA / 60",
      awayValue: fmtSigned(snap.away.goalie_xgsaa_per_60),
      homeValue: fmtSigned(snap.home.goalie_xgsaa_per_60),
      source: "feature_snapshot",
    });
    rows.push({
      label: "Model projected total",
      awayValue: null,
      homeValue: model.expected_total_goals.toFixed(2),
      source: "computed",
    });
  }

  return rows;
}

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

function buildMarketEdge(opts: {
  market: NhlModelOutput["moneyline"];
  slot: "ml" | "total" | "puckline";
  modelTotal: number;
  marketLine: number | null;
  bundle: NhlPerMarketBest;
  publicSplits: MarketEdgeDto["publicSplits"];
  keyStats: KeyStatRow[];
}): MarketEdgeDto {
  const { market, slot, modelTotal, marketLine, bundle, publicSplits, keyStats } = opts;
  const verdict = verdictKeyMap(market.verdict);
  const held = market.verdict === "pass";
  // For Total, the model's `model_market_gap_pct` is in GOAL units
  // (model_total - market_line), not probability units. Mixing the
  // two would produce nonsense pp values and a wrong fairProb fallback.
  // Display fields that are probability-unit-only get nulled for Total;
  // Total's gap is already surfaced as a goal projection in keyStats.
  const isTotal = slot === "total";
  // SharpAPI's fair_probability already encodes the no-vig prob for
  // the picked side. Prefer it over the model-derived fallback. Total
  // gets no model-derived fallback because the gap isn't a probability.
  const fairProb =
    bundle.fairProbability !== null
      ? bundle.fairProbability
      : !isTotal && market.model_market_gap_pct !== null
        ? market.probability - market.model_market_gap_pct
        : null;
  const marketImpliedDecimal =
    bundle.priceAmerican !== null ? americanToImplied(bundle.priceAmerican) : null;
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
    riskLine: "",
    modelProb: market.probability,
    marketFairProb: fairProb,
    pinnacleEvPct: bundle.pinnacleEvPct,
    moneyPct: publicSplits[0]?.moneyPct ?? null,
    betsPct: publicSplits[0]?.betsPct ?? null,
    publicSplits,
    priceAmerican: bundle.priceAmerican,
    lineOpenAmerican: bundle.openAmerican,
    modelTotal: slot === "total" && !held ? modelTotal : null,
    marketTotal: slot === "total" ? marketLine : null,
    // ML carries no line; Total + Puck Line use the `line` slot.
    line: slot === "ml" ? null : marketLine,
    keyStats,
    modelTrustPct: held ? null : market.confidence,
    marketImpliedPct: marketImpliedDecimal !== null ? marketImpliedDecimal * 100 : null,
    modelMarketGapPct: isTotal
      ? null
      : market.model_market_gap_pct !== null
        ? market.model_market_gap_pct * 100
        : null,
    recommendationConfidence: held ? null : market.confidence,
    marketSource: bundle.sportsbook,
    marketDataQuality: bundle.priceAmerican !== null ? "single_book" : "unavailable",
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
  /** Best-of-book bundle for the moneyline picked side. */
  mlBundle: NhlPerMarketBest;
  /** Best-of-book bundle for the total picked side (over or under). */
  totalBundle: NhlPerMarketBest;
  /** Best-of-book bundle for the puck-line picked side. */
  puckLineBundle: NhlPerMarketBest;
  /** Market total line (median from lines). */
  marketTotalLine: number | null;
  /**
   * Puck-line market line — typically ±1.5 in NHL. Display-only; the
   * model always reads at the canonical 1.5 boundary regardless.
   */
  puckLineMarketLine: number | null;
  /**
   * SharpAPI public-money / bets splits payload for this matchup.
   * Null when SharpAPI returned nothing for the slate or the team
   * names didn't normalize to our DB abbreviations. Per-market
   * sub-objects (`moneyline`, `spread`, `total`) may themselves be
   * partially populated — the adapter renders only what's present.
   */
  splits: SharpNhlSplitsEvent | null;
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
      // Puck-line read piggybacks the `nrfi` prediction slot the same
      // way NBA's spread does. v0: display-only, NOT persisted to
      // prediction_records and NOT graded.
      nrfi: buildPredictionDto(model.puck_line),
    },
    markets: (() => {
      const mlPickIsHome = model.moneyline.pick.startsWith(input.homeAbbr);
      const totalPickIsOver = model.total.pick.startsWith("OVER");
      const plPickIsHome = model.puck_line.pick.startsWith(input.homeAbbr);
      return {
        moneyline: buildMarketEdge({
          market: model.moneyline,
          slot: "ml",
          modelTotal: model.expected_total_goals,
          marketLine: null,
          bundle: input.mlBundle,
          publicSplits: buildPublicSplits("ml", mlPickIsHome, false, input.splits, input.homeAbbr, input.awayAbbr),
          keyStats: buildKeyStats("ml", input.snapshot, model),
        }),
        total: buildMarketEdge({
          market: model.total,
          slot: "total",
          modelTotal: model.expected_total_goals,
          marketLine: input.marketTotalLine,
          bundle: input.totalBundle,
          publicSplits: buildPublicSplits("total", false, totalPickIsOver, input.splits, input.homeAbbr, input.awayAbbr),
          keyStats: buildKeyStats("total", input.snapshot, model),
        }),
        // first_inning slot carries the puck-line read for NHL
        // (display-only; not written to prediction_records by the
        // writer, not graded after final).
        first_inning: buildMarketEdge({
          market: model.puck_line,
          slot: "puckline",
          modelTotal: model.expected_total_goals,
          marketLine: input.puckLineMarketLine ?? model.puck_line.puck_line_value,
          bundle: input.puckLineBundle,
          publicSplits: buildPublicSplits("puckline", plPickIsHome, false, input.splits, input.homeAbbr, input.awayAbbr),
          keyStats: buildKeyStats("puckline", input.snapshot, model),
        }),
      };
    })(),
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
        sentence: model.moneyline.notes[0] ?? "Market and model snapshot reviewed; no decisive sharp signal.",
      },
      modelBreakdown: [
        `${input.awayAbbr} @ ${input.homeAbbr} ${model.inputs_summary.series ? `(${model.inputs_summary.series})` : ""}.`,
        `Model expected goal diff (home - away): ${model.expected_goal_diff.toFixed(2)} from team xG, goalie, special teams, rest, home ice, and series layers.`,
        `Expected total goals: ${model.expected_total_goals.toFixed(2)}.`,
        `Moneyline: ${model.moneyline.pick} at ${(model.moneyline.probability * 100).toFixed(1)}% (verdict ${model.moneyline.verdict}).`,
        `Total: ${model.total.pick} (verdict ${model.total.verdict}).`,
        `Puck Line: ${model.puck_line.pick} at ${(model.puck_line.probability * 100).toFixed(1)}% cover (verdict ${model.puck_line.verdict}).`,
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
