"use client";

import { useMemo, useState } from "react";
import type { PropEntry, Sport } from "../data/mockData";
import { getGlobalStats, getPropTypeMeta } from "../data/mockData";
import PlayerPropCard from "./PlayerPropCard";

type SortKey = "edge" | "hit_rate" | "line";

const SORT_LABELS: Record<SortKey, string> = {
  edge: "Edge",
  hit_rate: "Hit Rate",
  line: "Line",
};

type Props = {
  sport: Sport;
  entries: PropEntry[];
  onSelectPlayer: (playerId: string) => void;
};

export default function TonightsBestView({
  sport,
  entries,
  onSelectPlayer,
}: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("edge");
  const stats = getGlobalStats(sport);

  const sorted = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      if (sortBy === "edge") return b.edge - a.edge;
      if (sortBy === "hit_rate") return b.hitsLast10 - a.hitsLast10;
      return b.line - a.line;
    });
    return copy;
  }, [entries, sortBy]);

  const meta = entries[0]
    ? getPropTypeMeta(entries[0].sport, entries[0].propType)
    : null;

  return (
    <div>
      <div className="mb-6 bg-gradient-to-br from-violet-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-violet-300 font-semibold uppercase tracking-wider text-[10px]">
          Today
        </span>
        <span className="text-gray-100 tabular-nums">
          <strong className="font-bold">{stats.games}</strong> games
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-100 tabular-nums">
          <strong className="font-bold">{stats.props}</strong> player props
        </span>
        <span className="text-gray-500">·</span>
        <span className="text-emerald-300 tabular-nums">
          <strong className="font-bold">{stats.positiveEdge}</strong> with edge &gt; 10%
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        {meta && (
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
            <span aria-hidden="true" className="mr-2">
              {meta.icon}
            </span>
            <span className="uppercase">{meta.label}</span>{" "}
            <span className="text-gray-400 font-bold">— Tonight</span>
          </h2>
        )}
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

      {sorted.length === 0 ? (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-12 text-center text-gray-300">
          No plays meet the criteria for this prop type tonight.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {sorted.map((entry) => (
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
