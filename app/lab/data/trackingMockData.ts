// UI-only mock data for the Tracking section. Sport × Market × Time-Window
// matrix mirroring Daniel's real spreadsheet. W/L only — no units, no profit,
// no ROI.

import type { Sport } from "./mockData";

export type Market = string;

type WindowTally = { wins: number; total: number; hitRate: number };

export type SportMarketTally = {
  sport: Sport;
  market: Market;
  lifetime: WindowTally;
  currentSeason: WindowTally | null;
  weekly: WindowTally | null;
};

export type DailyMarketResult = {
  sport: Sport;
  market: Market;
  wins: number;
  total: number;
};

export type DailyRecap = {
  date: string;
  results: DailyMarketResult[];
  totalPicks: number;
  totalWins: number;
  hitRate: number;
};

export type DailyHitRatePoint = {
  date: string;
  picks: number;
  wins: number;
  hitRate: number;
};

export type SportSummary = {
  sport: Sport;
  totalLifetime: number;
  winsLifetime: number;
  hitRateLifetime: number;
  totalWeekly: number;
  winsWeekly: number;
  hitRateWeekly: number;
};

// ----- Helpers

function w(wins: number, total: number): WindowTally {
  return { wins, total, hitRate: total > 0 ? wins / total : 0 };
}

// ----- Sport × Market tallies (lifetime · current season · weekly)

export const ALL_TALLIES: SportMarketTally[] = [
  // NFL — offseason, no current or weekly
  { sport: "nfl", market: "ML",  lifetime: w(181, 284), currentSeason: null, weekly: null },
  { sport: "nfl", market: "O/U", lifetime: w(155, 285), currentSeason: null, weekly: null },

  // CFB — offseason
  { sport: "cfb", market: "ML",  lifetime: w(708, 923), currentSeason: null, weekly: null },
  { sport: "cfb", market: "O/U", lifetime: w(493, 923), currentSeason: null, weekly: null },

  // NBA — current season + recent weekly activity
  { sport: "nba", market: "ML",  lifetime: w(1391, 2003), currentSeason: w(916, 1333), weekly: w(4, 7) },
  { sport: "nba", market: "O/U", lifetime: w(700, 1319),  currentSeason: w(700, 1319), weekly: w(6, 7) },

  // CBB — late current season, no weekly activity
  { sport: "cbb", market: "ML",  lifetime: w(4624, 6444), currentSeason: w(3962, 5480), weekly: null },
  { sport: "cbb", market: "O/U", lifetime: w(2884, 5404), currentSeason: w(2925, 5480), weekly: null },

  // MLB — full activity across all markets
  { sport: "mlb", market: "ML",        lifetime: w(1524, 2684), currentSeason: w(321, 606), weekly: w(51, 92) },
  { sport: "mlb", market: "NRFI/YRFI", lifetime: w(1277, 2247), currentSeason: w(267, 496), weekly: w(34, 68) },
  { sport: "mlb", market: "NRFI",      lifetime: w(546, 969),   currentSeason: w(152, 281), weekly: w(22, 40) },
  { sport: "mlb", market: "YRFI",      lifetime: w(419, 734),   currentSeason: w(115, 215), weekly: w(12, 28) },
  { sport: "mlb", market: "O/U",       lifetime: w(1096, 1989), currentSeason: w(324, 606), weekly: w(46, 92) },

  // UCL — late current season, no weekly
  { sport: "ucl", market: "ML",            lifetime: w(100, 174), currentSeason: w(5, 8), weekly: null },
  { sport: "ucl", market: "Double Chance", lifetime: w(129, 174), currentSeason: w(6, 8), weekly: null },

  // NHL — current season + weekly
  { sport: "nhl", market: "ML",  lifetime: w(22, 44), currentSeason: w(22, 44), weekly: w(5, 7) },
  { sport: "nhl", market: "O/U", lifetime: w(28, 44), currentSeason: w(28, 44), weekly: w(3, 7) },
];

