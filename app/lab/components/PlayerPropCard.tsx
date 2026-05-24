"use client";

import type { PlayerPropDto } from "../lib/labTypes";
import type { Signal } from "../data/mockData";
import { getPropTypeMeta, SIGNAL_META } from "../data/mockData";

type Props = {
  entry: PlayerPropDto;
  onClick: () => void;
};

export default function PlayerPropCard({ entry, onClick }: Props) {
  const meta = getPropTypeMeta(entry.sport, entry.propType);
  const edgePct = entry.edge * 100;
  const edgeColor =
    edgePct > 4
      ? "text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.45)]"
      : edgePct < -4
      ? "text-rose-400"
      : "text-gray-300";
  const edgeSign = edgePct > 0 ? "+" : "";

  // Honest last-N display: server returns up to 10 resolved outcomes. Show
  // the actual sample size rather than fabricating a /10 denominator when
  // history is sparse.
  const sample = entry.recent10.length;
  const hitPct = sample > 0 ? Math.round((entry.hitsLast10 / sample) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left w-full bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6 transition-all duration-300 hover:border-violet-500/60 hover:shadow-[0_0_30px_rgba(167,139,250,0.18)] hover:-translate-y-0.5 active:scale-[0.99] focus-visible:outline-none focus-visible:border-violet-400 focus-visible:shadow-[0_0_24px_rgba(167,139,250,0.45)]"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold tracking-tight truncate">
            {entry.player.name}
          </h3>
          <p className="text-sm text-gray-300">
            {entry.player.team} · {entry.player.position} · {entry.player.opponent}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{entry.player.gameTime}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-3xl font-black tabular-nums leading-none ${edgeColor}`}
          >
            {edgeSign}
            {edgePct.toFixed(0)}%
          </p>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
            Edge
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-800 pt-4 mb-4">
        <span className="inline-flex items-center gap-1 bg-violet-900/40 border border-violet-700/50 rounded-full px-3 py-1 text-xs sm:text-sm font-semibold text-violet-100 whitespace-nowrap">
          {entry.side === "over" ? "O" : "U"} {entry.line} {meta.unit}
        </span>
        <span className="text-sm font-mono tabular-nums text-gray-200">
          {entry.odds}
        </span>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            {sample === 0 ? "No History" : `Last ${sample}`}
          </span>
          <span className="text-xs font-semibold text-gray-200 tabular-nums">
            {sample === 0
              ? "—"
              : `${entry.hitsLast10}/${sample} (${hitPct}%)`}
          </span>
        </div>
        <div className="flex gap-1.5">
          {entry.recent10.length === 0 ? (
            <span className="text-[11px] text-gray-500 italic">
              Resolved history not yet available for this prop.
            </span>
          ) : (
            entry.recent10.map((hit, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`block w-2.5 h-2.5 rounded-full ${
                  hit
                    ? "bg-violet-400 shadow-[0_0_4px_rgba(167,139,250,0.5)]"
                    : "bg-gray-700"
                }`}
              />
            ))
          )}
        </div>
      </div>

      {entry.signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {entry.signals.slice(0, 3).map((s) => {
            const meta = SIGNAL_META[s as Signal];
            if (!meta) return null;
            return (
              <span
                key={s}
                title={meta.explain}
                className="inline-flex items-center gap-1 bg-gray-800/70 border border-gray-700 rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-100"
              >
                <span aria-hidden="true">{meta.icon}</span>
                {meta.short}
              </span>
            );
          })}
          {entry.signals.length > 3 && (
            <span
              title={entry.signals.slice(3).join(", ")}
              className="inline-flex items-center bg-gray-900/60 border border-gray-800 rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-400"
            >
              +{entry.signals.length - 3} more
            </span>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400 group-hover:text-violet-300 transition-colors">
        Tap for full breakdown →
      </p>
    </button>
  );
}
