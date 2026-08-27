"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import { createSportTabActivationGuard } from "../lib/sportTabActivation";

// Player-Props default (4 sports). Daily Edge passes its own 7-sport list.
const DEFAULT_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];

type Props = {
  active: Sport;
  onChange: (next: Sport) => void;
  /** Intent-only route warming; never changes selection or URL state. */
  onPrefetch?: (next: Sport) => void;
  /** Canonical routes that should receive a full dynamic-route prefetch after explicit user intent. */
  fullPrefetchHrefs?: Partial<Record<Sport, string>>;
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
  /** Surface-only labels; useful when one sport key contains competitions. */
  labelOverrides?: Partial<Record<Sport, string>>;
  /** Compact, all-visible tab treatment for constrained reader headers. */
  density?: "default" | "compact";
  /** Activate before an open modal can refresh or unmount beneath the pointer. */
  activateOnPointerDown?: boolean;
};

export default function SportSelector({
  active,
  onChange,
  onPrefetch,
  fullPrefetchHrefs,
  sports = DEFAULT_SPORTS,
  showCounts = true,
  showPendingState = false,
  availability,
  labelOverrides,
  density = "default",
  activateOnPointerDown = false,
}: Props) {
  const [pendingSport, setPendingSport] = useState<Sport | null>(null);
  const [fullPrefetchSport, setFullPrefetchSport] = useState<Sport | null>(null);
  const activationGuard = useRef(createSportTabActivationGuard<Sport>());
  const waitingForSport = pendingSport !== active ? pendingSport : null;

  const compact = density === "compact";

  return (
    <div className={compact ? "w-full" : "-mx-4 overflow-x-auto sm:mx-0"}>
      <div
        role="tablist"
        aria-label="Sport"
        className={compact
          ? "grid w-full grid-cols-5 gap-1"
          : "flex min-w-max gap-2 px-4 pb-2 sm:min-w-0 sm:gap-3 sm:px-0 sm:pb-0"}
      >
        {sports.map((sport) => {
          const meta = SPORT_META[sport];
          const surfaceMeta = availability?.[sport];
          const isLive = surfaceMeta?.isLive ?? meta.isLive;
          const comingSoonLabel = surfaceMeta?.comingSoonLabel ?? meta.comingSoonLabel;
          const statusLabel = surfaceMeta?.statusLabel;
          const isPending = showPendingState && sport === waitingForSport;
          const isActive = sport === (showPendingState ? (waitingForSport ?? active) : active);
          const fullPrefetchHref = sport === active ? null : fullPrefetchHrefs?.[sport] ?? null;

          const activateSport = (next: Sport) => {
            if (next === active || (showPendingState && waitingForSport !== null)) return;
            if (showPendingState) setPendingSport(next);
            onChange(next);
          };

          const base = compact
            ? "relative inline-flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap rounded-lg px-1 py-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 focus-visible:ring-offset-[#100e18]"
            : "relative inline-flex min-h-16 min-w-[120px] flex-shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-4 py-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#100e18] sm:min-w-0 sm:flex-1 sm:flex-shrink sm:px-5 sm:py-4";

          const stateClasses = isActive
            ? "bg-violet-600/20 border border-violet-500 text-white shadow-[0_0_20px_rgba(167,139,250,0.25)]"
            : isLive
            ? "bg-gray-900/60 border border-gray-800 text-gray-200 hover:text-white hover:border-violet-500/40 hover:bg-gray-800/60"
            : "bg-gray-900/40 border border-gray-800/60 text-gray-300 opacity-60 hover:opacity-90 hover:border-gray-700";

          const content = (
            <>
              <span className={compact ? "inline-flex min-w-0 items-center font-black text-[10px]" : "inline-flex items-center gap-2 text-base font-bold sm:text-lg"}>
                {!compact ? <span className="text-xl sm:text-2xl" aria-hidden="true">
                  {meta.icon}
                </span> : null}
                <span>{labelOverrides?.[sport] ?? meta.label}</span>
              </span>
              {isPending ? (
                <span className={compact ? "inline-flex items-center gap-1 text-[7px] font-black uppercase tracking-wide text-violet-200" : "inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-violet-200"}>
                  <span className={compact ? "h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" : "h-2 w-2 animate-pulse rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,0.9)]"} />
                  {compact ? "Open" : "Opening"}
                </span>
              ) : statusLabel ? (
                <span className={`inline-flex items-center font-black uppercase ${compact ? "gap-1 text-[7px] tracking-wide" : "gap-1.5 text-[10px] tracking-wider"} ${statusLabel === "Active" ? "text-emerald-300" : "text-gray-500"}`}>
                  {statusLabel === "Active" ? <span className={compact ? "h-1 w-1 rounded-full bg-emerald-400" : "h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"} /> : null}
                  {compact ? <span className="sr-only">{statusLabel}</span> : statusLabel}
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
            </>
          );

          const onIntent = () => {
            if (!isLive || sport === active) return;
            if (fullPrefetchHref) setFullPrefetchSport(sport);
            onPrefetch?.(sport);
          };

          if (fullPrefetchHref) {
            return (
              <Link
                key={sport}
                href={fullPrefetchHref}
                prefetch={fullPrefetchSport === sport}
                role="tab"
                data-daily-edge-sport-tab={sport}
                aria-selected={isActive}
                aria-busy={isPending}
                onPointerEnter={onIntent}
                onFocus={onIntent}
                onPointerDown={(event) => {
                  if (!activateOnPointerDown || event.button !== 0 || !event.isPrimary) return;
                  activationGuard.current.pointerDown(event, sport, activateSport);
                }}
                onClick={(event) => {
                  event.preventDefault();
                  if (!activateOnPointerDown) {
                    activateSport(sport);
                    return;
                  }
                  activationGuard.current.click(event, sport, activateSport);
                }}
                className={`${base} ${stateClasses}`}
              >
                {content}
              </Link>
            );
          }

          return (
            <button
              key={sport}
              type="button"
              role="tab"
              data-daily-edge-sport-tab={sport}
              aria-selected={isActive}
              aria-busy={isPending}
              onPointerEnter={onIntent}
              onFocus={onIntent}
              onPointerDown={(event) => {
                if (!activateOnPointerDown || event.button !== 0 || !event.isPrimary) return;
                activationGuard.current.pointerDown(event, sport, activateSport);
              }}
              onClick={(event) => {
                if (!activateOnPointerDown) {
                  activateSport(sport);
                  return;
                }
                activationGuard.current.click(event, sport, activateSport);
              }}
              className={`${base} ${stateClasses}`}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
