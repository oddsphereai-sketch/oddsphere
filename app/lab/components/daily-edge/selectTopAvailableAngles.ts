/**
 * Phase 6B.7 — Top Available Angles fallback selector.
 *
 * Pure helper used by the briefing module and the grouped slate when
 * the strict Best Angle gate (verdict in {best_angle, lean}) returns
 * empty. Picks up to N games ranked by internal model/edge criteria
 * so the Daily Edge surface doesn't feel empty on days when sharp-
 * signal confirmation is sparse and every pick falls through to
 * market_watch → watchlist.
 *
 * What this DOES:
 *   - Considers games whose top per-market verdict has a real model
 *     read (not held, not no_play, not caution).
 *   - Ranks by:
 *       1. headline modelMarketGapPct (edge in pp, desc)
 *       2. recommendationConfidence (0..100, desc)
 *       3. headline modelProb (desc)
 *   - Filters out severe-risk rows (caution = sharp_conflict, market
 *     data limited, all markets held).
 *   - Returns at most `limit` games (default 3).
 *
 * What this does NOT do:
 *   - Does not invent grades, picks, or confidences.
 *   - Does not promote sharp_conflict / caution games.
 *   - Does not lower the strict Best Angle threshold or change grade
 *     derivation upstream.
 *   - Does not run when strict Best Angles already exist.
 *
 * Callers are expected to check `strictBestAngles.length === 0` before
 * invoking, AND to label the result clearly as a fallback in the UI
 * (e.g. "Top Available Angles" with copy like "No sharp-confirmed Best
 * Angles yet — these are the strongest model-backed picks tonight").
 */

import type { DailyEdgeGameDto, MarketEdgeDto } from "../../lib/labTypes";
import { headlinePrimaryMarket, type HeadlineMarket } from "../../lib/perPickHeadline";

// Re-export of the rich per-market shape lives on game.markets in the
// 4.1.10+ DTO. (game.predictions carries the legacy DailyEdgePredictionDto
// which doesn't have modelMarketGapPct / recommendationConfidence /
// modelProb at the same shape, so selection logic must read from
// `markets`.)

/** Minimum edge (in percentage points) to qualify as a fallback angle. */
export const TOP_AVAILABLE_MIN_EDGE_PP = 1.5;

/** Minimum recommendation confidence (0..100) when edge is null. */
export const TOP_AVAILABLE_MIN_REC_CONF = 55;

function headlineMarketDto(
  game: DailyEdgeGameDto,
  market: HeadlineMarket,
): MarketEdgeDto {
  if (market === "moneyline") return game.markets.moneyline;
  if (market === "total") return game.markets.total;
  return game.markets.first_inning;
}

function isCleanlyActionable(game: DailyEdgeGameDto): boolean {
  // Verdict guardrails — no_play and caution are explicit "do not
  // promote" signals. Watchlist + lean + best_angle pass through.
  const v = game.breakdown.verdict.key;
  if (v === "no_play" || v === "caution") return false;

  // Headline market must carry a real pick, a non-null grade, and a
  // non-null model probability for the rank function to mean anything.
  const headlineMarket = headlinePrimaryMarket(game);
  const headline = headlineMarketDto(game, headlineMarket);
  if (headline.held) return false;
  if (headline.pick === null) return false;
  if (headline.grade === null) return false;
  if (headline.modelProb === null) return false;

  // Reject the per-market verdict "no_play" too — a game can have an
  // overall watchlist verdict but the specific headline market may
  // have routed to no_play (e.g., market data limited).
  if (headline.verdict.key === "no_play") return false;

  return true;
}

type Ranked = {
  game: DailyEdgeGameDto;
  edgePp: number | null;
  recConf: number | null;
  modelProb: number | null;
};

function rankCandidate(game: DailyEdgeGameDto): Ranked {
  const headlineMarket = headlinePrimaryMarket(game);
  const headline = headlineMarketDto(game, headlineMarket);
  return {
    game,
    edgePp: headline.modelMarketGapPct,
    recConf: headline.recommendationConfidence ?? null,
    modelProb: headline.modelProb,
  };
}

/**
 * Compare two ranked candidates. Returns negative when `a` should
 * come before `b` in a sort-ascending call. The sort callers use
 * `sort((a, b) => compareRanked(a, b))` so the BETTER candidate ends
 * up at index 0.
 *
 * Tier priority (each preferred over the next):
 *   1. Larger positive edgePp wins.
 *   2. Larger recommendationConfidence wins.
 *   3. Larger modelProb wins.
 *   4. Stable order otherwise (earlier game first).
 */
export function compareRanked(a: Ranked, b: Ranked): number {
  const aEdge = a.edgePp ?? -Infinity;
  const bEdge = b.edgePp ?? -Infinity;
  if (bEdge !== aEdge) return bEdge - aEdge;
  const aRec = a.recConf ?? -Infinity;
  const bRec = b.recConf ?? -Infinity;
  if (bRec !== aRec) return bRec - aRec;
  const aProb = a.modelProb ?? -Infinity;
  const bProb = b.modelProb ?? -Infinity;
  if (bProb !== aProb) return bProb - aProb;
  return a.game.gameStartMinutes - b.game.gameStartMinutes;
}

/**
 * Does this candidate clear at least one of the actionability bars?
 * EITHER a meaningful positive edge OR a strong recommendation
 * confidence with at least some positive (or unknown) edge. Pure
 * "model has a side" without any actionability signal is rejected
 * to keep the fallback selective.
 */
function meetsActionabilityBar(r: Ranked): boolean {
  const edgeOk = r.edgePp !== null && r.edgePp >= TOP_AVAILABLE_MIN_EDGE_PP;
  const recOk =
    r.recConf !== null &&
    r.recConf >= TOP_AVAILABLE_MIN_REC_CONF &&
    // Either edge is unknown (no market data) OR edge is non-negative.
    (r.edgePp === null || r.edgePp >= 0);
  return edgeOk || recOk;
}

export type SelectTopAvailableAnglesResult = {
  games: DailyEdgeGameDto[];
  /** True iff this is a fallback (strict Best Angles were empty). */
  isFallback: boolean;
};

/**
 * Main entry point. Returns up to `limit` games suitable for display
 * in the Top Available Angles section. Empty array means "even the
 * fallback bar wasn't cleared" — UI should then show the honest empty
 * state copy.
 */
export function selectTopAvailableAngles(
  games: DailyEdgeGameDto[],
  limit = 3,
): SelectTopAvailableAnglesResult {
  // Strict path — when the page already has best_angle / lean verdict
  // games, this fallback is moot. Caller decides whether to invoke.
  const strict = games.filter(
    (g) => g.breakdown.verdict.key === "best_angle" || g.breakdown.verdict.key === "lean",
  );
  if (strict.length > 0) {
    return { games: [], isFallback: false };
  }

  const candidates = games
    .filter(isCleanlyActionable)
    .map(rankCandidate)
    .filter(meetsActionabilityBar);
  candidates.sort((a, b) => compareRanked(a, b));

  return {
    games: candidates.slice(0, limit).map((c) => c.game),
    isFallback: true,
  };
}

// Exported for unit-test access.
export const __TEST__ = {
  isCleanlyActionable,
  rankCandidate,
  meetsActionabilityBar,
};
