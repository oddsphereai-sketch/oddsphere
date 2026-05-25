"use client";

/**
 * DailyEdgeSort — V2.1 Part 11 sort dropdown to the right of the filter chip row.
 *
 * Three sort options per spec; default is Start Time (ascending). Other
 * options are evaluated by useDailyEdgeFilters' pure sort transform:
 *   start_time      → gameStartMinutes ascending (default)
 *   signal_strength → grade rank ascending (best_signal first), ML conf desc tiebreaker
 *   confidence      → ML confidence descending
 *
 * State + URL persistence live in useDailyEdgeFilters; this component is
 * purely presentational.
 */

import type { DailyEdgeSortKey } from "../hooks/useDailyEdgeFilters";

const SORT_LABEL: Record<DailyEdgeSortKey, string> = {
  start_time: "Start Time",
  signal_strength: "Signal Strength",
  confidence: "Confidence",
};

type Props = {
  sort: DailyEdgeSortKey;
  setSort: (sort: DailyEdgeSortKey) => void;
};

export default function DailyEdgeSort({ sort, setSort }: Props) {
  return (
    <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold whitespace-nowrap">
      Sort by
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as DailyEdgeSortKey)}
        aria-label="Sort Daily Edge games"
        className="bg-gray-900/60 border border-gray-800 rounded-md px-2 py-1 text-xs text-gray-200 font-medium tracking-normal normal-case focus:outline-none focus:border-violet-500 transition-colors"
      >
        {(Object.keys(SORT_LABEL) as DailyEdgeSortKey[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
