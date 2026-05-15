// Lifetime model tracking — update manually each week until the Google Sheets
// automation lands in Week 2.

export type TrackRecordRow = {
  market: string;
  emoji: string;
  wins: number;
  total: number;
  percent: number;
};

export const TRACK_RECORD: TrackRecordRow[] = [
  { market: "NFL (ML)", emoji: "🏈", wins: 181, total: 284, percent: 63.7 },
  { market: "NFL (O/U)", emoji: "🏈", wins: 155, total: 285, percent: 54.4 },
  { market: "CFB (ML)", emoji: "🏈", wins: 708, total: 923, percent: 76.7 },
  { market: "CFB (O/U)", emoji: "🏈", wins: 493, total: 923, percent: 53.4 },
  { market: "NBA (ML)", emoji: "🏀", wins: 1391, total: 2003, percent: 69.4 },
  { market: "NBA (O/U's)", emoji: "🏀", wins: 700, total: 1319, percent: 53.1 },
  { market: "CBB (ML)", emoji: "🏀", wins: 4624, total: 6444, percent: 71.8 },
  { market: "CBB (O/U's)", emoji: "🏀", wins: 2884, total: 5404, percent: 53.4 },
  { market: "MLB (ML)", emoji: "⚾", wins: 1524, total: 2684, percent: 56.8 },
  { market: "MLB (NRFI/YRFI)", emoji: "⚾", wins: 1277, total: 2247, percent: 56.8 },
  { market: "MLB (NRFI*)", emoji: "⚾", wins: 546, total: 969, percent: 56.3 },
  { market: "MLB (YRFI*)", emoji: "⚾", wins: 419, total: 734, percent: 57.1 },
  { market: "MLB (O/U*)", emoji: "⚾", wins: 1096, total: 1989, percent: 55.1 },
  { market: "UCL (ML)", emoji: "⚽️", wins: 100, total: 174, percent: 57.5 },
  { market: "UCL (Double Chance)", emoji: "⚽️", wins: 129, total: 174, percent: 74.1 },
  { market: "NHL (ML)", emoji: "🏒", wins: 22, total: 44, percent: 50.0 },
  { market: "NHL (O/U)", emoji: "🏒", wins: 28, total: 44, percent: 63.6 },
];

export const LAST_UPDATED = "May 15, 2026";

export const WHOP_URL = "https://whop.com/oddsphereai";
