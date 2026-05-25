"use client";

/**
 * /lab/player-props — Player Props module page (Phase 6.2a).
 *
 * Lifted out of the old LabApp section dispatcher. Owns the props-specific
 * URL state: sport, mode (best / search), prop (sub-market). Slate date
 * still flows through SlateDatePicker → ?date= URL param (5E.1 pattern).
 *
 * Mounts PlayerDrillDown as a modal overlay when a player is selected.
 * Drill-down state is local (useState) — not URL-routed for V1 since the
 * drill-down doesn't need to be deep-linkable yet (Phase 9+ when My Bets
 * + share-link features land).
 */

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

export default function PlayerPropsPage() {
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
