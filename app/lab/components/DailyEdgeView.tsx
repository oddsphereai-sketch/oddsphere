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
  // Legend visible by default each page load. No persistence (localStorage is
  // out of scope and not reliable here); when user accounts ship we'll
  // remember dismissal per-user.
  const [legendOpen, setLegendOpen] = useState(true);

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
          <header className="mb-6 max-w-3xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
              Daily Edge
            </h1>
            <p className="text-sm text-gray-300">
              {today} ·{" "}
              <span className="tabular-nums">
                {isLoading ? "—" : games.length}
              </span>{" "}
              MLB games tonight · sorted by start time
            </p>
          </header>

          {fallbackUsed && effectiveDate && (
            <div className="max-w-3xl mx-auto mb-4">
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3 text-sm text-amber-100">
                <span className="font-semibold text-amber-200">
                  Showing most recent slate ({effectiveDate})
                </span>
                {" — "}
                <span className="text-amber-100/80">
                  no games scheduled for today&rsquo;s slate yet.
                </span>
              </div>
            </div>
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
                <SimpleDailyEdgeCard key={game.id} game={game} />
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
            Show how to read
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
