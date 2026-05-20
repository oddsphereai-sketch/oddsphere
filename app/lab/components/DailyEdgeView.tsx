"use client";

import { useState } from "react";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import { getDailyEdgeGames } from "../data/dailyEdgeMockData";
import SportSelector from "./SportSelector";
import ComingSoonState from "./ComingSoonState";
import SimpleDailyEdgeCard from "./SimpleDailyEdgeCard";
import DailyEdgeLegend from "./DailyEdgeLegend";

const DAILY_EDGE_SPORTS: Sport[] = [
  "mlb",
  "nba",
  "nfl",
  "cbb",
  "cfb",
  "nhl",
  "ucl",
];

type Props = {
  sport: Sport;
  onSportChange: (sport: Sport) => void;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getTodayString(): string {
  const now = new Date();
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

export default function DailyEdgeView({ sport, onSportChange }: Props) {
  // Legend visible by default each page load. No persistence (localStorage is
  // out of scope and not reliable here); when user accounts ship we'll
  // remember dismissal per-user.
  const [legendOpen, setLegendOpen] = useState(true);

  const sportMeta = SPORT_META[sport];
  const isMlb = sport === "mlb";
  const games = isMlb ? getDailyEdgeGames("mlb") : [];
  const today = getTodayString();

  return (
    <>
      {legendOpen && (
        <div className="mb-8">
          <DailyEdgeLegend onClose={() => setLegendOpen(false)} />
        </div>
      )}

      <div className="mb-8">
        <SportSelector
          active={sport}
          onChange={onSportChange}
          sports={DAILY_EDGE_SPORTS}
          showCounts={false}
        />
      </div>

      {sportMeta.isLive && isMlb ? (
        <>
          <header className="mb-6 max-w-3xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
              Daily Edge
            </h1>
            <p className="text-sm text-gray-300">
              {today} ·{" "}
              <span className="tabular-nums">{games.length}</span> MLB games
              tonight · sorted by start time
            </p>
          </header>

          <div className="max-w-3xl mx-auto space-y-4 sm:space-y-5">
            {games.map((game) => (
              <SimpleDailyEdgeCard key={game.id} game={game} />
            ))}
          </div>
        </>
      ) : (
        <ComingSoonState sport={sport} />
      )}

      {!legendOpen && (
        <div className="text-center mt-10 max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            Show how to read
          </button>
        </div>
      )}
    </>
  );
}
