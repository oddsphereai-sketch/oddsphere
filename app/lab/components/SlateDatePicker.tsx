"use client";

/**
 * SlateDatePicker — native <input type="date"> for the Lab's per-page date
 * filter. Updates the ?date= URL param on change; the hooks (useDailyEdge,
 * usePlayerProps, useTracking) already read URL state via useSearchParams
 * from 5E.1, so the picker is the LAST piece that closes the loop.
 *
 * Why native:
 *   • Zero dependencies, instant pageload
 *   • Mobile devices get the OS-native date picker for free
 *   • Accessible by default (keyboard nav, screen reader support)
 *   • Date-format consistency with our slate_date column (YYYY-MM-DD)
 *
 * Style: matches the Lab's pill/chip vocabulary — dark gray border, violet
 * accent on focus. Native input dressing is intentionally minimal; we let
 * the OS render the calendar.
 *
 * Sport prop drives the slate-date timezone math when computing "today's
 * slate" default and the min/max bounds.
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import type { Sport } from "@/lib/types/domain/Sport";
import { currentSlateDate, addDaysToSlate, isSlateDate } from "@/lib/dates/slateDate";

type Props = {
  sport: Sport;
  /** Override the visible label. Defaults to "Date". */
  label?: string;
};

const HISTORICAL_FLOOR = "2025-01-01";

export default function SlateDatePicker({ sport, label = "Date" }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const today = currentSlateDate(sport);
  const max = addDaysToSlate(today, 7);
  const dateParam = searchParams.get("date");
  const value = isSlateDate(dateParam) ? dateParam : today;

  const onChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (!next || next === today) {
        // Clear the param when picking "today" — keeps URLs clean and lets
        // the route fallback do its thing if today's slate is empty.
        params.delete("date");
      } else {
        params.set("date", next);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname, today]
  );

  return (
    <label className="inline-flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs sm:text-sm focus-within:border-violet-500 focus-within:shadow-[0_0_14px_rgba(167,139,250,0.25)] transition-all">
      <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold">
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={HISTORICAL_FLOOR}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-white text-xs sm:text-sm font-medium tabular-nums focus:outline-none [color-scheme:dark]"
      />
      {dateParam && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="text-[10px] uppercase tracking-wider text-violet-300 hover:text-violet-200 font-bold"
          aria-label="Reset to today"
        >
          Today
        </button>
      )}
    </label>
  );
}
