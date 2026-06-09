/**
 * Phase 7F (Path A) — NBA → DailyEdgeResponse adapter.
 *
 * Pure transform. Takes the existing NbaDailyEdgeDto and shapes it
 * into the MLB-style DailyEdgeResponse so the SAME DailyEdgeShell can
 * render NBA games. The shell carries surgical `sport === "nba"`
 * guards (sport-aware market labels, skipped MLB-specific renderers
 * for pitchers/FI stats/etc.) so MLB output is byte-identical and NBA
 * gets a clean sport-appropriate read.
 *
 * Mapping at a glance:
 *
 *     NBA ML       → predictions.ml      / markets.moneyline
 *     NBA Total    → predictions.total   / markets.total
 *     NBA Spread   → predictions.nrfi    / markets.first_inning   ← relabeled
 *                                          in the shell when sport === "nba"
 *
 * What we deliberately do NOT populate (NBA has no MLB equivalent):
 *
 *     homeStarter / awayStarter     → null  (NBA shell guard returns null)
 *     keyStats[]                    → []    (MLB KeyStats renderer no-ops on empty)
 *     park/weather / FI runs / WHIP → never present (no rows produced)
 *
 * What we synthesize so the shell renders meaningfully:
 *
 *     decisionLine                  → from quick_read
 *     breakdown.{verdict,sharpRead,modelBreakdown}
 *     sharpSignals[]                → from splits divergence + opps EV
 *     publicSplits[]                → from NBA splits intel
 *
 * No DB, no network. Pure function.
 */

import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeResponse,
  DailyEdgeTotalPredictionDto,
  MarketEdgeDto,
  SharpSignalCategory,
  SharpSignalDto,
} from "../../../app/lab/lib/labTypes";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "../../../lib/types/domain/Grade";
import type { Verdict } from "../verdictDerivation";
import type { SharpReadKey } from "../sharpReadSelector";
import type {
  MarketIntelligence,
  NbaDailyEdgeDto,
  NbaDailyEdgeGameDto,
  NbaMarketSignalsCapability,
} from "./buildNbaDailyEdgeDto";
import type { RecommendationGrade } from "./nbaMarketReview";

const NBA_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/nba/500";

// Map NBA RecommendationGrade → MLB Verdict key.
function gradeToVerdict(grade: RecommendationGrade): Verdict {
  switch (grade) {
    case "best_angle": return "best_angle";
    case "lean":       return "lean";
    case "watch":      return "watchlist";
    case "caution":    return "caution";
    case "no_market":  return "no_play";
    case "held":       return "no_play";
  }
}

// MLB Grade union: best_signal | sharp_confirmed | market_led | model_only |
// market_watch | public_smoke | sharp_conflict
function gradeToMlbGrade(grade: RecommendationGrade): Grade {
  switch (grade) {
    case "best_angle": return "best_signal";
    case "lean":       return "model_only";
    case "watch":      return "market_watch";
    case "caution":    return "sharp_conflict";
    case "no_market":  return "model_only";
    case "held":       return "market_watch";
  }
}

