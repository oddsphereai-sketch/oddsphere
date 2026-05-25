"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import { useDailyEdge } from "../hooks/useDailyEdge";
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
                  <span className="font-semibold text-gray-100 tabular-nums">
                    {effectiveDate}
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

          {/* V2.1 Part 11 — Tonight's Board summary + Top Reads, both above
              the full games list. Hidden during the initial loading state
              (empty games[]); EmptyState handles the "no games at all" case. */}
          {!isLoading && games.length > 0 && (
            <>
              <TonightsBoard games={games} sportLabel={sportMeta.label} />
              <TopReads games={games} />
            </>
          )}

          <div className="max-w-3xl mx-auto space-y-4 sm:space-y-5">
            {error ? (
              <ErrorState message={error.message} />
            ) : isLoading && games.length === 0 ? (
              <LoadingSkeleton />
            ) : games.length === 0 ? (
              <EmptyState />
            ) : (
              games.map((game) => (
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
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-10 text-center text-gray-300">
      <p className="text-base font-medium text-gray-100 mb-1">
        No games on this slate.
      </p>
      <p className="text-sm text-gray-400">
        Check back after the morning slate refresh, or pick another date.
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
