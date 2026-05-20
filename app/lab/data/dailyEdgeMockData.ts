// Mock data for the Daily Edge view. UI-only, no backend wiring yet.
// 15 MLB games with model predictions across ML / Total / NRFI markets,
// plus a hand-curated set of sharp-money signals per game.
//
// `Verdict` is derived at render time (not stored) by counting confirms
// and cautions across the three markets per game.

export type SharpStatus = "confirm" | "mixed" | "caution";

export type DailyEdgePrediction = {
  pick: string;
  confidence: number;
  sharpStatus: SharpStatus;
};

export type SharpSignal = {
  market: "ML" | "OU" | "NRFI";
  type:
    | "pinnacle_agree"
    | "pinnacle_disagree"
    | "line_move_toward"
    | "line_move_away"
    | "steam"
    | "handle_gap"
    | "no_signal"
    | "context_weather"
    | "context_park";
  description: string;
  source?: string;
  timestamp?: string;
  direction: "positive" | "negative" | "neutral";
};

export type DailyEdgeGame = {
  id: string;
  sport: "mlb";
  awayTeam: string;
  homeTeam: string;
  gameTime: string;
  gameStartMinutes: number;
  predictions: {
    ml: DailyEdgePrediction;
    total: DailyEdgePrediction & { line: number };
    nrfi: DailyEdgePrediction;
  };
  projected: { away: number; home: number };
  sharpSignals: SharpSignal[];
};

export type Verdict = "triple_lock" | "strong" | "lean" | "caution";

export function calculateVerdict(
  predictions: DailyEdgeGame["predictions"]
): Verdict {
  const statuses = [
    predictions.ml.sharpStatus,
    predictions.total.sharpStatus,
    predictions.nrfi.sharpStatus,
  ];
  const confirms = statuses.filter((s) => s === "confirm").length;
  const cautions = statuses.filter((s) => s === "caution").length;
  if (confirms === 3) return "triple_lock";
  if (confirms === 2) return "strong";
  if (confirms === 1 && cautions === 0) return "lean";
  return "caution";
}

