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
import { NoPlayStrip } from "./daily-edge/sharedCardParts";
import TonightsMlbEdge from "./daily-edge/TonightsMlbEdge";
import { composeTakeaway } from "../lib/composeTakeaway";
import type { DailyEdgeGameDto } from "../lib/labTypes";
import DailyEdgeLegend from "./DailyEdgeLegend";
import HowWeUpdatePanel from "./HowWeUpdatePanel";
import SlateDatePicker from "./SlateDatePicker";
import SlateFreshness from "./SlateFreshness";
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
                  stays as the original today-with-count phrasing.
                  Fix 7.2.2: split the fallback path into two cases so the
                  copy is honest when a member/operator explicitly picked
                  a non-today date that has no published slate — instead
                  of saying "No finalized board for today" we name the
                  requested date directly. */}
              {fallbackUsed && effectiveDate ? (
                requestedDate && requestedDate !== effectiveDate ? (
                  <p className="text-sm text-gray-300 leading-snug">
                    No published slate for{" "}
                    <span className="font-semibold text-gray-100">
                      {formatSlateDate(requestedDate)}
                    </span>
                    . Showing latest available:{" "}
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
                )
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

          {/* Phase 4.1.8.C-final (B+C Hybrid) — Tonight's MLB Edge briefing
              module. Consolidated curation replaces the prior TonightsBoard
              + TopReads pair into one editorial briefing per Daniel's D4
              decision. Driven by the filtered+sorted game set so chip
              toggles update counts + best-of in lockstep. */}
          {!isLoading && games.length > 0 && (
            <div className="max-w-6xl mx-auto">
              <TonightsMlbEdge
                games={visibleGames}
                slateDate={data?.date ?? ""}
              />
            </div>
          )}

          {/* Phase 4.1.8.C-final (B+C Hybrid) — page-level verdict grouping.
              Tonight's Top Angles (best_angle + lean) render as hero cards
              in a responsive grid; the Rest of the Slate (caution +
              watchlist + no_play) renders in a denser secondary grid below.
              max-w-6xl per Sub-D7 — the page should breathe and feel like
              a premium product, not a narrow list. */}
          <div className="max-w-6xl mx-auto">
            {error ? (
              <ErrorState message={error.message} />
            ) : isLoading && games.length === 0 ? (
              <div className="max-w-3xl mx-auto space-y-4 sm:space-y-5">
                <LoadingSkeleton />
              </div>
            ) : games.length === 0 ? (
              <EmptyState />
            ) : visibleGames.length === 0 ? (
              <FilteredEmptyState hasActiveFilters={hasActiveFilters} />
            ) : (
              <GroupedSlate games={visibleGames} />
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

// ─── Page-level verdict grouping (Phase 4.1.8.C-final) ─────────────────────

type VerdictKey = DailyEdgeGameDto["breakdown"]["verdict"]["key"];

type GroupedGames = Record<VerdictKey, DailyEdgeGameDto[]>;

/**
 * Group games by their server-derived verdict and sort each group by
 * earliest start time. Pure helper — no DOM, no side effects.
 */
function groupGamesByVerdict(games: DailyEdgeGameDto[]): GroupedGames {
  const groups: GroupedGames = {
    best_angle: [],
    lean: [],
    caution: [],
    watchlist: [],
    no_play: [],
  };
  for (const g of games) {
    groups[g.breakdown.verdict.key].push(g);
  }
  for (const k of Object.keys(groups) as VerdictKey[]) {
    groups[k].sort((a, b) => a.gameStartMinutes - b.gameStartMinutes);
  }
  return groups;
}

/**
 * Renders the slate in two editorial sections: "Tonight's Top Angles"
 * (best_angle + lean) and "Rest of the Slate" (caution + watchlist +
 * no_play). Each variant gets the layout density that matches its
 * importance — hero cards in a responsive 1–3 column grid; Caution full-
 * width within its group; Watchlist 2-col on md+; No Play as compact
 * stacked strips.
 */
function GroupedSlate({ games }: { games: DailyEdgeGameDto[] }) {
  const grouped = groupGamesByVerdict(games);
  const topAngles = [...grouped.best_angle, ...grouped.lean];
  const restCount =
    grouped.caution.length + grouped.watchlist.length + grouped.no_play.length;

  // Choose a hero grid breakpoint based on the top-angle count. Avoid
  // empty cells: 1 → centered single-col; 2 → 2-col on md+; 3+ → 3-col
  // on lg+, 2-col on md.
  const heroGridClass =
    topAngles.length === 1
      ? "grid grid-cols-1 gap-4"
      : topAngles.length === 2
      ? "grid grid-cols-1 md:grid-cols-2 gap-4"
      : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";

  const restHeading = topAngles.length > 0 ? "Rest of the Slate" : "Tonight's Slate";

  return (
    <>
      {topAngles.length > 0 && (
        <section className="mb-10">
          <SectionHeading title="Tonight's Top Angles" count={topAngles.length} />
          <div className={heroGridClass}>
            {topAngles.map((game) => (
              <div key={game.id} id={`game-${game.external_id}`}>
                <SimpleDailyEdgeCard game={game} />
              </div>
            ))}
          </div>
        </section>
      )}

      {restCount > 0 && (
        <section>
          <SectionHeading title={restHeading} count={restCount} />

          {/* Caution: full-width, stacked. */}
          {grouped.caution.length > 0 && (
            <div className="space-y-3 mb-4">
              {grouped.caution.map((game) => (
                <div key={game.id} id={`game-${game.external_id}`}>
                  <SimpleDailyEdgeCard game={game} />
                </div>
              ))}
            </div>
          )}

          {/* Watchlist: 2-col on md+, 1-col on mobile. */}
          {grouped.watchlist.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {grouped.watchlist.map((game) => (
                <div key={game.id} id={`game-${game.external_id}`}>
                  <SimpleDailyEdgeCard game={game} />
                </div>
              ))}
            </div>
          )}

          {/* No Play: ultra-compact stacked strips. */}
          {grouped.no_play.length > 0 && (
            <div className="space-y-1.5">
              {grouped.no_play.map((game) => (
                <div key={game.id} id={`game-${game.external_id}`}>
                  <NoPlayStrip game={game} takeaway={composeTakeaway(game)} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-4 pb-2 border-b border-gray-800/40">
      <h2 className="text-[12px] sm:text-[13px] uppercase tracking-[0.16em] font-semibold text-gray-300">
        {title}
      </h2>
      <span className="text-[11px] tabular-nums text-gray-500 font-medium">
        {count}
      </span>
    </div>
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
