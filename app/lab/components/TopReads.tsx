"use client";

/**
 * TopReads — V2.1 Part 11 4-up curated card grid above the Daily Edge games list.
 *
 * Four slots: Best Moneyline / Best Total / Best 1st Inning / Biggest Caution.
 *
 * QUALITY FLOOR (6.4c, per founder review): the three "Best" slots only
 * populate when at least one row carries a grade in
 *   { best_signal, sharp_confirmed, market_led }
 * Otherwise the slot renders a "No best moneyline tonight" placeholder so
 * the curation actually means "above the noise floor" rather than "least
 * bad of whatever's in the slate." Biggest Caution requires at least one
 * sharp_conflict row; otherwise "No major conflicts tonight."
 *
 * Selection strategy: take the top THREE distinct high-graded rows (by
 * grade rank, tiebreaker: ML confidence) and assign them to the Best ML /
 * Best Total / Best 1st Inning slots in order. Each slot displays the
 * assigned row's slot-appropriate pick + the row's GradeBadge. The Biggest
 * Caution slot is independent — top sharp_conflict row by ML confidence.
 *
 * Per-slot anchor link scrolls to the full card below via `#game-<id>`.
 */

import { useMemo } from "react";
import Link from "next/link";
import type { Grade } from "@/lib/types/domain/Grade";
import type { DailyEdgeGameDto } from "../lib/labTypes";
import GradeBadge from "@/app/components/GradeBadge";

type Props = {
  games: DailyEdgeGameDto[];
};

const QUALITY_FLOOR = new Set<Grade>([
  "best_signal",
  "sharp_confirmed",
  "market_led",
]);

const GRADE_RANK: Record<Grade, number> = {
  best_signal: 0,
  sharp_confirmed: 1,
  market_led: 2,
  model_only: 3,
  market_watch: 4,
  public_smoke: 5,
  sharp_conflict: 6,
};

type Slot = "best_ml" | "best_total" | "best_first_inning" | "biggest_caution";

type SlotMeta = {
  title: string;
  emptyCopy: string;
};

const SLOT_META: Record<Slot, SlotMeta> = {
  best_ml: { title: "Best Moneyline", emptyCopy: "No best moneyline tonight" },
  best_total: { title: "Best Total", emptyCopy: "No best total tonight" },
  best_first_inning: {
    title: "Best 1st Inning",
    emptyCopy: "No best 1st inning tonight",
  },
  biggest_caution: {
    title: "Biggest Caution",
    emptyCopy: "No major conflicts tonight",
  },
};

type Selections = Record<Slot, DailyEdgeGameDto | null>;

function selectTopReads(games: DailyEdgeGameDto[]): Selections {
  const qualified = games
    .filter((g) => g.grade !== null && QUALITY_FLOOR.has(g.grade))
    .sort((a, b) => {
      const aR = GRADE_RANK[a.grade as Grade];
      const bR = GRADE_RANK[b.grade as Grade];
      if (aR !== bR) return aR - bR;
      return b.predictions.ml.confidence - a.predictions.ml.confidence;
    });

  const cautions = games
    .filter((g) => g.grade === "sharp_conflict")
    .sort((a, b) => b.predictions.ml.confidence - a.predictions.ml.confidence);

  return {
    best_ml: qualified[0] ?? null,
    best_total: qualified[1] ?? null,
    best_first_inning: qualified[2] ?? null,
    biggest_caution: cautions[0] ?? null,
  };
}

/**
 * The pick value the slot displays — pulled from the selected game's
 * predictions object based on which slot is being rendered.
 */
function pickDisplayFor(slot: Slot, game: DailyEdgeGameDto): {
  marketLabel: string;
  pickText: string;
  confidence: number;
} {
  switch (slot) {
    case "best_ml":
      return {
        marketLabel: "Moneyline",
        pickText: `${game.predictions.ml.pick} ML`,
        confidence: game.predictions.ml.confidence,
      };
    case "best_total":
      return {
        marketLabel: "Total",
        pickText: `${game.predictions.total.pick} ${game.predictions.total.line}`,
        confidence: game.predictions.total.confidence,
      };
    case "best_first_inning":
      return {
        marketLabel: "1st Inning",
        pickText: game.predictions.nrfi.pick,
        confidence: game.predictions.nrfi.confidence,
      };
    case "biggest_caution": {
      // Mirror SimpleDailyEdgeCard's deriveCardPrimaryPick precedence so
      // the displayed pick matches the row's headline grade.
      const ml = game.predictions.ml.pick;
      if (ml && ml !== "—") {
        return {
          marketLabel: "Moneyline",
          pickText: `${ml} ML`,
          confidence: game.predictions.ml.confidence,
        };
      }
      return {
        marketLabel: "Total",
        pickText: `${game.predictions.total.pick} ${game.predictions.total.line}`,
        confidence: game.predictions.total.confidence,
      };
    }
  }
}

export default function TopReads({ games }: Props) {
  const selections = useMemo(() => selectTopReads(games), [games]);

  const slotsInOrder: Slot[] = [
    "best_ml",
    "best_total",
    "best_first_inning",
    "biggest_caution",
  ];

  // If the slate is empty entirely, skip the section — DailyEdgeView already
  // shows the EmptyState placeholder for that case.
  if (games.length === 0) return null;

  return (
    <section
      aria-label="Top Reads"
      className="max-w-3xl mx-auto mb-6"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">
          Top Reads
        </h2>
        <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">
          Curated for tonight
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {slotsInOrder.map((slot) => (
          <li key={slot}>
            <TopReadSlot slot={slot} game={selections[slot]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopReadSlot({
  slot,
  game,
}: {
  slot: Slot;
  game: DailyEdgeGameDto | null;
}) {
  const meta = SLOT_META[slot];

  if (game === null) {
    return (
      <div className="h-full bg-gray-900/40 border border-gray-800/60 border-dashed rounded-xl px-4 py-4 flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold">
          {meta.title}
        </p>
        <p className="text-sm text-gray-500 italic">{meta.emptyCopy}</p>
      </div>
    );
  }

  const display = pickDisplayFor(slot, game);
  const displayGrade: Grade = game.grade ?? "market_watch";

  return (
    <Link
      href={`#game-${game.external_id}`}
      className="h-full bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl px-4 py-4 flex flex-col gap-2 hover:border-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-bold">
          {meta.title}
        </p>
        <GradeBadge grade={displayGrade} context="daily-edge" size="sm" />
      </div>
      <p className="text-base font-semibold text-white truncate tracking-tight">
        {display.pickText}
      </p>
      <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
        <span>
          {game.awayTeam} @ {game.homeTeam}
        </span>
        <span className="tabular-nums">
          {Math.round(display.confidence * 100)}%
        </span>
      </div>
    </Link>
  );
}