// Display order for sports in the All-Time Record table.
export const SPORT_DISPLAY_ORDER: Sport[] = [
  "mlb",
  "nba",
  "cbb",
  "nfl",
  "cfb",
  "nhl",
  "ucl",
];

// ----- Yesterday's recap: May 19, 2026
// 6 sport×market results, 41 picks, 30 wins, 73.2%

const YESTERDAY_DATE = "2026-05-19";
const YESTERDAY_LABEL = "May 19";

const YESTERDAY_RESULTS: DailyMarketResult[] = [
  { sport: "nba", market: "ML",   wins: 1,  total: 1  },
  { sport: "nba", market: "O/U",  wins: 1,  total: 1  },
  { sport: "mlb", market: "ML",   wins: 9,  total: 15 },
  { sport: "mlb", market: "NRFI", wins: 2,  total: 4  },
  { sport: "mlb", market: "YRFI", wins: 5,  total: 5  },
  { sport: "mlb", market: "O/U",  wins: 12, total: 15 },
];

// ----- 30-day rolling hit rate. Constraints from product spec:
//   • Day 30 (May 19) = 30/41 (73.2%) — matches yesterday recap, best day
//   • Day 26 (May 15) = 12/33 (36.4%) — worst day
//   • Day 25 (May 14) = 26/47 (55.3%) — most picks
//   • Average ~30 picks/day, ~58% hit rate

const LAST_30_RAW: Array<[string, number, number]> = [
  // [date, picks, wins]
  ["2026-04-20", 28, 17],
  ["2026-04-21", 24, 14],
  ["2026-04-22", 31, 19],
  ["2026-04-23", 22, 11],
  ["2026-04-24", 35, 22],
  ["2026-04-25", 26, 17],
  ["2026-04-26", 29, 15],
  ["2026-04-27", 33, 20],
  ["2026-04-28", 18, 11],
  ["2026-04-29", 27, 18],
  ["2026-04-30", 31, 14],
  ["2026-05-01", 25, 16],
  ["2026-05-02", 28, 17],
  ["2026-05-03", 34, 18],
  ["2026-05-04", 22, 14],
  ["2026-05-05", 30, 14],
  ["2026-05-06", 26, 17],
  ["2026-05-07", 32, 18],
  ["2026-05-08", 24, 15],
  ["2026-05-09", 38, 22],
  ["2026-05-10", 27, 16],
  ["2026-05-11", 29, 19],
  ["2026-05-12", 25, 13],
  ["2026-05-13", 32, 18],
  ["2026-05-14", 47, 26], // most picks
  ["2026-05-15", 33, 12], // worst day
  ["2026-05-16", 30, 18],
  ["2026-05-17", 28, 17],
  ["2026-05-18", 26, 14],
  ["2026-05-19", 41, 30], // best day, matches yesterday recap
];

const LAST_30: DailyHitRatePoint[] = LAST_30_RAW.map(([date, picks, wins]) => ({
  date,
  picks,
  wins,
  hitRate: picks > 0 ? wins / picks : 0,
}));

const LAST_30_TOTAL_PICKS = LAST_30.reduce((s, d) => s + d.picks, 0);
const LAST_30_TOTAL_WINS = LAST_30.reduce((s, d) => s + d.wins, 0);

export const LAST_30_AGGREGATE = {
  picks: LAST_30_TOTAL_PICKS,
  wins: LAST_30_TOTAL_WINS,
  losses: LAST_30_TOTAL_PICKS - LAST_30_TOTAL_WINS,
  hitRate: LAST_30_TOTAL_PICKS > 0 ? LAST_30_TOTAL_WINS / LAST_30_TOTAL_PICKS : 0,
  bestDay: { dateLabel: "Mon May 19", record: "30-11 (73%)" },
  worstDay: { dateLabel: "Wed May 15", record: "12-21 (36%)" },
  mostPicks: { dateLabel: "May 14", count: 47 },
};

