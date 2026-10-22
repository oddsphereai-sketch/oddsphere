"use client";

import { useEffect, useMemo, useState } from "react";
import { SportIcon } from "@/app/lab/components/SportIcon";
import { PlayerPropsLeagueLink } from "./PlayerPropsLeagueLink";
import {
  orderPlayerPropsLeagueDefinitions,
  playerPropsLeagueDefinitions,
  playerPropsLeagueHasActiveBoard,
  type PlayerPropsLeagueActivityMap,
} from "../lib/playerPropsLeagues";

export function PlayerPropsLeaguePills({ league, nflEnabled = false, nbaEnabled = false, reviewMode = false, currentGameCount = 0, currentPropCount = 0 }: { league: "mlb" | "nfl" | "nba"; nflEnabled?: boolean; nbaEnabled?: boolean; reviewMode?: boolean; currentGameCount?: number; currentPropCount?: number }) {
  const [activity, setActivity] = useState<PlayerPropsLeagueActivityMap>(() => ({
    [league]: { gameCount: currentGameCount, propCount: currentPropCount, checkedAt: new Date().toISOString() },
  }));
  const [activityLoaded, setActivityLoaded] = useState(reviewMode);
  useEffect(() => {
    if (reviewMode) return;
    const controller = new AbortController();
    void fetch("/api/lab/player-props-league-activity", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("activity request failed")))
      .then((payload: { leagues?: PlayerPropsLeagueActivityMap }) => {
        setActivity((current) => ({ ...current, ...(payload.leagues ?? {}) }));
        setActivityLoaded(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [reviewMode]);
  const leagues = useMemo(() => {
    const definitions = playerPropsLeagueDefinitions({ nflEnabled, nbaEnabled, reviewMode });
    if (reviewMode) return definitions;
    if (!activityLoaded) {
      return [
        ...definitions.filter((item) => item.key === league),
        ...definitions.filter((item) => item.key !== league),
      ];
    }
    return orderPlayerPropsLeagueDefinitions(definitions, activity);
  }, [activity, activityLoaded, league, nbaEnabled, nflEnabled, reviewMode]);

  return <nav aria-label="Player props leagues" className="-mx-4 mb-5 border-y border-white/[0.05] bg-white/[0.015] px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
    <div className="flex gap-2 overflow-x-auto pb-1">
      {leagues.map((item) => {
        const selected = item.key === league;
        const activeBoard = reviewMode ? selected : playerPropsLeagueHasActiveBoard(activity, item.key);
        const status = activeBoard ? "Active" : item.href ? activityLoaded ? "No games today" : "View props" : "Coming soon";
        const contents = <><span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${selected ? "bg-violet-500/[0.22] ring-1 ring-violet-400/40" : "bg-white/[0.04] ring-1 ring-white/[0.06]"}`}><SportIcon sport={item.key} active={selected} /></span><span className="min-w-0"><strong className={`block text-[11px] uppercase ${selected ? "text-white" : "text-gray-300"}`}>{item.label}</strong><span className={`mt-0.5 block text-[9px] ${activeBoard ? "text-emerald-300" : item.href ? "text-gray-400" : "text-gray-500"}`}>{status}</span></span></>;
        const className = `inline-flex min-w-[112px] shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-violet-400/55 bg-violet-500/[0.14]" : item.href ? "border-white/[0.10] bg-white/[0.025] hover:border-violet-400/40 hover:bg-violet-500/[0.08]" : "cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-65"}`;
        return item.href
          ? <PlayerPropsLeagueLink key={item.key} href={item.href} aria-current={selected ? "page" : undefined} aria-label={`${item.label} player props${selected ? ", selected" : ""}${activeBoard ? ", active board" : ""}`} className={className}>{contents}</PlayerPropsLeagueLink>
          : <button key={item.key} type="button" disabled aria-label={`${item.label} player props, coming soon`} className={className}>{contents}</button>;
      })}
    </div>
  </nav>;
}
