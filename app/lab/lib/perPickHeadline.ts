/**
 * perPickHeadline — derive the row's headline grade + primary market from
 * the per-pick triplets on a DailyEdgeGameDto.
 *
 * Single source of truth for "what's the row's headline" once the legacy
 * game_predictions.grade / signal_type / market_signal / primaryMarket
 * fields are dropped from the DTO in Phase 6.3.5e.
 *
 * Mirrors the ML → OU → NRFI precedence used server-side by
 * marketSignalDerivationService + gradeDerivationService: the first
 * non-null per-pick value wins. Pre-6.3.5e the legacy top-level DTO
 * fields carried this same precedence-1 result via dual-write — these
 * helpers produce identical values from the per-pick fields the DTO
 * still ships, so consumers swap without any behavioral change.
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

/**
 * The market the row's headline grade is "about" — first market with a
 * non-null per-pick grade in ML → OU → NRFI precedence. Returns null
 * when the model didn't pick any of the three markets (defensive — rare
 * in V1 MLB; every game has all 3 picks predicted).
 */
export function headlinePrimaryMarket(g: DailyEdgeGameDto): HeadlineMarket {
  if (g.predictions.ml.grade !== null) return "moneyline";
  if (g.predictions.total.grade !== null) return "total";
  if (g.predictions.nrfi.grade !== null) return "first_inning_total";
  return null;
}

/**
 * The headline grade for the row — first non-null per-pick grade in
 * ML → OU → NRFI precedence. Defensive fallback to "market_watch" matches
 * SimpleDailyEdgeCard's pre-6.3.5e behavior when every per-pick grade
 * was null (slate ran before the grade engine landed).
 */
export function headlineGrade(g: DailyEdgeGameDto): Grade {
  return (
    g.predictions.ml.grade ??
    g.predictions.total.grade ??
    g.predictions.nrfi.grade ??
    "market_watch"
  );
}
