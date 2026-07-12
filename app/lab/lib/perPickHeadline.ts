/**
 * perPickHeadline — derive the row's headline grade + primary market from
 * the per-pick triplets on a DailyEdgeGameDto.
 *
 * Single source of truth for "what's the row's headline" once the legacy
 * game_predictions.grade / signal_type / market_signal / primaryMarket
 * fields are dropped from the DTO in Phase 6.3.5e.
 *
 * V2.1.1 fix (Phase 6.3.5e-fix-2): selection is RANK-BASED — the strongest
 * grade across the per-pick triplet drives the headline, with ML → OU →
 * NRFI as the precedence tiebreaker for equal grades. Pre-fix the headline
 * used pure first-non-null precedence (ML → OU → NRFI) which buried strong
 * grades on totals / NRFI under a weaker ML grade. Real-slate example:
 * WSH @ ATL had ML=market_watch + Total=sharp_conflict; pre-fix headline
 * read "Market Watch · Moneyline" while the Pick Breakdown showed the
 * sharp_conflict on the total. The contradiction obscured the most
 * notable signal on the card.
 *
 * Used by:
 *   • SimpleDailyEdgeCard headline GradeBadge (displayGrade + market
 *     suffix)
 *   • useDailyEdgeFilters sort path (gradeFromGame) + market chip
 *     predicate
 *
 * Player Props (Phase 6.5) will likely need its own headline derivation
 * once that surface ships — props are per-pick by table shape so the
 * derivation may collapse to identity. Keeping this module focused on
 * the Daily Edge per-market row case avoids cross-pollination.
 */

import type { Grade } from "@/lib/types/domain/Grade";
import type { DailyEdgeGameDto } from "./labTypes";

export type HeadlineMarket = "moneyline" | "total" | "first_inning_total" | null;
type Verdict = DailyEdgeGameDto["breakdown"]["verdict"]["key"];

/**
 * V2.1 GRADE_RANK — higher = stronger headline. Mirrors the V2.1 spec
 * "signal strength" ordering. sharp_conflict ranks above market_led /
 * public_smoke / model_only / market_watch because cautions are a load-
 * bearing UX signal: a beginner glancing at the headline should see the
 * fade ahead of the noisier middle grades.
 */
const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

type Candidate = { market: HeadlineMarket; grade: Grade; precedence: number };
type VerdictCandidate = { market: HeadlineMarket; verdict: Verdict; precedence: number };

const VERDICT_RANK: Record<Verdict, number> = {
  best_angle: 50,
  lean: 40,
  caution: 30,
  watchlist: 20,
  no_play: 10,
};

/**
 * Build the per-pick candidate list and sort by (rank DESC, precedence ASC).
 * Candidates with null grade are excluded — they have no headline contribution.
 * Tiebreaker: ML → OU → NRFI precedence preserves the pre-fix headline for
 * cards where ML carries the strongest grade (which is the common case from
 * the seed slate's 6.3.5d core 4 "sharp_confirmed on ML" pattern).
 */
function rankedCandidates(g: DailyEdgeGameDto): Candidate[] {
  const out: Candidate[] = [];
  if (g.predictions.ml.grade !== null) {
    out.push({
      market: "moneyline",
      grade: g.predictions.ml.grade,
      precedence: 0,
    });
  }
  if (g.predictions.total.grade !== null) {
    out.push({
      market: "total",
      grade: g.predictions.total.grade,
      precedence: 1,
    });
  }
  if (g.predictions.nrfi.grade !== null) {
    out.push({
      market: "first_inning_total",
      grade: g.predictions.nrfi.grade,
      precedence: 2,
    });
  }
  out.sort((a, b) => {
    const r = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });
  return out;
}

function rankedVerdictCandidates(g: DailyEdgeGameDto): VerdictCandidate[] {
  const candidates: VerdictCandidate[] = [
    { market: "moneyline", verdict: g.markets.moneyline.verdict.key, precedence: 0 },
    { market: "total", verdict: g.markets.total.verdict.key, precedence: 1 },
    { market: "first_inning_total", verdict: g.markets.first_inning.verdict.key, precedence: 2 },
  ];
  const out = candidates.filter((candidate) => candidate.verdict !== "no_play");
  out.sort((a, b) => {
    const r = VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });
  return out;
}

/**
 * The market the row's headline grade is "about" — the market carrying the
 * strongest grade across the per-pick triplet, with ML → OU → NRFI as the
 * tiebreaker for equal-strength grades. Returns null when the model didn't
 * pick any of the three markets (defensive — rare in V1 MLB; every game
 * has all 3 picks predicted).
 */
export function headlinePrimaryMarket(g: DailyEdgeGameDto): HeadlineMarket {
  const verdictMarket = rankedVerdictCandidates(g)[0]?.market;
  if (verdictMarket !== undefined) return verdictMarket;
  return rankedCandidates(g)[0]?.market ?? null;
}

/**
 * The headline grade for the row — strongest per-pick grade across the
 * triplet, ML → OU → NRFI precedence on ties.
 *
 * Returns `null` when every per-pick grade is null (the model didn't pick
 * any of the three markets). Consumers render this as "No Pick" /
 * "Unavailable" per SHARP_SIGNAL_FRAMEWORK.md §"Edge Case Handling —
 * Model didn't pick the market": "Rendering Market Watch when no model
 * pick exists falsely implies there IS market activity worth watching.
 * 'No Pick' is the honest representation."
 *
 * Fix 1.3 (Gap-21): dropped the pre-fix `?? "market_watch"` coercion.
 * Pre-fix, every all-null row appeared as Market Watch in the headline;
 * post-fix, the UI renders an honest "No Pick" treatment via GradeBadge's
 * null-grade variant.
 */
export function headlineGrade(g: DailyEdgeGameDto): Grade | null {
  return rankedCandidates(g)[0]?.grade ?? null;
}
