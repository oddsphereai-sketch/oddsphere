"use client";

import { useEffect } from "react";
import type { PlayerPropDto } from "../lib/labTypes";
import type { Signal, Sport } from "../data/mockData";
import { getPropTypeMeta, SIGNAL_META } from "../data/mockData";
import { usePlayerProps } from "../hooks/usePlayerProps";

type Props = {
  sport: Sport;
  playerId: string;
  onClose: () => void;
};

export default function PlayerDrillDown({ sport, playerId, onClose }: Props) {
  // Decision E: PlayerDrillDown reads from prop_predictions for this player.
  // We reuse the player-props endpoint with ?player_id=X — same shape, server
  // does the joins, history is included via recent10/hitsLast10.
  const { data, error, isLoading } = usePlayerProps({
    sport,
    playerId,
  });
  const entries = data?.entries ?? [];
  const player = entries[0]?.player;

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

  const uniqueSignals = Array.from(
    new Set(entries.flatMap((p) => p.signals))
  ) as Signal[];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${player?.name ?? "Player"} — full breakdown`}
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
              {player?.name ?? (isLoading ? "Loading…" : "Player")}
            </h2>
            {player && (
              <p className="text-sm text-gray-300 mt-1">
                {player.team} · {player.position} · {player.opponent} · {player.gameTime}
              </p>
            )}
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
          {error ? (
            <ErrorState message={error.message} />
          ) : isLoading && entries.length === 0 ? (
            <SkeletonGrid />
          ) : entries.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
                  Tonight&rsquo;s Props
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {entries.map((p) => (
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
                    {uniqueSignals.map((s) => {
                      const meta = SIGNAL_META[s];
                      if (!meta) return null;
                      return (
                        <li key={s} className="flex gap-2 leading-relaxed">
                          <span aria-hidden="true" className="shrink-0">
                            {meta.icon}
                          </span>
                          <span>
                            <strong className="font-semibold">
                              {meta.short}:
                            </strong>{" "}
                            <span className="text-gray-200">{meta.explain}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="pt-2">
                <p className="text-[11px] text-gray-500 italic">
                  Per-prop game logs coming in Phase 6.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DrillPropCard({ entry }: { entry: PlayerPropDto }) {
  const meta = getPropTypeMeta(entry.sport, entry.propType);
  const edgePct = entry.edge * 100;
  const edgeColor =
    edgePct > 4
      ? "text-emerald-400"
      : edgePct < -4
      ? "text-rose-400"
      : "text-gray-300";
  const sample = entry.recent10.length;
  const hitPct = sample > 0 ? Math.round((entry.hitsLast10 / sample) * 100) : 0;
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
      {entry.signals.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {entry.signals.slice(0, 3).map((s) => {
            const m = SIGNAL_META[s as Signal];
            if (!m) return null;
            return (
              <span
                key={s}
                title={m.explain}
                className="inline-flex items-center gap-1 bg-gray-800/60 border border-gray-700/70 rounded-full px-2 py-0.5 text-[10px] font-medium text-gray-200"
              >
                <span aria-hidden="true">{m.icon}</span>
                {m.short}
              </span>
            );
          })}
          {entry.signals.length > 3 && (
            <span className="inline-flex items-center text-[10px] text-gray-400 font-medium px-1">
              +{entry.signals.length - 3}
            </span>
          )}
        </div>
      )}
      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-1">
          <span>{sample === 0 ? "No History" : `Last ${sample}`}</span>
          <span className="font-semibold text-gray-200 tabular-nums normal-case">
            {sample === 0 ? "—" : `${entry.hitsLast10}/${sample} (${hitPct}%)`}
          </span>
        </div>
        <div className="flex gap-1">
          {sample === 0 ? (
            <span className="text-[10px] text-gray-500 italic">
              No resolved predictions yet.
            </span>
          ) : (
            entry.recent10.map((hit, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`block w-2 h-2 rounded-full ${
                  hit ? "bg-violet-400" : "bg-gray-700"
                }`}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 animate-pulse"
          aria-hidden="true"
        >
          <div className="h-4 w-20 rounded bg-gray-800 mb-3" />
          <div className="h-8 rounded bg-gray-800/70 mb-3" />
          <div className="h-3 rounded bg-gray-800/50" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-8 text-center text-gray-300">
      <p className="text-sm">No props for this player tonight.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg p-4 text-sm text-rose-100">
      <p className="font-semibold text-rose-200 mb-1">Couldn&rsquo;t load player history.</p>
      <p className="text-rose-100/80 leading-relaxed">{message}</p>
    </div>
  );
}