// ----- Weekly aggregate (sum of all tallies' weekly entries)

const WEEKLY_PICKS_SUM = ALL_TALLIES.reduce(
  (s, t) => s + (t.weekly?.total ?? 0),
  0
);
const WEEKLY_WINS_SUM = ALL_TALLIES.reduce(
  (s, t) => s + (t.weekly?.wins ?? 0),
  0
);

const WEEKLY_AGGREGATE = {
  totalPicks: WEEKLY_PICKS_SUM,
  wins: WEEKLY_WINS_SUM,
  losses: WEEKLY_PICKS_SUM - WEEKLY_WINS_SUM,
  hitRate: WEEKLY_PICKS_SUM > 0 ? WEEKLY_WINS_SUM / WEEKLY_PICKS_SUM : 0,
  weekStart: "May 13",
  weekEnd: "May 19",
};

// ----- All-time aggregate (sum of all tallies' lifetime entries)

const LIFETIME_PICKS_SUM = ALL_TALLIES.reduce(
  (s, t) => s + t.lifetime.total,
  0
);
const LIFETIME_WINS_SUM = ALL_TALLIES.reduce(
  (s, t) => s + t.lifetime.wins,
  0
);

export const ALL_TIME_AGGREGATE = {
  totalPredictions: LIFETIME_PICKS_SUM,
  wins: LIFETIME_WINS_SUM,
  losses: LIFETIME_PICKS_SUM - LIFETIME_WINS_SUM,
  hitRate: LIFETIME_PICKS_SUM > 0 ? LIFETIME_WINS_SUM / LIFETIME_PICKS_SUM : 0,
};

// ----- Exports

export function getAllTallies(): SportMarketTally[] {
  return ALL_TALLIES;
}

export function getTalliesBySport(sport: Sport): SportMarketTally[] {
  return ALL_TALLIES.filter((t) => t.sport === sport);
}

export function getYesterdayRecap(): DailyRecap & { label: string } {
  const totalPicks = YESTERDAY_RESULTS.reduce((s, r) => s + r.total, 0);
  const totalWins = YESTERDAY_RESULTS.reduce((s, r) => s + r.wins, 0);
  return {
    date: YESTERDAY_DATE,
    label: YESTERDAY_LABEL,
    results: YESTERDAY_RESULTS,
    totalPicks,
    totalWins,
    hitRate: totalPicks > 0 ? totalWins / totalPicks : 0,
  };
}

export function getLast30Days(): DailyHitRatePoint[] {
  return LAST_30;
}

export function getSportSummaries(): SportSummary[] {
  const sports = Array.from(new Set(ALL_TALLIES.map((t) => t.sport))) as Sport[];
  return sports.map((sport) => {
    const rows = ALL_TALLIES.filter((t) => t.sport === sport);
    const totalLifetime = rows.reduce((s, r) => s + r.lifetime.total, 0);
    const winsLifetime = rows.reduce((s, r) => s + r.lifetime.wins, 0);
    const totalWeekly = rows.reduce((s, r) => s + (r.weekly?.total ?? 0), 0);
    const winsWeekly = rows.reduce((s, r) => s + (r.weekly?.wins ?? 0), 0);
    return {
      sport,
      totalLifetime,
      winsLifetime,
      hitRateLifetime: totalLifetime > 0 ? winsLifetime / totalLifetime : 0,
      totalWeekly,
      winsWeekly,
      hitRateWeekly: totalWeekly > 0 ? winsWeekly / totalWeekly : 0,
    };
  });
}

export function getWeeklyAggregate() {
  return WEEKLY_AGGREGATE;
}

export function getCurrentStreak(): {
  type: "W" | "L";
  count: number;
  description: string;
} {
  return {
    type: "W",
    count: 6,
    description: "6 winning days in a row across all sports",
  };
}