export const ALL_DAILY_EDGE_GAMES: DailyEdgeGame[] = [
  {
    id: "cin-phi",
    sport: "mlb",
    awayTeam: "CIN",
    homeTeam: "PHI",
    gameTime: "6:40 PM",
    gameStartMinutes: 1600,
    predictions: {
      ml:    { pick: "CIN",    confidence: 0.54, sharpStatus: "confirm" },
      total: { pick: "Under",  confidence: 0.52, sharpStatus: "mixed",   line: 9.5 },
      nrfi:  { pick: "NRFI",   confidence: 0.57, sharpStatus: "confirm" },
    },
    projected: { away: 4.8, home: 4.4 },
    sharpSignals: [
      { market: "ML",   type: "pinnacle_agree",     description: "Pinnacle agrees — CIN +135",                       source: "PINNACLE", direction: "positive" },
      { market: "ML",   type: "line_move_toward",   description: "Line moved +145 → +135 toward pick",               source: "MARKET",   timestamp: "3H AGO",  direction: "positive" },
      { market: "NRFI", type: "handle_gap",         description: "68% handle on NRFI — sharp side",                  source: "MARKET",                          direction: "positive" },
    ],
  },
  {
    id: "bal-tbr",
    sport: "mlb",
    awayTeam: "BAL",
    homeTeam: "TBR",
    gameTime: "7:10 PM",
    gameStartMinutes: 1630,
    predictions: {
      ml:    { pick: "TBR",     confidence: 0.57, sharpStatus: "confirm" },
      total: { pick: "Over",    confidence: 0.55, sharpStatus: "confirm", line: 8.5 },
      nrfi:  { pick: "Toss-Up", confidence: 0.51, sharpStatus: "mixed"   },
    },
    projected: { away: 4.0, home: 5.0 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_agree",   description: "Pinnacle agrees — TBR -160",                       source: "PINNACLE", direction: "positive" },
      { market: "OU", type: "steam",            description: "Steam — Over 8.5 moved at 3 books together",       source: "MARKET",   timestamp: "1:45 PM", direction: "positive" },
      { market: "OU", type: "line_move_toward", description: "Line moved 8.0 → 8.5 toward Over",                  source: "MARKET",   timestamp: "4H AGO",  direction: "positive" },
    ],
  },
  {
    id: "hou-min",
    sport: "mlb",
    awayTeam: "HOU",
    homeTeam: "MIN",
    gameTime: "7:40 PM",
    gameStartMinutes: 1660,
    predictions: {
      ml:    { pick: "MIN",     confidence: 0.53, sharpStatus: "mixed" },
      total: { pick: "Under",   confidence: 0.52, sharpStatus: "mixed", line: 8.5 },
      nrfi:  { pick: "Toss-Up", confidence: 0.51, sharpStatus: "mixed" },
    },
    projected: { away: 3.4, home: 4.7 },
    sharpSignals: [
      { market: "ML", type: "no_signal",  description: "No clear sharp money — public and sharp split evenly", source: "MARKET", direction: "neutral" },
      { market: "OU", type: "handle_gap", description: "Mixed — 52% handle on Over, 48% on Under",             source: "MARKET", direction: "neutral" },
    ],
  },
  {
    id: "atl-mia",
    sport: "mlb",
    awayTeam: "ATL",
    homeTeam: "MIA",
    gameTime: "7:10 PM",
    gameStartMinutes: 1630,
    predictions: {
      ml:    { pick: "ATL",   confidence: 0.62, sharpStatus: "confirm" },
      total: { pick: "Under", confidence: 0.53, sharpStatus: "confirm", line: 7.5 },
      nrfi:  { pick: "NRFI",  confidence: 0.57, sharpStatus: "confirm" },
    },
    projected: { away: 5.0, home: 2.0 },
    sharpSignals: [
      { market: "ML",   type: "pinnacle_agree",   description: "Pinnacle agrees — ATL -210",                       source: "PINNACLE", direction: "positive" },
      { market: "ML",   type: "line_move_toward", description: "Line moved -195 → -210 toward ATL",                source: "MARKET",   timestamp: "5H AGO",  direction: "positive" },
      { market: "OU",   type: "steam",            description: "Steam — Under 7.5 moved at 4 books together",      source: "MARKET",   timestamp: "2:30 PM", direction: "positive" },
      { market: "NRFI", type: "pinnacle_agree",   description: "Pinnacle backs NRFI — both starters K-heavy",      source: "PINNACLE",                       direction: "positive" },
    ],
  },
  {
    id: "tor-nyy",
    sport: "mlb",
    awayTeam: "TOR",
    homeTeam: "NYY",
    gameTime: "7:05 PM",
    gameStartMinutes: 1625,
    predictions: {
      ml:    { pick: "NYY",     confidence: 0.59, sharpStatus: "confirm" },
      total: { pick: "Under",   confidence: 0.57, sharpStatus: "caution", line: 8.5 },
      nrfi:  { pick: "Toss-Up", confidence: 0.51, sharpStatus: "mixed"   },
    },
    projected: { away: 3.1, home: 4.6 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_agree",  description: "Pinnacle agrees — NYY -150",                          source: "PINNACLE", direction: "positive" },
      { market: "OU", type: "line_move_away",  description: "Line moved Under 8.5 → 9.0 away from pick",           source: "MARKET",   timestamp: "2H AGO", direction: "negative" },
      { market: "OU", type: "context_park",    description: "Yankee Stadium short porch favors offense",           source: "CONTEXT",                       direction: "neutral"  },
    ],
  },
  {
    id: "bos-kcr",
    sport: "mlb",
    awayTeam: "BOS",
    homeTeam: "KCR",
    gameTime: "7:40 PM",
    gameStartMinutes: 1660,
    predictions: {
      ml:    { pick: "KCR",   confidence: 0.53, sharpStatus: "mixed"   },
      total: { pick: "Under", confidence: 0.53, sharpStatus: "confirm", line: 7.5 },
      nrfi:  { pick: "NRFI",  confidence: 0.55, sharpStatus: "confirm" },
    },
    projected: { away: 3.4, home: 3.9 },
    sharpSignals: [
      { market: "OU",   type: "pinnacle_agree", description: "Pinnacle backs Under 7.5",                       source: "PINNACLE", direction: "positive" },
      { market: "NRFI", type: "handle_gap",     description: "62% handle on NRFI — sharp side",                source: "MARKET",                       direction: "positive" },
    ],
  },
  {
    id: "mil-chc",
    sport: "mlb",
    awayTeam: "MIL",
    homeTeam: "CHC",
    gameTime: "7:40 PM",
    gameStartMinutes: 1660,
    predictions: {
      ml:    { pick: "CHC",  confidence: 0.53, sharpStatus: "confirm" },
      total: { pick: "Over", confidence: 0.52, sharpStatus: "mixed",   line: 6.5 },
      nrfi:  { pick: "NRFI", confidence: 0.56, sharpStatus: "mixed"   },
    },
    projected: { away: 3.2, home: 3.5 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_agree", description: "Pinnacle agrees — CHC -120",                      source: "PINNACLE", direction: "positive" },
      { market: "OU", type: "no_signal",      description: "No clear market lean on the total",                source: "MARKET",                       direction: "neutral"  },
    ],
  },
  {
    id: "pit-stl",
    sport: "mlb",
    awayTeam: "PIT",
    homeTeam: "STL",
    gameTime: "7:45 PM",
    gameStartMinutes: 1665,
    predictions: {
      ml:    { pick: "STL",     confidence: 0.54, sharpStatus: "confirm" },
      total: { pick: "Over",    confidence: 0.52, sharpStatus: "mixed",   line: 7.5 },
      nrfi:  { pick: "Toss-Up", confidence: 0.52, sharpStatus: "mixed"   },
    },
    projected: { away: 4.0, home: 4.7 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_agree",   description: "Pinnacle agrees — STL -135",                       source: "PINNACLE", direction: "positive" },
      { market: "OU", type: "context_weather",  description: "Wind 8mph crosswind — neutral effect on totals",   source: "CONTEXT",                       direction: "neutral"  },
    ],
  },
  {
    id: "tex-col",
    sport: "mlb",
    awayTeam: "TEX",
    homeTeam: "COL",
    gameTime: "8:40 PM",
    gameStartMinutes: 1720,
    predictions: {
      ml:    { pick: "TEX",   confidence: 0.53, sharpStatus: "caution" },
      total: { pick: "Under", confidence: 0.52, sharpStatus: "caution", line: 10.5 },
      nrfi:  { pick: "YRFI",  confidence: 0.57, sharpStatus: "mixed"   },
    },
    projected: { away: 5.5, home: 4.8 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_disagree", description: "Pinnacle leans COL — value the other side",       source: "PINNACLE",                      direction: "negative" },
      { market: "ML", type: "line_move_away",    description: "Line moved -125 → -110 away from TEX",            source: "MARKET",   timestamp: "3H AGO", direction: "negative" },
      { market: "OU", type: "context_park",      description: "Coors Field +18% run environment — favors Over",  source: "CONTEXT",                       direction: "neutral"  },
      { market: "OU", type: "context_weather",   description: "Wind 14mph blowing out",                          source: "CONTEXT",                       direction: "neutral"  },
    ],
  },
  {
    id: "sfg-ari",
    sport: "mlb",
    awayTeam: "SFG",
    homeTeam: "ARI",
    gameTime: "9:40 PM",
    gameStartMinutes: 1780,
    predictions: {
      ml:    { pick: "ARI",  confidence: 0.54, sharpStatus: "confirm" },
      total: { pick: "Over", confidence: 0.58, sharpStatus: "confirm", line: 8.5 },
      nrfi:  { pick: "YRFI", confidence: 0.58, sharpStatus: "confirm" },
    },
    projected: { away: 4.5, home: 5.5 },
    sharpSignals: [
      { market: "ML",   type: "pinnacle_agree",   description: "Pinnacle agrees — ARI -130",                  source: "PINNACLE", direction: "positive" },
      { market: "OU",   type: "steam",            description: "Steam — Over 8.5 moved at 4 books",            source: "MARKET",   timestamp: "1:15 PM", direction: "positive" },
      { market: "OU",   type: "line_move_toward", description: "Line moved 8.0 → 8.5 toward Over",             source: "MARKET",   timestamp: "6H AGO",  direction: "positive" },
      { market: "NRFI", type: "handle_gap",       description: "65% handle on YRFI",                           source: "MARKET",                         direction: "positive" },
    ],
  },
  {
    id: "nym-wsh",
    sport: "mlb",
    awayTeam: "NYM",
    homeTeam: "WSH",
    gameTime: "7:05 PM",
    gameStartMinutes: 1625,
    predictions: {
      ml:    { pick: "NYM",  confidence: 0.55, sharpStatus: "confirm" },
      total: { pick: "Over", confidence: 0.58, sharpStatus: "confirm", line: 9.5 },
      nrfi:  { pick: "YRFI", confidence: 0.57, sharpStatus: "mixed"   },
    },
    projected: { away: 5.5, home: 4.8 },
    sharpSignals: [
      { market: "ML", type: "pinnacle_agree",   description: "Pinnacle agrees — NYM -140",                       source: "PINNACLE", direction: "positive" },
      { market: "OU", type: "line_move_toward", description: "Line moved 9.0 → 9.5 toward Over",                 source: "MARKET",   timestamp: "4H AGO", direction: "positive" },
      { market: "OU", type: "context_weather",  description: "Wind 12mph blowing out — favors Over",             source: "CONTEXT",                       direction: "positive" },
    ],
  },
  {
    id: "cle-det",
    sport: "mlb",
    awayTeam: "CLE",
    homeTeam: "DET",
    gameTime: "6:40 PM",
    gameStartMinutes: 1600,
    predictions: {
      ml:    { pick: "DET",   confidence: 0.51, sharpStatus: "mixed"   },
      total: { pick: "Under", confidence: 0.51, sharpStatus: "mixed",   line: 7.5 },
      nrfi:  { pick: "NRFI",  confidence: 0.56, sharpStatus: "confirm" },
    },
    projected: { away: 3.5, home: 3.9 },
    sharpSignals: [
      { market: "NRFI", type: "pinnacle_agree", description: "Pinnacle backs NRFI — both starters K-heavy",      source: "PINNACLE", direction: "positive" },
      { market: "ML",   type: "no_signal",     description: "Coin flip — no sharp lean either way",              source: "MARKET",                       direction: "neutral"  },
    ],
  },
  {
    id: "cws-sea",
    sport: "mlb",
    awayTeam: "CWS",
    homeTeam: "SEA",
    gameTime: "10:10 PM",
    gameStartMinutes: 1810,
    predictions: {
      ml:    { pick: "SEA",   confidence: 0.52, sharpStatus: "mixed"   },
      total: { pick: "Under", confidence: 0.56, sharpStatus: "confirm", line: 7.5 },
      nrfi:  { pick: "NRFI",  confidence: 0.56, sharpStatus: "confirm" },
    },
    projected: { away: 3.1, home: 4.0 },
    sharpSignals: [
      { market: "OU",   type: "pinnacle_agree", description: "Pinnacle backs Under 7.5",                       source: "PINNACLE", direction: "positive" },
      { market: "OU",   type: "steam",          description: "Steam — Under moved at 3 books together",         source: "MARKET",   timestamp: "2:45 PM", direction: "positive" },
      { market: "NRFI", type: "handle_gap",     description: "61% handle on NRFI",                              source: "MARKET",                         direction: "positive" },
    ],
  },
  {
    id: "lad-sdp",
    sport: "mlb",
    awayTeam: "LAD",
    homeTeam: "SDP",
    gameTime: "9:40 PM",
    gameStartMinutes: 1780,
    predictions: {
      ml:    { pick: "LAD",   confidence: 0.60, sharpStatus: "confirm" },
      total: { pick: "Under", confidence: 0.54, sharpStatus: "mixed",   line: 7.5 },
      nrfi:  { pick: "NRFI",  confidence: 0.57, sharpStatus: "confirm" },
    },
    projected: { away: 4.5, home: 2.8 },
    sharpSignals: [
      { market: "ML",   type: "pinnacle_agree",   description: "Pinnacle agrees — LAD -180",                      source: "PINNACLE", direction: "positive" },
      { market: "ML",   type: "line_move_toward", description: "Line moved -170 → -180 toward LAD",               source: "MARKET",   timestamp: "4H AGO", direction: "positive" },
      { market: "NRFI", type: "pinnacle_agree",   description: "Pinnacle agrees on NRFI",                         source: "PINNACLE",                       direction: "positive" },
    ],
  },
  {
    id: "ath-laa",
    sport: "mlb",
    awayTeam: "ATH",
    homeTeam: "LAA",
    gameTime: "9:38 PM",
    gameStartMinutes: 1778,
    predictions: {
      ml:    { pick: "ATH",     confidence: 0.57, sharpStatus: "confirm" },
      total: { pick: "Over",    confidence: 0.54, sharpStatus: "mixed",   line: 9.5 },
      nrfi:  { pick: "Toss-Up", confidence: 0.51, sharpStatus: "caution" },
    },
    projected: { away: 5.5, home: 4.5 },
    sharpSignals: [
      { market: "ML",   type: "pinnacle_agree",     description: "Pinnacle agrees — ATH +130",                      source: "PINNACLE", direction: "positive" },
      { market: "NRFI", type: "pinnacle_disagree",  description: "Pinnacle leans YRFI — fade NRFI side",            source: "PINNACLE", direction: "negative" },
      { market: "OU",   type: "context_weather",    description: "Light desert wind — neutral effect on totals",    source: "CONTEXT",                       direction: "neutral"  },
    ],
  },
];

export function getDailyEdgeGames(sport: "mlb"): DailyEdgeGame[] {
  return ALL_DAILY_EDGE_GAMES.filter((g) => g.sport === sport).sort(
    (a, b) => a.gameStartMinutes - b.gameStartMinutes
  );
}
