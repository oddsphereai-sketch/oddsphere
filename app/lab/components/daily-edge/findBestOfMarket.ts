/**
 * Phase 4.1.8.C-final (B+C Hybrid) — best-of-market selector.
 *
 * Pure helper used by TonightsMlbEdge to populate the 3-up "Best of"
 * row: BEST MONEYLINE / BEST TOTAL / BEST 1ST INNING.
 *
 * Selection: among games whose verdict is best_angle OR lean AND whose
 * headline market matches the requested market, pick the strongest read
 * — ranked first by per-pick grade strength (best_signal > sharp_confirmed
 * > market_led > model_only > market_watch > public_smoke), then by
 * per-pick confidence DESC.
 *
 * Returns null when no qualifying game exists. The briefing cell then
 * renders "No standout edge tonight."
 */

import type { DailyEdgeGameDto } from "../../lib/labTypes";
import type { Grade } from "@/lib/types/domain/Grade";
import { headlinePrimaryMarket, type HeadlineMarket } from "../../lib/perPickHeadline";

// Higher = stronger. Mirrors the GRADE_RANK already used in route.ts +
// perPickHeadline (kept locally to avoid an out-of-scope import dance).
const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

const VERDICT_RANK = {
  best_angle: 50,
  lean: 40,
  caution: 30,
  watchlist: 20,
  no_play: 10,
} as const;

type EligibleMarket = "moneyline" | "total" | "first_inning_total";

function perMarketGrade(
  game: DailyEdgeGameDto,
  market: EligibleMarket
): Grade | null {
  if (market === "moneyline") return game.predictions.ml.grade;
  if (market === "total") return game.predictions.total.grade;
  return game.predictions.nrfi.grade;
}

// Phase 4.2.C.2 — confidence is nullable (held markets carry null).
// Held games are filtered out of the candidates list by the
// "best_angle/lean" verdict check at the top of findBestOfMarket
// (held markets route to "no_play"), so this helper is only invoked
// for non-held games in practice. Defensive `?? 0` for sort stability.
function perMarketConfidence(
  game: DailyEdgeGameDto,
  market: EligibleMarket
): number {
  if (market === "moneyline") return game.predictions.ml.confidence ?? 0;
  if (market === "total") return game.predictions.total.confidence ?? 0;
  return game.predictions.nrfi.confidence ?? 0;
}

function sortAndPickStrongest(
  candidates: DailyEdgeGameDto[],
  market: EligibleMarket
): DailyEdgeGameDto | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const aVerdict = pickMarket(a, market)?.verdict.key ?? "no_play";
    const bVerdict = pickMarket(b, market)?.verdict.key ?? "no_play";
    const verdictRank = VERDICT_RANK[bVerdict] - VERDICT_RANK[aVerdict];
    if (verdictRank !== 0) return verdictRank;
    const aGrade = perMarketGrade(a, market);
    const bGrade = perMarketGrade(b, market);
    const aRank = aGrade !== null ? GRADE_RANK[aGrade] : 0;
    const bRank = bGrade !== null ? GRADE_RANK[bGrade] : 0;
    if (bRank !== aRank) return bRank - aRank;
    const aConf = perMarketConfidence(a, market);
    const bConf = perMarketConfidence(b, market);
    if (bConf !== aConf) return bConf - aConf;
    return a.gameStartMinutes - b.gameStartMinutes;
  });
  return sorted[0] ?? null;
}

function pickMarket(game: DailyEdgeGameDto, market: EligibleMarket) {
  if (market === "moneyline") return game.markets.moneyline;
  if (market === "total") return game.markets.total;
  return game.markets.first_inning;
}

/**
 * Find the strongest game whose verdict is best_angle/lean AND whose
 * headline market matches `market`. Ties broken by per-market grade
 * strength → per-market confidence DESC → earliest game time.
 *
 * Phase 6B.7 — when strict best_angle/lean produces no candidate,
 * an optional `fallbackPool` may be passed. The fallback is consumed
 * with the SAME ranking, so the cell still surfaces a genuinely
 * strong pick when the strict bar is empty for the whole slate.
 * Callers are responsible for building the fallback pool with
 * selectTopAvailableAngles() so the UI labels match the bar that
 * actually qualified each candidate.
 */
export function findBestOfMarket(
  games: DailyEdgeGameDto[],
  market: EligibleMarket,
  options?: { fallbackPool?: DailyEdgeGameDto[] }
): DailyEdgeGameDto | null {
  const strict = games
    .filter(
      (g) =>
        g.breakdown.verdict.key === "best_angle" ||
        g.breakdown.verdict.key === "lean"
    )
    .filter((g) => headlinePrimaryMarket(g) === market);

  const strictPick = sortAndPickStrongest(strict, market);
  if (strictPick !== null) return strictPick;

  const fallbackPool = options?.fallbackPool ?? [];
  const fallback = fallbackPool.filter((g) => headlinePrimaryMarket(g) === market);
  return sortAndPickStrongest(fallback, market);
}

/**
 * Render the headline pick as a compact "Best of" cell hero string:
 *   moneyline → team abbreviation (e.g. "HOU")
 *   total     → "Over 8.5" / "Under" when no line
 *   first_inning_total → "NRFI" / "YRFI"
 */
// Phase 4.2.C.2 — held picks (null) render as "—". Best-of selection
// already filters held games via the verdict gate, so this is defensive
// for any caller that reaches it with a held market.
export function bestOfHeroLabel(
  game: DailyEdgeGameDto,
  market: HeadlineMarket
): string {
  if (market === "moneyline") {
    return game.predictions.ml.pick ?? "—";
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (t.pick === null) return "—";
    return t.line !== null ? `${t.pick} ${t.line}` : t.pick;
  }
  if (market === "first_inning_total") {
    return game.predictions.nrfi.pick ?? "—";
  }
  return "—";
}

/** Confidence for the Best-of cell's metadata line. */
export function bestOfConfidence(
  game: DailyEdgeGameDto,
  market: HeadlineMarket
): number | null {
  if (market === "moneyline") return game.predictions.ml.confidence;
  if (market === "total") return game.predictions.total.confidence;
  if (market === "first_inning_total") return game.predictions.nrfi.confidence;
  return null;
}
