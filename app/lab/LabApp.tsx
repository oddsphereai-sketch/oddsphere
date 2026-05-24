"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Sport } from "./data/mockData";
import { PROP_TYPE_META, SPORT_META } from "./data/mockData";
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
import SlateDatePicker from "./components/SlateDatePicker";
import { useSportSelection } from "./hooks/useSportSelection";
import { useRefreshStatus } from "./hooks/useRefreshStatus";

const VALID_SECTIONS: LabSection[] = ["edge", "props", "tracking", "mybets"];

function isSection(v: string | null): v is LabSection {
  return !!v && (VALID_SECTIONS as string[]).includes(v);
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

  const { sport, propsSport } = useSportSelection();
  const sportMeta = SPORT_META[propsSport];

  // Prime the refresh-status SWR cache. The RefreshIndicator (5E) reads the
  // same key; calling here keeps data warm so the badge renders without
  // a fetch the moment 5E lands. Result intentionally unused for 5A.
  useRefreshStatus({ sport });

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
