"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Sport } from "./data/mockData";
import {
  PROP_TYPE_META,
  SPORT_META,
  getPropsByType,
} from "./data/mockData";
import LabNav, { type LabSection } from "./components/LabNav";
import DailyEdgeView from "./components/DailyEdgeView";
import TrackingView from "./components/TrackingView";
import MyBetsStub from "./components/MyBetsStub";
import SportSelector from "./components/SportSelector";
import PropTabs from "./components/PropTabs";
import ModeToggle, { type Mode } from "./components/ModeToggle";
import TonightsBestView from "./components/TonightsBestView";
import SearchFilterView from "./components/SearchFilterView";
import PlayerDrillDown from "./components/PlayerDrillDown";
import ComingSoonState from "./components/ComingSoonState";

const VALID_SECTIONS: LabSection[] = ["edge", "props", "tracking", "mybets"];
const VALID_SPORTS: Sport[] = [
  "mlb",
  "nba",
  "nfl",
  "cbb",
  "cfb",
  "nhl",
  "ucl",
];

// Sports surfaced inside Player Props (subset of VALID_SPORTS). When the URL
// requests a sport outside this set while section=props, the props subtree
// falls back to MLB for the active highlight.
const PROPS_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];

function isSection(v: string | null): v is LabSection {
  return !!v && (VALID_SECTIONS as string[]).includes(v);
}

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

  const sectionParam = searchParams.get("section");
  const section: LabSection = isSection(sectionParam) ? sectionParam : "edge";

  const sportParam = searchParams.get("sport");
  const sport: Sport = isSport(sportParam) ? sportParam : "mlb";
  const propsSport: Sport =
    section === "props" && !PROPS_SPORTS.includes(sport) ? "mlb" : sport;
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

  const setSection = useCallback(
    (newSection: LabSection) => {
      setSelectedPlayer(null);
      const params = new URLSearchParams();
      params.set("section", newSection);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname]
  );

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

  const entries = useMemo(
    () =>
      section === "props" && sportMeta.isLive
        ? getPropsByType(propsSport, propType)
        : [],
    [section, propsSport, sportMeta.isLive, propType]
  );

  return (
    <>
      <div className="mb-8">
        <LabNav active={section} onChange={setSection} />
      </div>

      {section === "edge" && (
        <DailyEdgeView sport={sport} onSportChange={setSport} />
      )}
      {section === "tracking" && <TrackingView />}
      {section === "mybets" && <MyBetsStub />}

      {section === "props" && (
        <>
          <div className="mb-8">
            <SportSelector active={propsSport} onChange={setSport} />
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
                  sport={propsSport}
                  active={propType}
                  onChange={(p) => setParam("prop", p)}
                />
              </div>

              {mode === "best" ? (
                <TonightsBestView
                  sport={propsSport}
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
            <ComingSoonState sport={propsSport} />
          )}
        </>
      )}

      {section === "props" && selectedPlayer && (
        <PlayerDrillDown
          sport={propsSport}
          playerId={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  );
}
