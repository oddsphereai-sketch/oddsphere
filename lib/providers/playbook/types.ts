/**
 * Playbook API — typed response shapes.
 *
 * Field names verified against LIVE responses on 2026-06-24 (MLB/WNBA/NFL/
 * NCAAF slates) plus docs.playbook-api.com. Anything not observed live is
 * marked optional and treated defensively by the client.
 *
 * SHADOW LANE ONLY. These types describe Playbook's PUBLIC-MARKET data
 * (consensus lines + public betting splits). Per the operating plan:
 *   - Playbook lines are CONSENSUS / provider-aggregate, NOT a named
 *     sportsbook. `lineSourceTier` is a tier label, not a book.
 *   - Playbook splits are bet% / money% only. They are NOT +EV, steam,
 *     reverse line movement, Pinnacle agreement, or CLV.
 */

export type PlaybookLeague =
  | "mlb"
  | "nba"
  | "nhl"
  | "nfl"
  | "ncaaf"
  | "ncaab"
  | "wnba"
  | "mls";

/** `cfb`→`ncaaf`, `cbb`→`ncaab` confirmed identical live on 2026-06-24. */
export const PLAYBOOK_LEAGUE_ALIASES: Record<string, PlaybookLeague> = {
  cfb: "ncaaf",
  cbb: "ncaab",
};

// ── /v1/health ────────────────────────────────────────────────────────────
export interface PlaybookHealth {
  status?: string;
  service?: string;
  time?: string;
}

// ── /v1/me ────────────────────────────────────────────────────────────────
// `apiKey` may echo a masked key — never log this object without redaction.
export interface PlaybookMe {
  apiKey?: string;
  plan?: string;
  planLabel?: string;
  price?: number;
  currency?: string;
  monthlyLimit?: number;
  description?: string;
  subscription?: unknown;
  usage?: unknown;
}

// ── Splits ────────────────────────────────────────────────────────────────
export interface PlaybookSplitPercentages {
  // Spread + moneyline use home/away; total uses over/under. All optional —
  // a market may be absent for a given game.
  homePercent?: number;
  awayPercent?: number;
  overPercent?: number;
  underPercent?: number;
}

export interface PlaybookSplitMarket {
  bets?: PlaybookSplitPercentages;
  money?: PlaybookSplitPercentages;
  source?: { booksUsed?: number };
}

export interface PlaybookSplitGame {
  gameId: string;
  sportKey?: string;
  league?: string;
  date?: string;
  startTime?: string;
  startTimeEst?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  splits?: {
    spread?: PlaybookSplitMarket;
    moneyline?: PlaybookSplitMarket;
    total?: PlaybookSplitMarket;
  };
}

export interface PlaybookSplitsResponse {
  sportKey?: string;
  count?: number;
  /** In-body quota counter (decrements per billed request). */
  requestsRemaining?: number;
  data: PlaybookSplitGame[];
}

// ── Lines ─────────────────────────────────────────────────────────────────
export interface PlaybookLineGame {
  gameId: string;
  league?: string;
  date?: string;
  startTime?: string;
  startTimeEst?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  lines?: {
    spread?: { home?: number; away?: number };
    total?: number;
    moneyline?: { home?: number; away?: number };
  };
  /** Consensus tier label (e.g. "tier1"). NOT a sportsbook name. */
  lineSourceTier?: string;
}

export interface PlaybookLinesResponse {
  league?: string;
  count?: number;
  requestsRemaining?: number;
  data: PlaybookLineGame[];
}

// ── Splits history (frozen pregame snapshots) ─────────────────────────────
// Docs declare a generic object; shape confirmed at runtime by the probe.
export interface PlaybookSplitsHistoryResponse {
  count?: number;
  requestsRemaining?: number;
  data?: unknown[];
  [k: string]: unknown;
}

// ── Venue/weather context ─────────────────────────────────────────────────
export interface PlaybookVenueWeatherRow {
  teamId?: string;
  teamName?: string;
  error?: string | null;
  stale?: boolean;
  staleReason?: string | null;
  game?: unknown;
  venue?: {
    park?: string;
    parkProfile?: string;
    roof?: string;
    roofStatusConfidence?: string | null;
    location?: {
      lat?: number | null;
      lon?: number | null;
      city?: string | null;
      country?: string | null;
      timezone?: string | null;
    };
    roofStatus?: {
      type?: string;
      status?: string;
      confidence?: string;
    };
  };
  conditions?: {
    summary?: string;
    tempF?: number | null;
    wind?: {
      dir?: string | null;
      mph?: number | null;
      type?: string | null;
    };
    precipProb?: number | null;
    isDay?: boolean | null;
  };
  impact?: {
    projectedTotal?: number | null;
    lean?: string | null;
    strength?: string | null;
    confidence?: string | null;
  };
  insights?: {
    hrEnv?: string | null;
    xbhEnv?: string | null;
  };
  weatherSource?: string | null;
  fetchedAt?: string | null;
}

export interface PlaybookVenueWeatherResponse {
  count?: number;
  requestsRemaining?: number;
  data: PlaybookVenueWeatherRow[];
}

// -- MLB starting-pitcher context -----------------------------------------
export interface PlaybookStartingPitcher {
  name?: string | null;
  teamId?: string | null;
  throws?: string | null;
  playerKey?: string | null;
  status?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export interface PlaybookStartingPitchersRow {
  gameId?: string;
  startTime?: string;
  homeTeamId?: string;
  homeTeamName?: string;
  awayTeamId?: string;
  awayTeamName?: string;
  starters?: {
    home?: PlaybookStartingPitcher | null;
    away?: PlaybookStartingPitcher | null;
  };
}

export interface PlaybookStartingPitchersResponse {
  count?: number;
  requestsRemaining?: number;
  data: PlaybookStartingPitchersRow[];
}

// -- Injury context --------------------------------------------------------
export interface PlaybookInjuryPlayer {
  name?: string | null;
  status?: string | null;
  statusContext?: string | null;
  reason?: string | null;
  [k: string]: unknown;
}

export interface PlaybookInjuryTeamRow {
  teamAbbr?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  players?: PlaybookInjuryPlayer[];
  updatedAt?: string | null;
  reportDate?: string | null;
  [k: string]: unknown;
}

export interface PlaybookInjuriesResponse {
  count?: number;
  requestsRemaining?: number;
  reportDate?: string | null;
  updatedAt?: string | null;
  data: PlaybookInjuryTeamRow[];
}

/** Quota state the client tracks from in-body `requestsRemaining`. */
export interface PlaybookQuotaSnapshot {
  requestsRemaining: number | null;
  monthlyLimit: number | null;
}
