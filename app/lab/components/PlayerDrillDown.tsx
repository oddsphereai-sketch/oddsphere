"use client";

import { useEffect } from "react";
import type { PropEntry, Sport } from "../data/mockData";
import { getPropTypeMeta, SIGNAL_META, getPropsByPlayer } from "../data/mockData";

type Props = {
  sport: Sport;
  playerId: string;
  onClose: () => void;
};

export default function PlayerDrillDown({ sport, playerId, onClose }: Props) {
  const props = getPropsByPlayer(sport, playerId);
  const player = props[0]?.player;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!player) return null;

  const uniqueSignals = Array.from(
    new Set(props.flatMap((p) => p.signals))
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${player.name} — full breakdown`}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative w-full sm:max-w-2xl sm:mx-4 my-0 sm:my-8 bg-gradient-to-br from-gray-900 to-gray-950 border-y sm:border border-gray-800 sm:rounded-2xl shadow-2xl shadow-violet-900/40 max-h-screen sm:max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-gray-950/90 backdrop-blur-md border-b border-gray-800 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight truncate">
              {player.name}
            </h2>
            <p className="text-sm text-gray-300 mt-1">
              {player.team} · {player.position} · {player.opponent} · {player.gameTime}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-gray-300 hover:text-white text-2xl leading-none rounded-md p-2 hover:bg-gray-800 transition-colors min-h-12 min-w-12"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
              Tonight's Props
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {props.map((p) => (
                <DrillPropCard key={p.id} entry={p} />
              ))}
            </div>
          </section>

          {uniqueSignals.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
                Signal Notes
              </h3>
              <ul className="space-y-2 text-sm text-gray-100">
                {uniqueSignals.map((s) => (
                  <li key={s} className="flex gap-2 leading-relaxed">
                    <span aria-hidden="true" className="shrink-0">
                      {SIGNAL_META[s].icon}
                    </span>
                    <span>
                      <strong className="font-semibold">
                        {SIGNAL_META[s].short}:
                      </strong>{" "}
                      <span className="text-gray-200">{SIGNAL_META[s].explain}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="pt-2">
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center text-sm text-violet-300 hover:text-violet-200 font-semibold"
            >
              View full game logs →
            </a>
            <p className="text-[11px] text-gray-500 mt-1 italic">
              (Game-log drill-through coming when we wire up real data.)
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function DrillPropCard({ entry }: { entry: PropEntry }) {
  const meta = getPropTypeMeta(entry.sport, entry.propType);
  const edgePct = entry.edge * 100;
  const edgeColor =
    edgePct > 4
      ? "text-emerald-400"
      : edgePct < -4
      ? "text-rose-400"
      : "text-gray-300";
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-violet-300">
          {meta.icon} {meta.label}
        </span>
        <span className={`text-lg font-black tabular-nums ${edgeColor}`}>
          {edgePct > 0 ? "+" : ""}
          {edgePct.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center justify-between text-sm mb-3">
        <span className="font-semibold text-violet-100">
          {entry.side === "over" ? "O" : "U"} {entry.line} {meta.unit}
        </span>
        <span className="font-mono text-gray-300">{entry.odds}</span>
      </div>
      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-1">
          <span>Last 10</span>
          <span className="font-semibold text-gray-200 tabular-nums normal-case">
            {entry.hitsLast10}/10 ({entry.hitsLast10 * 10}%)
          </span>
        </div>
        <div className="flex gap-1">
          {entry.recent10.map((hit, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`block w-2 h-2 rounded-full ${
                hit ? "bg-violet-400" : "bg-gray-700"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
