"use client";

import { useMemo, useState } from "react";
import type { PropEntry, Signal } from "../data/mockData";
import { getPropTypeMeta, SIGNAL_META } from "../data/mockData";

const MIN_EDGE_OPTIONS = [0, 0.05, 0.1, 0.15] as const;
type MinEdge = (typeof MIN_EDGE_OPTIONS)[number];

const MIN_HR_OPTIONS = [0, 60, 70, 80] as const;
type MinHr = (typeof MIN_HR_OPTIONS)[number];

type SortKey = "player" | "edge" | "hit_rate" | "line";

type Props = {
  entries: PropEntry[];
  onSelectPlayer: (playerId: string) => void;
};

export default function SearchFilterView({ entries, onSelectPlayer }: Props) {
  const [query, setQuery] = useState("");
  const [minEdge, setMinEdge] = useState<MinEdge>(0);
  const [minHr, setMinHr] = useState<MinHr>(0);
  const [signalFilter, setSignalFilter] = useState<Set<Signal>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("edge");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = entries.filter((e) => {
      if (
        q &&
        !e.player.name.toLowerCase().includes(q) &&
        !e.player.team.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (e.edge < minEdge) return false;
      if (e.hitsLast10 * 10 < minHr) return false;
      if (signalFilter.size > 0) {
        const overlap = e.signals.some((s) => signalFilter.has(s));
        if (!overlap) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "player") cmp = a.player.name.localeCompare(b.player.name);
      else if (sortBy === "edge") cmp = a.edge - b.edge;
      else if (sortBy === "hit_rate") cmp = a.hitsLast10 - b.hitsLast10;
      else if (sortBy === "line") cmp = a.line - b.line;
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [entries, query, minEdge, minHr, signalFilter, sortBy, sortDir]);

  function toggleSignal(s: Signal) {
    const next = new Set(signalFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSignalFilter(next);
  }

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortDir(key === "player" || key === "line" ? "asc" : "desc");
    }
  }

  function resetFilters() {
    setQuery("");
    setMinEdge(0);
    setMinHr(0);
    setSignalFilter(new Set());
  }

  const availableSignals = useMemo(() => {
    const set = new Set<Signal>();
    entries.forEach((e) => e.signals.forEach((s) => set.add(s)));
    return Array.from(set);
  }, [entries]);

  return (
    <div className="space-y-5">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍  Search players or teams…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-base text-white placeholder:text-gray-400 focus:outline-none focus:border-violet-500 focus:shadow-[0_0_16px_rgba(167,139,250,0.25)] transition-all"
        />
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 sm:p-5 space-y-4">
        <FilterRow label="Min Edge">
          {MIN_EDGE_OPTIONS.map((v) => (
            <FilterChip
              key={v}
              active={minEdge === v}
              onClick={() => setMinEdge(v)}
            >
              {v === 0 ? "Any" : `${v * 100}%+`}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Hit Rate">
          {MIN_HR_OPTIONS.map((v) => (
            <FilterChip key={v} active={minHr === v} onClick={() => setMinHr(v)}>
              {v === 0 ? "Any" : `${v}%+`}
            </FilterChip>
          ))}
        </FilterRow>

        {availableSignals.length > 0 && (
          <FilterRow label="Signals">
            {availableSignals.map((s) => (
              <FilterChip
                key={s}
                active={signalFilter.has(s)}
                onClick={() => toggleSignal(s)}
              >
                <span aria-hidden="true" className="mr-1">
                  {SIGNAL_META[s].icon}
                </span>
                {SIGNAL_META[s].short}
              </FilterChip>
            ))}
          </FilterRow>
        )}

        <div className="flex items-center justify-between pt-1 text-xs">
          <span className="text-gray-300">
            <strong className="font-bold text-white tabular-nums">
              {filtered.length}
            </strong>{" "}
            of{" "}
            <span className="tabular-nums">{entries.length}</span> props matching
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="text-violet-300 hover:text-violet-200 font-semibold"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="hidden sm:block bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-950/80 text-gray-300 uppercase text-[10px] tracking-wider">
              <tr>
                <ThSortable label="Player" sortKey="player" {...{ sortBy, sortDir, toggleSort }} />
                <th className="text-left py-3 px-4 font-semibold">Game</th>
                <ThSortable label="Line" sortKey="line" align="right" {...{ sortBy, sortDir, toggleSort }} />
                <ThSortable label="Hit Rate" sortKey="hit_rate" align="right" {...{ sortBy, sortDir, toggleSort }} />
                <ThSortable label="Edge" sortKey="edge" align="right" {...{ sortBy, sortDir, toggleSort }} />
                <th className="text-left py-3 px-4 font-semibold">Signals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((e) => (
                <TableRow
                  key={e.id}
                  entry={e}
                  onClick={() => onSelectPlayer(e.player.id)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-gray-300 italic"
                  >
                    No props match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sm:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-8 text-center text-gray-300 italic">
            No props match the current filters.
          </div>
        ) : (
          filtered.map((e) => (
            <CompactRow
              key={e.id}
              entry={e}
              onClick={() => onSelectPlayer(e.player.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold w-20 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-all duration-200 min-h-9 ${
        active
          ? "bg-violet-600 text-white shadow-[0_0_14px_rgba(167,139,250,0.4)]"
          : "bg-gray-800/60 text-gray-300 hover:text-white hover:bg-gray-700/60 border border-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function ThSortable({
  label,
  sortKey,
  align = "left",
  sortBy,
  sortDir,
  toggleSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  toggleSort: (k: SortKey) => void;
}) {
  const active = sortBy === sortKey;
  const arrow = active ? (sortDir === "desc" ? "↓" : "↑") : "";
  return (
    <th
      className={`py-3 px-4 font-semibold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-white ${
          active ? "text-violet-300" : ""
        }`}
      >
        {label}
        {arrow && <span aria-hidden="true">{arrow}</span>}
      </button>
    </th>
  );
}

function TableRow({
  entry,
  onClick,
}: {
  entry: PropEntry;
  onClick: () => void;
}) {
  const meta = getPropTypeMeta(entry.sport, entry.propType);
  const edgePct = entry.edge * 100;
  const edgeColor =
    edgePct > 4 ? "text-emerald-400" : edgePct < -4 ? "text-rose-400" : "text-gray-300";
  return (
    <tr
      className="hover:bg-gray-800/40 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <td className="py-3 px-4 whitespace-nowrap">
        <div className="font-semibold text-white">{entry.player.name}</div>
        <div className="text-xs text-gray-400">
          {entry.player.team} · {entry.player.position}
        </div>
      </td>
      <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
        {entry.player.opponent} · {entry.player.gameTime}
      </td>
      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
        <span className="font-semibold text-violet-200">
          {entry.side === "over" ? "O" : "U"} {entry.line}
        </span>{" "}
        <span className="text-gray-400">{meta.unit}</span>{" "}
        <span className="font-mono text-gray-300">{entry.odds}</span>
      </td>
      <td className="py-3 px-4 text-right tabular-nums text-gray-200 whitespace-nowrap">
        {entry.hitsLast10}/10
      </td>
      <td
        className={`py-3 px-4 text-right tabular-nums font-bold whitespace-nowrap ${edgeColor}`}
      >
        {edgePct > 0 ? "+" : ""}
        {edgePct.toFixed(0)}%
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {entry.signals.length === 0 ? (
            <span className="text-gray-500 text-xs italic">—</span>
          ) : (
            entry.signals.map((s) => (
              <span
                key={s}
                title={SIGNAL_META[s].short}
                className="text-base"
                aria-label={SIGNAL_META[s].short}
              >
                {SIGNAL_META[s].icon}
              </span>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

function CompactRow({
  entry,
  onClick,
}: {
  entry: PropEntry;
  onClick: () => void;
}) {
  const meta = getPropTypeMeta(entry.sport, entry.propType);
  const edgePct = entry.edge * 100;
  const edgeColor =
    edgePct > 4 ? "text-emerald-400" : edgePct < -4 ? "text-rose-400" : "text-gray-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-4 transition-all hover:border-violet-500/50 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{entry.player.name}</p>
          <p className="text-xs text-gray-400">
            {entry.player.team} · {entry.player.opponent} · {entry.player.gameTime}
          </p>
        </div>
        <p className={`text-lg font-black tabular-nums shrink-0 ${edgeColor}`}>
          {edgePct > 0 ? "+" : ""}
          {edgePct.toFixed(0)}%
        </p>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-violet-200">
          {entry.side === "over" ? "O" : "U"} {entry.line} {meta.unit}{" "}
          <span className="font-mono text-gray-400 ml-1">{entry.odds}</span>
        </span>
        <span className="text-gray-300 tabular-nums">
          {entry.hitsLast10}/10
        </span>
      </div>
      {entry.signals.length > 0 && (
        <div className="flex gap-1.5 mt-2">
          {entry.signals.map((s) => (
            <span
              key={s}
              aria-label={SIGNAL_META[s].short}
              title={SIGNAL_META[s].short}
            >
              {SIGNAL_META[s].icon}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
