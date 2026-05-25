"use client";

/**
 * TonightsBoard — V2.1 Part 11 summary panel above the Daily Edge games list.
 *
 * Counts visible games by grade and renders an inline chip row:
 *   "12 games · 3 Best Signals · 4 Sharp Confirmed · 2 Market-Led · 1 Public Smoke · 1 Conflict"
 *
 * Only nonzero buckets render — empty buckets are omitted so the row stays
 * compact. Order follows V2.1 grade priority (best_signal → sharp_conflict).
 *
 * Pure presentational — reads from the games array supplied by DailyEdgeView's
 * useDailyEdge hook. No fetching of its own.
 */

import { useMemo } from "react";
import type { Grade } from "@/lib/types/domain/Grade";
import type { DailyEdgeGameDto } from "../lib/labTypes";
import { ALL_GRADES } from "@/app/components/GradeBadge";

type Props = {
  games: DailyEdgeGameDto[];
  /** Sport label for the leading "N MLB games" count. */
  sportLabel: string;
};

/**
 * Short chip labels for the Tonight's Board summary. Pluralized; matches
 * the brand voice ("Best Signals" reads as a count, not a category name).
 *
 * SURFACE-SPECIFIC OVERRIDE — market_watch
 *   Everywhere else in the Lab (GradeBadge on cards, filter chip in
 *   DailyEdgeFilters, the legend) the V2.1 Part 6 label "Market Watch" is
 *   used verbatim. In the Tonight's Board SUMMARY, that category is the
 *   bulk-of-the-slate default; "10 Market Watch" reads mechanical, while
 *   "10 Watchlist" reads naturally as a count. The grade itself is still
 *   Market Watch — the override is purely a count-context wording fix and
 *   does NOT touch any other surface (6.4d external review #7).
 */
const CHIP_LABEL: Record<Grade, string> = {
  best_signal: "Best Signals",
  sharp_confirmed: "Sharp Confirmed",
  market_led: "Market-Led",
  model_only: "Model Only",
  market_watch: "Watchlist",
  public_smoke: "Public Smoke",
  sharp_conflict: "Conflict",
};

const CHIP_EMOJI: Record<Grade, string> = {
  best_signal: "🔥",
  sharp_confirmed: "✅",
  market_led: "⚡",
  model_only: "📊",
  market_watch: "👀",
  public_smoke: "💨",
  sharp_conflict: "⚠️",
};

export default function TonightsBoard({ games, sportLabel }: Props) {
  const counts = useMemo(() => {
    const acc: Partial<Record<Grade, number>> = {};
    for (const g of games) {
      // Defensive fallback matches SimpleDailyEdgeCard's null handling — a
      // grade-null game counts as market_watch so the board never silently
      // drops cards from the visible totals.
      const grade: Grade = g.grade ?? "market_watch";
      acc[grade] = (acc[grade] ?? 0) + 1;
    }
    return acc;
  }, [games]);

  if (games.length === 0) return null;

  return (
    <section
      aria-label="Tonight's Board summary"
      className="max-w-3xl mx-auto mb-6 px-4 py-3 sm:px-5 sm:py-3.5 bg-gray-900/50 border border-gray-800 rounded-xl"
    >
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <li className="font-semibold text-white tabular-nums whitespace-nowrap">
          {games.length} {sportLabel}{" "}
          {games.length === 1 ? "game" : "games"}
        </li>
        {ALL_GRADES.map((g) => {
          const count = counts[g];
          if (!count) return null;
          return (
            <li
              key={g}
              className="inline-flex items-center gap-1.5 text-gray-300 whitespace-nowrap before:content-['·'] before:text-gray-600 before:mr-1"
            >
              <span aria-hidden="true">{CHIP_EMOJI[g]}</span>
              <span className="tabular-nums font-medium text-gray-100">
                {count}
              </span>
              <span>{CHIP_LABEL[g]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
