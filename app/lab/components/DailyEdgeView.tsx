"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import { useDailyEdge } from "../hooks/useDailyEdge";
import {
  useDailyEdgeFilters,
  applyFilterAndSort,
} from "../hooks/useDailyEdgeFilters";
import { isSlateDate } from "@/lib/dates/slateDate";
import SportSelector from "./SportSelector";
import ComingSoonState from "./ComingSoonState";
import SimpleDailyEdgeCard from "./SimpleDailyEdgeCard";
import DailyEdgeLegend from "./DailyEdgeLegend";
import HowWeUpdatePanel from "./HowWeUpdatePanel";
import SlateDatePicker from "./SlateDatePicker";
import SlateFreshness from "./SlateFreshness";
import TonightsBoard from "./TonightsBoard";
import TopReads from "./TopReads";
import DailyEdgeFilters from "./DailyEdgeFilters";
import DailyEdgeSort from "./DailyEdgeSort";

const DAILY_EDGE_SPORTS: Sport[] = [
  "mlb",
  "nba",
  "nfl",
  "cbb",
  "cfb",
  "nhl",
  "ucl",
];

type Props = {
  sport: Sport;
  onSportChange: (sport: Sport) => void;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getTodayString(): string {
  const now = new Date();
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

/**
 * Format a YYYY-MM-DD slate_date string as a human-readable date.
 *   "2026-05-22" → "May 22"        (same year as today)
 *   "2025-12-28" → "Dec 28, 2025"  (cross-year, year shown)
 * Used in the fallback subtitle so the rendered slate date doesn't read as
 * a database string (6.4d founder review item 2).
 */
function formatSlateDate(yyyymmdd: string): string {
  // Anchor at noon to dodge any local TZ rollover ambiguity.
  const d = new Date(`${yyyymmdd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(d);
}

export default function DailyEdgeView({ sport, onSportChange }: Props) {
  // 6.4c: legend collapsed by default per founder review. Returning users
  // shouldn't see the explainer every page load. Phase 7 auth will own
  // per-user "remember dismissal" once accounts ship.
  const [legendOpen, setLegendOpen] = useState(false);

  const sportMeta = SPORT_META[sport];
  const isLive = sportMeta.isLive;

  // 5E.1: read optional ?date= from URL so deep-links to specific slates
  // work. When absent, the hook (and route) default to currentSlateDate in
  // the sport's anchor timezone.
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const requestedDate = isSlateDate(dateParam) ? dateParam : undefined;

  const { data, error, isLoading } = useDailyEdge({
    sport,
    date: requestedDate,
    // Skip the request entirely for sports without coverage — hook returns
    // a placeholder shape; pass a poll interval of 0 to also avoid polling.
    refreshIntervalMs: isLive ? 300_000 : 0,
  });

  const games = data?.games ?? [];
  const fallbackUsed = !!data?.fallback_used;
  const effectiveDate = data?.date;
  const today = getTodayString();

  // 6.4d — filter + sort state lives in the URL via useDailyEdgeFilters.
  // applyFilterAndSort drives the displayed games AND the inputs to the
  // Tonight's Board count chips + Top Reads curation so the entire visible
  // slate reacts to chip toggles in lockstep.
  const { filters, sort, toggleFilter, clearGradeFilters, setSort } =
    useDailyEdgeFilters();
  const visibleGames = useMemo(
    () => applyFilterAndSort(games, { filters, sort }),
    [games, filters, sort]
  );
  const hasActiveFilters = filters.size > 0;

  return (
    <>
      {legendOpen && (
        <div className="mb-8">
          <DailyEdgeLegend onClose={() => setLegendOpen(false)} />
        </div>
      )}

      <div className="mb-8">
        <SportSelector
          active={sport}
          onChange={onSportChange}
          sports={DAILY_EDGE_SPORTS}
          showCounts={false}
        />
      </div>

      {!isLive ? (
        <ComingSoonState sport={sport} />
      ) : (
        <>
          <header className="mb-6 max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
                Daily Edge
              </h1>
              {/* 6.4c: inlined slate message per founder review. When the
                  resolver fell back to an older published slate, the header
                  subtitle carries the full "what is happening / what we're
                  showing instead" copy (V2.1 Part 10 phrase verbatim) and
                  the separate amber banner is dropped. Normal-path header
                  stays as the original today-with-count phrasing. */}
              {fallbackUsed && effectiveDate ? (
                <p className="text-sm text-gray-300 leading-snug">
                  No finalized board for{" "}
                  <span className="font-semibold text-gray-100">{today}</span>{" "}
                  yet. Showing latest available slate:{" "}
                  <span className="font-semibold text-gray-100">
                    {formatSlateDate(effectiveDate)}
                  </span>{" "}
                  ·{" "}
                  <span className="tabular-nums">
                    {isLoading ? "—" : games.length}
                  </span>{" "}
                  {sportMeta.label}{" "}
                  {games.length === 1 ? "game" : "games"}
                </p>
              ) : (
                <p className="text-sm text-gray-300">
                  {today} ·{" "}
                  <span className="tabular-nums">
                    {isLoading ? "—" : games.length}
                  </span>{" "}
                  {sportMeta.label} games tonight · sorted by start time
                </p>
              )}
              <div className="mt-2">
                <SlateFreshness sport={sport} />
              </div>
            </div>
            <SlateDatePicker sport={sport} />
          </header>

          {/* V2.1 Part 11 — Filter chip row + sort dropdown above the
              summary panel so Board counts + Top Reads + the cards list
              all reflect the active filter together. Sort dropdown is
              right-aligned on the same row when space allows. */}
          {!isLoading && games.length > 0 && (
            <div className="max-w-3xl mx-auto mb-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <DailyEdgeFilters
                  filters={filters}
                  toggleFilter={toggleFilter}
                  clearGradeFilters={clearGradeFilters}
                />
              </div>
              <div className="shrink-0 sm:mt-1">
                <DailyEdgeSort sort={sort} setSort={setSort} />
              </div>
            </div>
          )}

          {/* V2.1 Part 11 — Tonight's Board summary + Top Reads, both above
              the full games list. Driven by the filtered+sorted game set so
              chip toggles update counts and curation in lockstep. */}
          {!isLoading && games.length > 0 && (
            <>
              <TonightsBoard
                games={visibleGames}
                sportLabel={sportMeta.label}
              />
              <TopReads games={visibleGames} />
            </>
          )}

          <div className="max-w-3xl mx-auto space-y-4 sm:space-y-5">
            {error ? (
              <ErrorState message={error.message} />
            ) : isLoading && games.length === 0 ? (
              <LoadingSkeleton />
            ) : games.length === 0 ? (
              <EmptyState />
            ) : visibleGames.length === 0 ? (
              <FilteredEmptyState hasActiveFilters={hasActiveFilters} />
            ) : (
              visibleGames.map((game) => (
                <div key={game.id} id={`game-${game.external_id}`}>
                  <SimpleDailyEdgeCard game={game} />
                </div>
              ))
            )}
          </div>

          {/* "How we update this page" lives below the games list — out of
              the way for power users, available for new members. */}
          <HowWeUpdatePanel />
        </>
      )}

      {!legendOpen && (
        <div className="text-center mt-10 max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            How signals work?
          </button>
        </div>
      )}
    </>
  );
}

// ─── Loading skeleton (3 placeholder cards) ─────────────────────────────────

function LoadingSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-4 sm:p-5 animate-pulse"
          aria-hidden="true"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="h-4 w-32 rounded bg-gray-800" />
            <div className="h-6 w-20 rounded-full bg-gray-800" />
          </div>
          <div className="h-8 rounded bg-gray-800/70 mb-4" />
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
            <div className="h-20 rounded-md bg-gray-800/70" />
            <div className="h-20 rounded-md bg-gray-800/70" />
            <div className="h-20 rounded-md bg-gray-800/70" />
          </div>
          <div className="h-6 rounded bg-gray-800/50" />
        </div>
      ))}
    </>
  );
}

function EmptyState() {
  // Copy aligned to SHARP_SIGNAL_FRAMEWORK.md §"Signal Source Quality" — when
  // production data-mode filter (lib/db/productionFilter.ts) drops all rows
  // because only mock-sourced data is available, members see an honest
  // "data not ready" message rather than fake numbers. Same copy in dev
  // covers the off-day / pre-seed case acceptably.
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-10 text-center text-gray-300">
      <p className="text-base font-medium text-gray-100 mb-1">
        Live data hasn&rsquo;t arrived for tonight&rsquo;s slate yet.
      </p>
      <p className="text-sm text-gray-400">
        We&rsquo;ll update once books open and signals load. Or pick another
        date to see prior coverage.
      </p>
    </div>
  );
}

/**
 * Distinct empty state for "the slate has games, but the active filter
 * excludes all of them." V2.1 Part 12 copy rule: what is happening / why /
 * what to do next.
 */
function FilteredEmptyState({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800/60 border-dashed rounded-xl p-8 text-center">
      <p className="text-sm font-medium text-gray-200 mb-1">
        No games match the current filters.
      </p>
      <p className="text-xs text-gray-400">
        {hasActiveFilters
          ? "Tap an active chip to remove it, or pick “All” in Grades to reset."
          : "Try another sort or come back after the next refresh."}
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/40 border border-rose-800/50 rounded-xl p-6 text-sm text-rose-100">
      <p className="font-semibold text-rose-200 mb-1">
        Couldn&rsquo;t load tonight&rsquo;s slate.
      </p>
      <p className="text-rose-100/80 leading-relaxed">{message}</p>
    </div>
  );
}
