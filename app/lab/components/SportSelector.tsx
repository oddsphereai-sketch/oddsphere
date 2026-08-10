"use client";

import { useState } from "react";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";

// Player-Props default (4 sports). Daily Edge passes its own 7-sport list.
const DEFAULT_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];

type Props = {
  active: Sport;
  onChange: (next: Sport) => void;
  sports?: Sport[];
  /** Optional surface-specific rollout labels. Omitted callers retain SPORT_META exactly. */
  availability?: Partial<Record<Sport, { isLive: boolean; comingSoonLabel?: string; statusLabel?: string }>>;
  /**
   * Whether to show the per-sport prop count under live sports. Daily Edge
   * doesn't surface prop counts at the sport-selector level, so it can hide
   * them. Player Props (the original caller) keeps them visible by default.
   */
  showCounts?: boolean;
  /** Opt-in optimistic feedback while a surface loads its next sport snapshot. */
  showPendingState?: boolean;
};

export default function SportSelector({
  active,
  onChange,
  sports = DEFAULT_SPORTS,
  showCounts = true,
  showPendingState = false,
  availability,
}: Props) {
  const [pendingSport, setPendingSport] = useState<Sport | null>(null);
  const waitingForSport = pendingSport !== active ? pendingSport : null;

  return (
    <div className="-mx-4 sm:mx-0 overflow-x-auto">
      <div
        role="tablist"
        aria-label="Sport"
        className="flex gap-2 px-4 sm:px-0 pb-2 sm:pb-0 sm:gap-3 min-w-max sm:min-w-0"
      >
        {sports.map((sport) => {
          const meta = SPORT_META[sport];
          const surfaceMeta = availability?.[sport];
          const isLive = surfaceMeta?.isLive ?? meta.isLive;
          const comingSoonLabel = surfaceMeta?.comingSoonLabel ?? meta.comingSoonLabel;
          const statusLabel = surfaceMeta?.statusLabel;
          const isPending = showPendingState && sport === waitingForSport;
          const isActive = sport === (showPendingState ? (waitingForSport ?? active) : active);

          const base =
            "relative flex-shrink-0 sm:flex-1 sm:flex-shrink min-w-[120px] sm:min-w-0 inline-flex flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-4 sm:px-5 py-3 sm:py-4 min-h-16 transition-all duration-200";

          const stateClasses = isActive
            ? "bg-violet-600/20 border border-violet-500 text-white shadow-[0_0_20px_rgba(167,139,250,0.25)]"
            : isLive
            ? "bg-gray-900/60 border border-gray-800 text-gray-200 hover:text-white hover:border-violet-500/40 hover:bg-gray-800/60"
            : "bg-gray-900/40 border border-gray-800/60 text-gray-300 opacity-60 hover:opacity-90 hover:border-gray-700";

          return (
            <button
              key={sport}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-busy={isPending}
              onClick={() => {
                if (sport === active || (showPendingState && waitingForSport !== null)) return;
                if (showPendingState) setPendingSport(sport);
                onChange(sport);
              }}
              className={`${base} ${stateClasses}`}
            >
              <span className="inline-flex items-center gap-2 font-bold text-base sm:text-lg">
                <span className="text-xl sm:text-2xl" aria-hidden="true">
                  {meta.icon}
                </span>
                <span>{meta.label}</span>
              </span>
              {isPending ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-violet-200">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,0.9)]" />
                  Opening
                </span>
              ) : statusLabel ? (
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${statusLabel === "Active" ? "text-emerald-300" : "text-gray-500"}`}>
                  {statusLabel === "Active" ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" /> : null}
                  {statusLabel}
                </span>
              ) : isLive ? (
                showCounts ? (
                  <span
                    className={`text-[10px] uppercase tracking-wider ${
                      isActive ? "text-violet-200" : "text-gray-400"
                    }`}
                  >
                    Live tonight
                  </span>
                ) : null
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-gray-400">
                  {comingSoonLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