function tipDisplayShortEt(utcIso: string | null): string {
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

function tipStartMinutesEt(utcIso: string | null): number {
  if (utcIso === null) return 0;
  try {
    const d = new Date(utcIso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const h = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return h * 60 + m;
  } catch {
    return 0;
  }
}

function americanToImplied(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function nbaLogoUrl(abbr: string): string {
  return `${NBA_LOGO_BASE}/${abbr.toLowerCase()}.png`;
}

function pickConfidenceFraction(intel: MarketIntelligence): number | null {
  if (intel.pick_side === null) return null;
  return intel.effective_confidence / 100;
}

function buildPickLabel(intel: MarketIntelligence): string | null {
  if (intel.pick_side === null) return null;
  return intel.pick_label;
}

// MarketSignal union: market_confirmed | market_neutral | market_resistance |
// public_smoke | steam_alert
function buildMarketSignal(intel: MarketIntelligence): MarketSignal {
  switch (intel.conflict_band) {
    case "support":             return "market_confirmed";
    case "neutral":             return "market_neutral";
    case "mild_conflict":       return "market_resistance";
    case "strong_conflict":     return "market_resistance";
    case "market_unavailable":  return "market_neutral";
  }
}

// SignalType union: model_dominant | market_dominant | balanced | model_only |
// market_only
function buildSignalType(intel: MarketIntelligence): SignalType {
  if (intel.opp_ev_percentage_pick !== null && intel.opp_ev_percentage_pick > 1) return "market_dominant";
  if (intel.splits.sharp_signal_side !== "none") return "balanced";
  return "model_only";
}

function buildSharpStatusFromGrade(grade: RecommendationGrade): "confirm" | "mixed" | "caution" {
  if (grade === "best_angle" || grade === "lean") return "confirm";
  if (grade === "caution") return "caution";
  return "mixed";
}

/**
 * SharpAPI returns split percentages on the 0..1 scale; the shared MLB
 * shell renders them as whole-number percentages (70 = 70%). Normalize
 * to 0..100 once at the boundary so the UI components don't need to
 * branch on sport.
 */
function pctTo100(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  // Defensive: already 0..100 values are passed through unchanged.
  return v <= 1 ? v * 100 : v;
}

function buildMarketEdgeDto(opts: {
  intel: MarketIntelligence;
  homeAbbr: string;
  awayAbbr: string;
  sportSlot: "ml" | "total" | "spread";
  capability: NbaMarketSignalsCapability;
  /** First-seen line price on the picked side, derived from NBA line_history. */
  openPriceAmerican: number | null;
}): MarketEdgeDto {
  const { intel, homeAbbr, awayAbbr, sportSlot, capability, openPriceAmerican } = opts;
  const held = intel.pick_side === null;
  const verdict: { key: Verdict; label: string } = {
    key: gradeToVerdict(intel.grade),
    label:
      intel.grade === "best_angle" ? "Best Angle" :
      intel.grade === "lean" ? "Lean" :
      intel.grade === "watch" ? "Watchlist" :
      intel.grade === "caution" ? "Caution" :
      "No Play",
  };

  const publicSplits: MarketEdgeDto["publicSplits"] = [];
  if (capability === "available" && intel.splits.pick_side !== null && intel.splits.other_side !== null) {
    if (sportSlot === "total") {
      const pickIsOver = intel.pick_side === "over";
      publicSplits.push({
        side: pickIsOver ? "over" : "under",
        label: pickIsOver ? "Over" : "Under",
        moneyPct: pctTo100(intel.splits.pick_side.handle_pct),
        betsPct: pctTo100(intel.splits.pick_side.bets_pct),
      });
      publicSplits.push({
        side: pickIsOver ? "under" : "over",
        label: pickIsOver ? "Under" : "Over",
        moneyPct: pctTo100(intel.splits.other_side.handle_pct),
        betsPct: pctTo100(intel.splits.other_side.bets_pct),
      });
    } else {
      const pickIsHome = intel.pick_side === "home";
      publicSplits.push({
        side: pickIsHome ? "home" : "away",
        label: pickIsHome ? homeAbbr : awayAbbr,
        moneyPct: pctTo100(intel.splits.pick_side.handle_pct),
        betsPct: pctTo100(intel.splits.pick_side.bets_pct),
      });
      publicSplits.push({
        side: pickIsHome ? "away" : "home",
        label: pickIsHome ? awayAbbr : homeAbbr,
        moneyPct: pctTo100(intel.splits.other_side.handle_pct),
        betsPct: pctTo100(intel.splits.other_side.bets_pct),
      });
    }
  }

  const modelProb = intel.model_prob_on_pick;
  const marketImplied = americanToImplied(intel.current_price.odds_american);
  const noVigImplied = intel.market_no_vig_prob_pick;

  const guidedGuide = held
    ? "Model is not picking a side here tonight."
    : `Model lean: ${intel.pick_label}.`;
  const guidedWatchOut = intel.rationale.length > 0
    ? intel.rationale[0]!
    : "Tracking opens on tonight's first observed line — line history fills in as the day moves.";
  const whyLine = intel.rationale.length > 1
    ? intel.rationale.slice(1).join(" ")
    : guidedWatchOut;
  // Same line-tracking caveat — strip the internal-y "opener / first observed"
  // wording from the per-game movement_note string before it hits members.
  const riskLine = "Line tracking begins at tonight's first observed price.";

  return {
    pick: buildPickLabel(intel),
    confidence: pickConfidenceFraction(intel),
    grade: held ? null : gradeToMlbGrade(intel.grade),
    signalType: buildSignalType(intel),
    marketSignal: buildMarketSignal(intel),
    sharpStatus: buildSharpStatusFromGrade(intel.grade),
    held,
    verdict,
    guidedGuide,
    guidedWatchOut,
    whyLine,
    riskLine,
    modelProb,
    marketFairProb: noVigImplied,
    pinnacleEvPct: intel.opp_ev_percentage_pick,
    moneyPct: pctTo100(intel.splits.pick_side?.handle_pct ?? null),
    betsPct: pctTo100(intel.splits.pick_side?.bets_pct ?? null),
    publicSplits,
    priceAmerican: intel.current_price.odds_american,
    lineOpenAmerican: openPriceAmerican,
    modelTotal: sportSlot === "total" && !held ? (intel.consensus_line ?? null) : null,
    marketTotal: sportSlot === "total" ? intel.consensus_line : null,
    line: sportSlot === "ml" ? null : intel.consensus_line,
    keyStats: [],
    modelTrustPct: held ? null : intel.effective_confidence,
    marketImpliedPct: marketImplied !== null ? marketImplied * 100 : null,
    modelMarketGapPct:
      held || modelProb === null || marketImplied === null
        ? null
        : (modelProb - marketImplied) * 100,
    recommendationConfidence: held ? null : intel.effective_confidence,
    marketSource: intel.current_price.sportsbook,
    marketDataQuality:
      noVigImplied !== null && intel.current_price.odds_american !== null && intel.other_side_price.odds_american !== null
        ? "two_sided_consensus"
        : intel.current_price.odds_american !== null
          ? "single_book"
          : "unavailable",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
}

function buildPredictionDto(intel: MarketIntelligence): DailyEdgePredictionDto {
  const held = intel.pick_side === null;
  return {
    pick: buildPickLabel(intel),
    confidence: pickConfidenceFraction(intel),
    sharpStatus: buildSharpStatusFromGrade(intel.grade),
    grade: held ? null : gradeToMlbGrade(intel.grade),
    signalType: buildSignalType(intel),
    marketSignal: buildMarketSignal(intel),
  };
}

function buildTotalPredictionDto(intel: MarketIntelligence): DailyEdgeTotalPredictionDto {
  return {
    ...buildPredictionDto(intel),
    line: intel.consensus_line,
  };
}

function buildSharpSignals(game: NbaDailyEdgeGameDto, capability: NbaMarketSignalsCapability): SharpSignalDto[] {
  if (capability !== "available") return [];
  const out: SharpSignalDto[] = [];
  const intel = game.intelligence;

  const evRow = (label: "ML" | "OU" | "NRFI", ev: number | null) => {
    if (ev === null || Math.abs(ev) < 1) return;
    out.push({
      market: label,
      category: "handle_gap",
      description: `${label}: SharpAPI EV ${ev > 0 ? "+" : ""}${ev.toFixed(2)}% on the model-leaned side.`,
      direction: ev > 0 ? "positive" : "negative",
    });
  };
  evRow("ML", intel.ml.opp_ev_percentage_pick);
  evRow("OU", intel.total.opp_ev_percentage_pick);
  evRow("NRFI", intel.spread.opp_ev_percentage_pick);

  const divRow = (label: "ML" | "OU" | "NRFI", intelMkt: MarketIntelligence) => {
    if (intelMkt.splits.pick_side === null) return;
    const div = intelMkt.splits.pick_side.divergence;
    if (div === "none") return;
    const isSharp = div.startsWith("strong_sharp") || div.startsWith("mild_sharp");
    const cat: SharpSignalCategory = isSharp ? "handle_gap" : "no_signal";
    out.push({
      market: label,
      category: cat,
      description: isSharp
        ? `${label}: money outpaces bets on our pick (${div.replace("_", " ")}).`
        : `${label}: bets outpace money on our pick (${div.replace("_", " ")}); do not auto-fade.`,
      direction: isSharp ? "positive" : "neutral",
    });
  };
  divRow("ML", intel.ml);
  divRow("OU", intel.total);
  divRow("NRFI", intel.spread);

  return out;
}

function buildSharpReadFromQuickRead(quickRead: string): { key: SharpReadKey; sentence: string } {
  return { key: "wait_no_edge_clean" as SharpReadKey, sentence: quickRead };
}

/**
 * Per-game first-seen prices on the picked side of each market, derived
 * from NBA line_history. Mirrors how MLB feeds `lineOpenAmerican` to the
 * shell so the line-move row renders for NBA too.
 */
export type NbaPickSideOpenPrices = {
  ml: number | null;
  total: number | null;
  spread: number | null;
};

function adaptGame(
  game: NbaDailyEdgeGameDto,
  capability: NbaMarketSignalsCapability,
  asOf: string,
  openPrices: NbaPickSideOpenPrices,
): DailyEdgeGameDto {
  const intel = game.intelligence;
  const ml = buildMarketEdgeDto({
    intel: intel.ml,
    homeAbbr: game.home_abbr,
    awayAbbr: game.away_abbr,
    sportSlot: "ml",
    capability,
    openPriceAmerican: openPrices.ml,
  });
  const total = buildMarketEdgeDto({
    intel: intel.total,
    homeAbbr: game.home_abbr,
    awayAbbr: game.away_abbr,
    sportSlot: "total",
    capability,
    openPriceAmerican: openPrices.total,
  });
  const spreadAsFi = buildMarketEdgeDto({
    intel: intel.spread,
    homeAbbr: game.home_abbr,
    awayAbbr: game.away_abbr,
    sportSlot: "spread",
    capability,
    openPriceAmerican: openPrices.spread,
  });

  const topGrade = intel.top_grade;
  const verdictKey = gradeToVerdict(topGrade);
  const verdictLabel =
    topGrade === "best_angle" ? "Best Angle" :
    topGrade === "lean" ? "Lean" :
    topGrade === "watch" ? "Watchlist" :
    topGrade === "caution" ? "Caution" : "No Play";

  const labelFor = (g: RecommendationGrade): string =>
    g === "best_angle" ? "Best Angle" :
    g === "lean" ? "Lean" :
    g === "watch" ? "Watchlist" :
    g === "caution" ? "Caution" :
    "No Play";
  const modelBreakdown = `Model lean: ${intel.ml.pick_label}. Spread read: ${intel.spread.pick_label} (${labelFor(intel.spread.grade)}). Total read: ${intel.total.pick_label} (${labelFor(intel.total.grade)}).${intel.sources.limited_book_coverage ? ` Limited book coverage (${intel.sources.book_count} ${intel.sources.book_count === 1 ? "book" : "books"}).` : ""}`.trim();

  return {
    id: `nba-${game.game_external_id}`,
    sport: "nba",
    external_id: game.game_external_id,
    awayTeam: game.away_abbr,
    awayTeamLogo: nbaLogoUrl(game.away_abbr),
    homeTeam: game.home_abbr,
    homeTeamLogo: nbaLogoUrl(game.home_abbr),
    gameTime: tipDisplayShortEt(game.tip_iso_utc),
    gameStartMinutes: tipStartMinutesEt(game.tip_iso_utc),
    scheduledLockAt: game.tip_iso_utc ?? asOf,
    lockState: "open",
    lockedAt: null,
    updatedAt: asOf,
    generatedAt: asOf,
    holdReason: null,
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: buildPredictionDto(intel.ml),
      total: buildTotalPredictionDto(intel.total),
      nrfi: buildPredictionDto(intel.spread),
    },
    markets: {
      moneyline: ml,
      total,
      first_inning: spreadAsFi,
    },
    decisionLine: game.quick_read,
    projected: {
      away: game.projection.away_score,
      home: game.projection.home_score,
    },
    sharpSignals: buildSharpSignals(game, capability),
    status: {
      lineupConfirmed: null,
      linesLocked: intel.sources.has_lines,
      sharpSignalPending: !intel.sources.has_opportunities,
      marketDataLimited: !intel.sources.has_lines,
    },
    result: null,
    breakdown: {
      verdict: { key: verdictKey, label: verdictLabel },
      sharpRead: buildSharpReadFromQuickRead(game.quick_read),
      modelBreakdown,
    },
  };
}

export function adaptNbaToDailyEdgeResponse(
  nbaDto: NbaDailyEdgeDto,
  opts?: { openPricesByGame?: Map<number, NbaPickSideOpenPrices> },
): DailyEdgeResponse {
  return {
    as_of: nbaDto.as_of,
    sport: "nba",
    date: nbaDto.slate_date_et,
    requested_date: nbaDto.slate_date_et,
    fallback_used: false,
    // Phase 7J — emit "no_data" (not "today_pending_ingest") when NBA
    // has zero games today. The "pending_ingest" copy implied ingestion
    // was actively in progress and replaced the entire page; on most
    // calendar days NBA simply has no games scheduled, which is the
    // honest answer.
    slateState: nbaDto.games.length > 0 ? "today_published" : "no_data",
    slate_status: nbaDto.games.length > 0 ? "published" : null,
    last_slate_update_at: nbaDto.as_of,
    games: nbaDto.games.map((g) => {
      const openPrices: NbaPickSideOpenPrices = opts?.openPricesByGame?.get(g.game_external_id) ?? {
        ml: null,
        total: null,
        spread: null,
      };
      return adaptGame(g, nbaDto.market_signals_capability, nbaDto.as_of, openPrices);
    }),
  };
}
