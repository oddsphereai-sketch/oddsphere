"use client";

/**
 * DailyEdgeFilters — V2.1 Part 11 chip row above the games list.
 *
 * 15 chips across two visual groupings:
 *   Grades (8): All · Best Signals · Sharp Confirmed · Market-Led ·
 *               Model Only · Market Watch · Public Smoke · Sharp Conflict
 *   Markets (7): Moneyline · Totals · 1st Inning  ·  NRFI · YRFI · Overs · Unders
 *
 * "All" is a reset chip that clears the Grades group; it's visually active
 * when no grade chip is selected (no separate "all selected" state).
 *
 * State + URL persistence live in useDailyEdgeFilters; this component is
 * purely presentational.
 */

import type {
  FilterKey,
  GradeFilter,
  MarketFilter,
  SideFilter,
} from "../hooks/useDailyEdgeFilters";

type Props = {
  filters: Set<FilterKey>;
  toggleFilter: (key: FilterKey) => void;
  clearGradeFilters: () => void;
};

const GRADE_CHIPS: ReadonlyArray<{
  key: GradeFilter;
  label: string;
  emoji: string;
}> = [
  { key: "best_signal", label: "Best Signals", emoji: "🔥" },
  { key: "sharp_confirmed", label: "Sharp Confirmed", emoji: "✅" },
  { key: "market_led", label: "Market-Led", emoji: "⚡" },
  { key: "model_only", label: "Model Only", emoji: "📊" },
  { key: "market_watch", label: "Market Watch", emoji: "👀" },
  { key: "public_smoke", label: "Public Smoke", emoji: "💨" },
  { key: "sharp_conflict", label: "Sharp Conflict", emoji: "⚠️" },
];

const MARKET_CHIPS: ReadonlyArray<{ key: MarketFilter; label: string }> = [
  { key: "moneyline", label: "Moneyline" },
  { key: "totals", label: "Totals" },
  { key: "first_inning", label: "1st Inning" },
];

const SIDE_CHIPS: ReadonlyArray<{ key: SideFilter; label: string }> = [
  { key: "nrfi", label: "NRFI" },
  { key: "yrfi", label: "YRFI" },
  { key: "overs", label: "Overs" },
  { key: "unders", label: "Unders" },
];

export default function DailyEdgeFilters({
  filters,
  toggleFilter,
  clearGradeFilters,
}: Props) {
  const noGradesSelected = GRADE_CHIPS.every((c) => !filters.has(c.key));

  return (
    <div aria-label="Daily Edge filters" className="space-y-2.5">
      <ChipRow label="Grades">
        <Chip label="All" active={noGradesSelected} onClick={clearGradeFilters} />
        {GRADE_CHIPS.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            emoji={c.emoji}
            active={filters.has(c.key)}
            onClick={() => toggleFilter(c.key)}
          />
        ))}
      </ChipRow>

      <ChipRow label="Markets">
        {MARKET_CHIPS.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            active={filters.has(c.key)}
            onClick={() => toggleFilter(c.key)}
          />
        ))}
        <span className="text-gray-700 mx-0.5" aria-hidden="true">
          ·
        </span>
        {SIDE_CHIPS.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            active={filters.has(c.key)}
            onClick={() => toggleFilter(c.key)}
          />
        ))}
      </ChipRow>
    </div>
  );
}

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold mr-1 w-16 shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  label,
  emoji,
  active,
  onClick,
}: {
  label: string;
  emoji?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
        active
          ? "bg-violet-500/20 border-violet-500/50 text-violet-100"
          : "bg-gray-900/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
      }`}
    >
      {emoji && (
        <span aria-hidden="true" className="text-[11px]">
          {emoji}
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}
