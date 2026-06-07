"use client";

/**
 * /lab/player-props — Player Props module page (Phase 6.2a).
 *
 * Phase 6B.4 launch override: Player Props ship as Coming Soon for V1.
 * The model isn't ready for member exposure. The full scaffolding
 * (search, drill-down, mode toggle) stays in the file so the post-launch
 * unlock is a single boolean flip — see `PROPS_COMING_SOON` below.
 *
 * Original spec:
 *   Lifted out of the old LabApp section dispatcher. Owns the props-
 *   specific URL state: sport, mode (best / search), prop (sub-market).
 *   Slate date still flows through SlateDatePicker → ?date= URL param
 *   (5E.1 pattern). Mounts PlayerDrillDown as a modal overlay when a
 *   player is selected.
 */

// Phase 6B.4 launch gate. Flip to false when the props model is ready.
const PROPS_COMING_SOON = true;

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Sport } from "../data/mockData";
import { PROP_TYPE_META, SPORT_META } from "../data/mockData";
import SportSelector from "../components/SportSelector";
import PropTabs from "../components/PropTabs";
import ModeToggle, { type Mode } from "../components/ModeToggle";
import TonightsBestView from "../components/TonightsBestView";
import SearchFilterView from "../components/SearchFilterView";
import PlayerDrillDown from "../components/PlayerDrillDown";
import ComingSoonState from "../components/ComingSoonState";
import SlateDatePicker from "../components/SlateDatePicker";
import { useSportSelection } from "../hooks/useSportSelection";

function defaultPropTypeForSport(sport: Sport): string {
  return Object.keys(PROP_TYPE_META[sport])[0] ?? "";
}

function PlayerPropsComingSoon() {
  return (
    <div className="max-w-2xl mx-auto py-12 sm:py-20">
      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-8 sm:p-12">
        <p className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-300 bg-gray-800/60 border border-gray-700 rounded-full px-3 py-1 mb-4">
          Coming soon
        </p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
          Player Props
        </h1>
        <p className="text-base text-gray-200 leading-relaxed mb-6">
          Player-level projections and prop angles are being built into the
          Lab. Full player prop coverage will be added after launch.
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300 mb-3">
          What lands first
        </p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>MLB pitcher strikeouts, hits-allowed, and innings projections</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Batter hits, total bases, and HR angles tied to lineup + matchup</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Best-of-book pricing and edge-vs-market on every prop</span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
            <span>Search + filter across every player on tonight&rsquo;s slate</span>
          </li>
        </ul>
        <p className="text-[11px] text-gray-500 italic mt-6 pt-4 border-t border-gray-800/60">
          Premium members get this at no extra charge when it ships.
        </p>
      </div>
    </div>
  );
}

export default function PlayerPropsPage() {
  if (PROPS_COMING_SOON) {
    return <PlayerPropsComingSoon />;
  }
  return <PlayerPropsLive />;
}

function PlayerPropsLive() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { sport: rawSport, propsSport } = useSportSelection();
  // We re-use propsSport (which falls back to MLB when the URL has a sport
  // outside the Player Props subset). useSportSelection already handles this;
  // `rawSport` is referenced only for the void below to keep eslint happy.
  void rawSport;
  const sportMeta = SPORT_META[propsSport];

  const sportPropTypes = useMemo(
    () => Object.keys(PROP_TYPE_META[propsSport]),
    [propsSport]
  );
  const propTypeParam = searchParams.get("prop");
  const propType =
    propTypeParam && sportPropTypes.includes(propTypeParam)
      ? propTypeParam
      : defaultPropTypeForSport(propsSport);
  const mode: Mode = searchParams.get("mode") === "search" ? "search" : "best";

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const setSport = useCallback(
    (newSport: Sport) => {
      setSelectedPlayer(null);
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("sport", newSport);
      const firstPropType = defaultPropTypeForSport(newSport);
      if (firstPropType) {
        params.set("prop", firstPropType);
      } else {
        params.delete("prop");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <>
      <div className="mb-8">
        <SportSelector active={propsSport} onChange={setSport} />
      </div>

      {sportMeta.isLive ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                <span aria-hidden="true" className="mr-2">
                  {sportMeta.icon}
                </span>
                {sportMeta.label} Player Props
              </h1>
              <p className="text-sm text-gray-300 mt-1">
                Viewing as{" "}
                <span className="text-violet-300">
                  {mode === "best" ? "Tonight's Best" : "Search & Filter"}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SlateDatePicker sport={propsSport} />
              <ModeToggle active={mode} onChange={(m) => setParam("mode", m)} />
            </div>
          </div>

          <div className="mb-8">
            <PropTabs
              sport={propsSport}
              active={propType}
              onChange={(p) => setParam("prop", p)}
            />
          </div>

          {mode === "best" ? (
            <TonightsBestView
              sport={propsSport}
              propType={propType}
              onSelectPlayer={setSelectedPlayer}
            />
          ) : (
            <SearchFilterView
              sport={propsSport}
              propType={propType}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
        </>
      ) : (
        <ComingSoonState sport={propsSport} />
      )}

      {selectedPlayer && (
        <PlayerDrillDown
          sport={propsSport}
          playerId={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  );
}
