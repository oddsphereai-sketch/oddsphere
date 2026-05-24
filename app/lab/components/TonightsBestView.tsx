"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PlayerPropDto } from "../lib/labTypes";
import type { Sport } from "../data/mockData";
import { getPropTypeMeta, SPORT_META } from "../data/mockData";
import { usePlayerProps } from "../hooks/usePlayerProps";
import { isSlateDate } from "@/lib/dates/slateDate";
import PlayerPropCard from "./PlayerPropCard";

type SortKey = "edge" | "hit_rate" | "line";

const SORT_LABELS: Record<SortKey, string> = {
  edge: "Edge",
  hit_rate: "Hit Rate",
  line: "Line",
};

type Props = {
  sport: Sport;
  propType: string;
  onSelectPlayer: (playerId: string) => void;
};

export default function TonightsBestView({
  sport,
  propType,
  onSelectPlayer,
}: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("edge");
  const isLive = SPORT_META[sport].isLive;

  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const requestedDate = isSlateDate(dateParam) ? dateParam : undefined;

  // Tonight's Best mode: show only premium + strong tiers (per locked Phase 3C
  // decision — tier is a query-time filter). Edge filter at 5% to keep noise out.
  const { data, error, isLoading } = usePlayerProps({
    sport,
    propMarket: propType,
    tiers: ["premium", "strong"],
    minEdge: 0,
    date: requestedDate,
    enabled: isLive,
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const fallbackUsed = !!data?.fallback_used;
  const effectiveDate = data?.date;

  const sorted = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      if (sortBy === "edge") return b.edge - a.edge;
      if (sortBy === "hit_rate") {
        // Hit-rate sort uses fraction (handles sparse history).
        const ra = a.recent10.length > 0 ? a.hitsLast10 / a.recent10.length : 0;
        const rb = b.recent10.length > 0 ? b.hitsLast10 / b.recent10.length : 0;
        return rb - ra;
      }
      return b.line - a.line;
    });
    return copy;
  }, [entries, sortBy]);

  const meta = entries[0]
    ? getPropTypeMeta(entries[0].sport, entries[0].propType)
    : getPropTypeMeta(sport, propType);

  const totalProps = entries.length;
  const positiveEdgeCount = entries.filter((e) => e.edge > 0.1).length;
  // Distinct games covered by the displayed entries.
  const distinctGames = new Set(
    entries.map((e) => `${e.player.team}-${e.player.opponent}`)
  ).size;

  return (
    <div>
      {fallbackUsed && effectiveDate && (
        <div className="mb-4 bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3 text-sm text-amber-100">
          <span className="font-semibold text-amber-200">
            Showing most recent slate ({effectiveDate})
          </span>
          {" — "}
          <span className="text-amber-100/80">
            no graded props for today&rsquo;s slate yet.
          </span>
        </div>
      )}

      {/* Top stats banner */}
      <div className="mb-6 bg-gradient-to-br from-violet-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-violet-300 font-semibold uppercase tracking-wider text-[10px]">
          Today
        </span>
        <span className="text-gray-100 tabular-nums">
          <strong className="font-bold">{distinctGames}</strong> games
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-100 tabular-nums">
          <strong className="font-bold">{totalProps}</strong> player props
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-emerald-300 tabular-nums">
          <strong className="font-bold">{positiveEdgeCount}</strong> with edge &gt; 10%
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
          <span aria-hidden="true" className="mr-2">
            {meta.icon}
          </span>
          <span className="uppercase">{meta.label}</span>{" "}
          <span className="text-gray-400 font-bold">— Tonight</span>
        </h2>
        <label className="inline-flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-gray-400">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="bg-transparent text-white font-semibold focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k} className="bg-gray-900">
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <ErrorState message={error.message} />
      ) : isLoading && entries.length === 0 ? (
        <LoadingSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState propTypeLabel={meta.label} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {sorted.map((entry: PlayerPropDto) => (
            <PlayerPropCard
              key={entry.id}
              entry={entry}
              onClick={() => onSelectPlayer(entry.player.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6 animate-pulse"
          aria-hidden="true"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="space-y-2 flex-1">
              <div className="h-5 w-32 rounded bg-gray-800" />
              <div className="h-3 w-24 rounded bg-gray-800/60" />
            </div>
            <div className="h-8 w-14 rounded bg-gray-800" />
          </div>
          <div className="h-10 rounded bg-gray-800/60 mb-4" />
          <div className="h-4 rounded bg-gray-800/50 mb-2" />
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => (
              <div key={j} className="block w-2.5 h-2.5 rounded-full bg-gray-800" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ propTypeLabel }: { propTypeLabel: string }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-12 text-center text-gray-300">
      <p className="text-base font-medium text-gray-100 mb-1">
        No premium or strong {propTypeLabel.toLowerCase()} plays tonight.
      </p>
      <p className="text-sm text-gray-400">
        Switch to Search &amp; Filter to see every graded prop.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/40 border border-rose-800/50 rounded-xl p-6 text-sm text-rose-100">
      <p className="font-semibold text-rose-200 mb-1">
        Couldn&rsquo;t load tonight&rsquo;s props.
      </p>
      <p className="text-rose-100/80 leading-relaxed">{message}</p>
    </div>
  );
}
