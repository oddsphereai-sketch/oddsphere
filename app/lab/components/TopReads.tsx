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

/**
 * Empty-state copy refreshed in 6.4d (founder review item 4): "no best X
 * tonight" read as "we don't have anything to show"; the new phrasing makes
 * it clear that nothing currently CLEARS the quality floor, not that data
 * is missing.
 */
const SLOT_META: Record<Slot, SlotMeta> = {
  best_ml: { title: "Best Moneyline", emptyCopy: "No standout moneyline edge" },
  best_total: { title: "Best Total", emptyCopy: "No standout total edge" },
  best_first_inning: {
    title: "Best 1st Inning",
    emptyCopy: "No standout 1st inning edge",
  },
  biggest_caution: {
    title: "Biggest Caution",
    emptyCopy: "No major caution spots",
  },
};

type Selections = Record<Slot, DailyEdgeGameDto | null>;

/**
 * V2.1.1 per-pick Top Reads selection (Phase 6.3.5d core).
 *
 * Pre-6.3.5d: row-level grade picked the top 3 distinct rows for the three
 * "Best" slots, displaying each row's own market pick. A side-effect was
 * that the SAME row's "best market" got priority across all slots —
 * collapsing per-market nuance.
 *
 * Per-pick selection: each slot independently picks the highest-graded
 * PICK ON THAT MARKET across all 12 games. Quality floor still applies
 * (must be in QUALITY_FLOOR). Best Moneyline + Best Total + Best 1st Inning
 * can now share the same game when multiple of its picks qualify, or
 * select different games when the top market reads diverge.
 */
function selectTopReads(games: DailyEdgeGameDto[]): Selections {
  type PickMarket = "ml" | "total" | "nrfi";

  function bestForMarket(market: PickMarket): DailyEdgeGameDto | null {
    const qualified = games
      .filter((g) => {
        const grade = g.predictions[market].grade;
        return grade !== null && QUALITY_FLOOR.has(grade);
      })
      .sort((a, b) => {
        const aGrade = a.predictions[market].grade as Grade;
        const bGrade = b.predictions[market].grade as Grade;
        if (GRADE_RANK[aGrade] !== GRADE_RANK[bGrade]) {
          return GRADE_RANK[aGrade] - GRADE_RANK[bGrade];
        }
        // Tiebreaker: the SAME market's confidence (matches what the slot displays).
        return (
          b.predictions[market].confidence - a.predictions[market].confidence
        );
      });
    return qualified[0] ?? null;
  }

  // Biggest Caution: any game with sharp_conflict on ANY pick. Tiebreaker
  // by the primary pick's confidence (precedence ML → OU → NRFI for the
  // displayed pick; selection just needs a stable rank across candidates).
  const cautions = games
    .filter(
      (g) =>
        g.predictions.ml.grade === "sharp_conflict" ||
        g.predictions.total.grade === "sharp_conflict" ||
        g.predictions.nrfi.grade === "sharp_conflict"
    )
    .sort((a, b) => b.predictions.ml.confidence - a.predictions.ml.confidence);

  return {
    best_ml: bestForMarket("ml"),
    best_total: bestForMarket("total"),
    best_first_inning: bestForMarket("nrfi"),
    biggest_caution: cautions[0] ?? null,
  };
}

/**
 * The pick value the slot displays — pulled from the selected game's
 * predictions object based on which slot is being rendered.
 *
 * V2.1.1 (Phase 6.3.5d core): Biggest Caution now finds the FIRST market
 * with sharp_conflict (precedence ML → OU → NRFI) and displays THAT
 * market's pick. Pre-6.3.5d showed the row's primary pick regardless of
 * which market actually carried the conflict — could mislead members.
 */
function pickDisplayFor(slot: Slot, game: DailyEdgeGameDto): {
  marketLabel: string;
  pickText: string;
  confidence: number;
} {
  function mlDisplay() {
    return {
      marketLabel: "Moneyline",
      pickText: `${game.predictions.ml.pick} ML`,
      confidence: game.predictions.ml.confidence,
    };
  }
  function totalDisplay() {
    // Fix 7.2.5: total.line may be null when no market line is available
    // (manual slate without sharp data + no listed_line). Render the
    // side alone rather than "Under null" or substituting predicted_total.
    const t = game.predictions.total;
    return {
      marketLabel: "Total",
      pickText: t.line !== null ? `${t.pick} ${t.line}` : t.pick,
      confidence: t.confidence,
    };
  }
  function nrfiDisplay() {
    return {
      marketLabel: "1st Inning",
      pickText: game.predictions.nrfi.pick,
      confidence: game.predictions.nrfi.confidence,
    };
  }
  switch (slot) {
    case "best_ml":
      return mlDisplay();
    case "best_total":
      return totalDisplay();
    case "best_first_inning":
      return nrfiDisplay();
    case "biggest_caution": {
      // Find the first market (ML → OU → NRFI precedence) carrying
      // sharp_conflict and display THAT market's pick. The slot's badge
      // (rendered in TopReadSlot) will show sharp_conflict explicitly.
      if (game.predictions.ml.grade === "sharp_conflict") return mlDisplay();
      if (game.predictions.total.grade === "sharp_conflict") return totalDisplay();
      if (game.predictions.nrfi.grade === "sharp_conflict") return nrfiDisplay();
      // Defensive fallback (shouldn't happen — selection requires at least
      // one sharp_conflict pick). Use ML primary-pick display.
      return mlDisplay();
    }
  }
}

/**
 * The grade to badge for a slot — pulled from the SLOT's market on the
 * selected game (not the row-level legacy field). For Biggest Caution
 * the badge always reads sharp_conflict by definition of the slot.
 */
function slotGradeFor(slot: Slot, game: DailyEdgeGameDto): Grade {
  switch (slot) {
    case "best_ml":
      return game.predictions.ml.grade ?? "market_watch";
    case "best_total":
      return game.predictions.total.grade ?? "market_watch";
    case "best_first_inning":
      return game.predictions.nrfi.grade ?? "market_watch";
    case "biggest_caution":
      return "sharp_conflict";
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
      {/* Single-line section header (6.4d founder review item 5): violet
          title + muted gray subtitle on the same line, no float. */}
      <header className="mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">
          Top Reads
          <span className="text-gray-500 font-medium normal-case ml-2 tracking-normal">
            · Curated from today&rsquo;s model + market signals
          </span>
        </h2>
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
    // 6.4d founder review item 4: softer visual treatment so the placeholder
    // reads as "nothing qualifies right now" rather than "data missing."
    return (
      <div className="h-full bg-gray-900/30 border border-gray-800/40 border-dashed rounded-xl px-4 py-4 flex flex-col gap-1 opacity-50">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold">
          {meta.title}
        </p>
        <p className="text-sm text-gray-500 italic">{meta.emptyCopy}</p>
      </div>
    );
  }

  const display = pickDisplayFor(slot, game);
  const displayGrade: Grade = slotGradeFor(slot, game);

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
