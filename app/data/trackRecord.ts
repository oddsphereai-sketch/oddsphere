// Lifetime model tracking + current-season splits.
// Update manually each week until the Google Sheets automation lands.

export type TrackRecordRow = {
  market: string;
  emoji: string;
  lifetimeWins: number;
  lifetimeTotal: number;
  lifetimePercent: number;
  currentSeasonWins: number | null; // null = no current-season data (off-season)
  currentSeasonTotal: number | null;
};

export const TRACK_RECORD: TrackRecordRow[] = [
  { market: "NFL (ML)",            emoji: "🏈", lifetimeWins:  181, lifetimeTotal:  284, lifetimePercent: 63.7, currentSeasonWins: null, currentSeasonTotal: null },
  { market: "NFL (O/U)",           emoji: "🏈", lifetimeWins:  155, lifetimeTotal:  285, lifetimePercent: 54.4, currentSeasonWins: null, currentSeasonTotal: null },
  { market: "CFB (ML)",            emoji: "🏈", lifetimeWins:  708, lifetimeTotal:  923, lifetimePercent: 76.7, currentSeasonWins: null, currentSeasonTotal: null },
  { market: "CFB (O/U)",           emoji: "🏈", lifetimeWins:  493, lifetimeTotal:  923, lifetimePercent: 53.4, currentSeasonWins: null, currentSeasonTotal: null },
  { market: "NBA (ML)",            emoji: "🏀", lifetimeWins: 1395, lifetimeTotal: 2010, lifetimePercent: 69.4, currentSeasonWins:  920, currentSeasonTotal: 1340 },
  { market: "NBA (O/U)",           emoji: "🏀", lifetimeWins:  706, lifetimeTotal: 1326, lifetimePercent: 53.2, currentSeasonWins:  706, currentSeasonTotal: 1326 },
  { market: "CBB (ML)",            emoji: "🏀", lifetimeWins: 4624, lifetimeTotal: 6444, lifetimePercent: 71.8, currentSeasonWins: 3962, currentSeasonTotal: 5480 },
  { market: "CBB (O/U)",           emoji: "🏀", lifetimeWins: 2884, lifetimeTotal: 5404, lifetimePercent: 53.4, currentSeasonWins: 2925, currentSeasonTotal: 5480 },
  { market: "MLB (ML)",            emoji: "⚾", lifetimeWins: 1575, lifetimeTotal: 2776, lifetimePercent: 56.7, currentSeasonWins:  372, currentSeasonTotal:  698 },
  { market: "MLB (NRFI/YRFI)",     emoji: "⚾", lifetimeWins: 1311, lifetimeTotal: 2315, lifetimePercent: 56.6, currentSeasonWins:  301, currentSeasonTotal:  564 },
  { market: "MLB (NRFI*)",         emoji: "⚾", lifetimeWins:  568, lifetimeTotal: 1009, lifetimePercent: 56.3, currentSeasonWins:  174, currentSeasonTotal:  321 },
  { market: "MLB (YRFI*)",         emoji: "⚾", lifetimeWins:  431, lifetimeTotal:  762, lifetimePercent: 56.6, currentSeasonWins:  127, currentSeasonTotal:  243 },
  { market: "MLB (O/U*)",          emoji: "⚾", lifetimeWins: 1142, lifetimeTotal: 2081, lifetimePercent: 54.9, currentSeasonWins:  370, currentSeasonTotal:  698 },
  { market: "UCL (ML)",            emoji: "⚽️", lifetimeWins:  100, lifetimeTotal:  174, lifetimePercent: 57.5, currentSeasonWins:    5, currentSeasonTotal:    8 },
  { market: "UCL (Double Chance)", emoji: "⚽️", lifetimeWins:  129, lifetimeTotal:  174, lifetimePercent: 74.1, currentSeasonWins:    6, currentSeasonTotal:    8 },
  { market: "NHL (ML)",            emoji: "🏒", lifetimeWins:   27, lifetimeTotal:   51, lifetimePercent: 52.9, currentSeasonWins:   27, currentSeasonTotal:   51 },
  { market: "NHL (O/U)",           emoji: "🏒", lifetimeWins:   31, lifetimeTotal:   51, lifetimePercent: 60.8, currentSeasonWins:   31, currentSeasonTotal:   51 },
];

export const LAST_UPDATED = "May 18, 2026";

export const WHOP_URL = "https://whop.com/oddsphereai";
export const X_HANDLE = "OddSphereAI";
export const X_URL = "https://x.com/OddSphereAI";
