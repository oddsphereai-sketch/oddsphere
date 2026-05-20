"use client";

import type { Sport } from "../data/mockData";
import { SPORT_META, getPropCountForSport } from "../data/mockData";

const SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];

type Props = {
  active: Sport;
  onChange: (next: Sport) => void;
};

export default function SportSelector({ active, onChange }: Props) {
  return (
    <div className="-mx-4 sm:mx-0 overflow-x-auto">
      <div
        role="tablist"
        aria-label="Sport"
        className="flex gap-2 px-4 sm:px-0 pb-2 sm:pb-0 sm:grid sm:grid-cols-4 sm:gap-3 min-w-max sm:min-w-0"
      >
        {SPORTS.map((sport) => {
          const meta = SPORT_META[sport];
          const isActive = sport === active;
          const count = getPropCountForSport(sport);

          const base =
            "relative inline-flex flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-5 py-3 sm:py-4 min-h-16 transition-all duration-200";

          const stateClasses = isActive
            ? "bg-violet-600/20 border border-violet-500 text-white shadow-[0_0_20px_rgba(167,139,250,0.25)]"
            : meta.isLive
            ? "bg-gray-900/60 border border-gray-800 text-gray-200 hover:text-white hover:border-violet-500/40 hover:bg-gray-800/60"
            : "bg-gray-900/40 border border-gray-800/60 text-gray-300 opacity-60 hover:opacity-90 hover:border-gray-700";

          return (
            <button
              key={sport}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(sport)}
              className={`${base} ${stateClasses}`}
            >
              <span className="inline-flex items-center gap-2 font-bold text-base sm:text-lg">
                <span className="text-xl sm:text-2xl" aria-hidden="true">
                  {meta.icon}
                </span>
                <span>{meta.label}</span>
              </span>
              {meta.isLive ? (
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    isActive ? "text-violet-200" : "text-gray-400"
                  }`}
                >
                  {count} props
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-gray-400">
                  {meta.comingSoonLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
