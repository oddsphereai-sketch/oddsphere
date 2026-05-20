"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Sport } from "./data/mockData";
import {
  PROP_TYPE_META,
  SPORT_META,
  getPropsByType,
} from "./data/mockData";
import SportSelector from "./components/SportSelector";
import PropTabs from "./components/PropTabs";
import ModeToggle, { type Mode } from "./components/ModeToggle";
import TonightsBestView from "./components/TonightsBestView";
import SearchFilterView from "./components/SearchFilterView";
import PlayerDrillDown from "./components/PlayerDrillDown";
import ComingSoonState from "./components/ComingSoonState";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];

function isSport(v: string | null): v is Sport {
  return !!v && (VALID_SPORTS as string[]).includes(v);
}

function defaultPropTypeForSport(sport: Sport): string {
  return Object.keys(PROP_TYPE_META[sport])[0] ?? "";
}

export default function LabApp() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const sportParam = searchParams.get("sport");
  const sport: Sport = isSport(sportParam) ? sportParam : "mlb";
  const sportMeta = SPORT_META[sport];

  const sportPropTypes = useMemo(
    () => Object.keys(PROP_TYPE_META[sport]),
    [sport]
  );
  const propTypeParam = searchParams.get("prop");
  const propType =
    propTypeParam && sportPropTypes.includes(propTypeParam)
      ? propTypeParam
      : defaultPropTypeForSport(sport);
  const mode: Mode = searchParams.get("mode") === "search" ? "search" : "best";

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const setSport = useCallback(
    (newSport: Sport) => {
      // Close any open drill-down when sport changes — the selectedPlayer id
      // is sport-scoped, not global, so leaving it open would render empty.
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

  const entries = useMemo(
    () => (sportMeta.isLive ? getPropsByType(sport, propType) : []),
    [sport, sportMeta.isLive, propType]
  );

  return (
    <>
      <div className="mb-8">
        <SportSelector active={sport} onChange={setSport} />
      </div>

      {sportMeta.isLive ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-1">
                Research Suite — UI Preview
              </p>
              <p className="text-sm text-gray-300">
                Mocked data for layout and interaction testing.{" "}
                <span className="text-violet-300">
                  {sportMeta.icon} {sportMeta.label}
                </span>{" "}
                · viewing as{" "}
                <span className="text-violet-300">
                  {mode === "best" ? "Tonight's Best" : "Search & Filter"}
                </span>
              </p>
            </div>
            <ModeToggle active={mode} onChange={(m) => setParam("mode", m)} />
          </div>

          <div className="mb-8">
            <PropTabs
              sport={sport}
              active={propType}
              onChange={(p) => setParam("prop", p)}
            />
          </div>

          {mode === "best" ? (
            <TonightsBestView
              sport={sport}
              entries={entries}
              onSelectPlayer={setSelectedPlayer}
            />
          ) : (
            <SearchFilterView
              entries={entries}
              onSelectPlayer={setSelectedPlayer}
            />
          )}
        </>
      ) : (
        <ComingSoonState sport={sport} />
      )}

      {selectedPlayer && (
        <PlayerDrillDown
          sport={sport}
          playerId={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  );
}
