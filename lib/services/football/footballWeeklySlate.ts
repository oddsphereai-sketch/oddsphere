import type {
  FootballGameIdentity,
  FootballLeague,
  FootballMarket,
  FootballSeasonPhase,
  FootballShadowForecast,
} from "./footballModelContract";
import type { FootballMovementRead, FootballPublicRead } from "./footballMarketMath";

/**
 * Local-only product contract for an NFL or NCAAF season-week.
 *
 * This module performs no provider calls, writes, publication, grading, or
 * staking. A future production pipeline may consume the same contract only
 * after the prediction releases pass the documented launch gates.
 */
export const FOOTBALL_WEEKLY_SLATE_CONTRACT_RELEASE =
  "football_weekly_slate_contract_2026_08_19_r1" as const;

export type FootballWeekIdentity = {
  league: FootballLeague;
  season: number;
  seasonPhase: FootballSeasonPhase;
  week: number;
};

export type FootballWeeklyGameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";

export type FootballTeamLabel = {
  id: string;
  name: string;
  abbreviation: string;
  ranking: number | null;
  record: string | null;
};

export type FootballDataHealthValue =
  | "ready"
  | "partial"
  | "missing"
  | "stale"
  | "not_applicable";

export type FootballWeeklyGameDataHealth = {
  identity: FootballDataHealthValue;
  schedule: FootballDataHealthValue;
  independentProjection: FootballDataHealthValue;
  currentPrices: FootballDataHealthValue;
  marketHistory: FootballDataHealthValue;
  publicConsensusSplits: FootballDataHealthValue;
  sourceBookSplits: FootballDataHealthValue;
  personnel: FootballDataHealthValue;
  findings: string[];
};

export type FootballWeeklyPrice = {
  side: string;
  lineValue: number | null;
  americanPrice: number;
  sportsbook: string;
  provider: string;
  observedAt: string;
};

export type FootballWeeklyMarketPanel = {
  market: FootballMarket;
  modelProbability: number | null;
  modelLineValue: number | null;
  marketLineValue: number | null;
  bestCurrentPrice: FootballWeeklyPrice | null;
  opening: FootballWeeklyPrice | null;
  prior: FootballWeeklyPrice | null;
  movement: FootballMovementRead | null;
  publicConsensus: FootballPublicRead | null;
  sourceBookReads: FootballPublicRead[];
  evidenceFindings: string[];
};

export type FootballWeeklyReason = {
  key:
    | "quarterback"
    | "personnel"
    | "efficiency"
    | "explosiveness"
    | "pressure_havoc"
    | "pace"
    | "rest_travel"
    | "weather"
    | "market_context";
  label: string;
  detail: string;
  source: string;
  observedAt: string | null;
};

export type FootballWeeklyGame = {
  identity: FootballGameIdentity;
  status: FootballWeeklyGameStatus;
  /** False for a canceled game or a game formally moved to another week. */
  countsTowardWeekCompletion: boolean;
  homeTeam: FootballTeamLabel;
  awayTeam: FootballTeamLabel;
  homeScore: number | null;
  awayScore: number | null;
  broadcast: string | null;
  forecast: FootballShadowForecast | null;
  markets: Partial<Record<FootballMarket, FootballWeeklyMarketPanel>>;
  reasons: FootballWeeklyReason[];
  dataHealth: FootballWeeklyGameDataHealth;
  actionable: false;
};

export type FootballWeeklySlateState =
  | "collecting"
  | "open"
  | "in_progress"
  | "complete"
  | "hold";

export type FootballWeeklySlate = {
  contractRelease: typeof FOOTBALL_WEEKLY_SLATE_CONTRACT_RELEASE;
  week: FootballWeekIdentity;
  availableWeeks: FootballWeekIdentity[];
  generatedAt: string;
  state: FootballWeeklySlateState;
  games: FootballWeeklyGame[];
  providerRequestCount: number;
  localOnly: true;
  actionable: false;
};

export function footballWeekKey(week: FootballWeekIdentity): string {
  return [week.league, week.season, week.seasonPhase, week.week].join(":");
}

function assertValidWeek(week: FootballWeekIdentity): void {
  if (!Number.isInteger(week.season) || week.season < 2000) {
    throw new Error("Football week requires a valid season.");
  }
  if (!Number.isInteger(week.week) || week.week < 0) {
    throw new Error("Football week requires a non-negative integer week.");
  }
  if (week.league === "nfl" && week.seasonPhase === "bowl") {
    throw new Error("NFL weeks cannot use the bowl season phase.");
  }
  if (week.league === "ncaaf" && week.seasonPhase === "preseason") {
    throw new Error("NCAAF weeks cannot use the preseason season phase.");
  }
}

function gameBelongsToWeek(game: FootballWeeklyGame, week: FootballWeekIdentity): boolean {
  return game.identity.league === week.league &&
    game.identity.season === week.season &&
    game.identity.seasonPhase === week.seasonPhase &&
    game.identity.week === week.week;
}

export function footballGameCompletesWeek(game: FootballWeeklyGame): boolean {
  return !game.countsTowardWeekCompletion || game.status === "final" || game.status === "canceled";
}

export function deriveFootballWeeklySlateState(games: FootballWeeklyGame[]): FootballWeeklySlateState {
  if (games.length === 0) return "hold";
  if (games.some((game) => game.status === "in_progress")) return "in_progress";
  if (games.every(footballGameCompletesWeek)) return "complete";
  const upcoming = games.filter((game) => game.status === "scheduled" || game.status === "postponed");
  if (upcoming.length === 0) return "hold";
  const projectionReady = upcoming.filter((game) => game.dataHealth.independentProjection === "ready").length;
  const priceReady = upcoming.filter((game) => game.dataHealth.currentPrices === "ready").length;
  return projectionReady === upcoming.length && priceReady === upcoming.length ? "open" : "collecting";
}

export function buildFootballWeeklySlate(input: {
  week: FootballWeekIdentity;
  availableWeeks: FootballWeekIdentity[];
  generatedAt: string;
  games: FootballWeeklyGame[];
  providerRequestCount: number;
}): FootballWeeklySlate {
  assertValidWeek(input.week);
  if (!Number.isFinite(Date.parse(input.generatedAt))) {
    throw new Error("Football weekly slate requires a valid generatedAt timestamp.");
  }
  if (!Number.isInteger(input.providerRequestCount) || input.providerRequestCount < 0) {
    throw new Error("Football weekly slate requires a non-negative provider request count.");
  }
  if (input.games.some((game) => !gameBelongsToWeek(game, input.week))) {
    throw new Error("Football weekly slate cannot mix leagues, seasons, phases, or weeks.");
  }
  for (const game of input.games) {
    if (!Number.isFinite(Date.parse(game.identity.scheduledStart))) {
      throw new Error("Football weekly game requires a valid kickoff timestamp.");
    }
    if (game.forecast && footballWeekKey(game.forecast.identity) !== footballWeekKey(game.identity)) {
      throw new Error("Football weekly game forecast identity does not match its schedule identity.");
    }
  }
  const available = new Map<string, FootballWeekIdentity>();
  for (const week of [...input.availableWeeks, input.week]) {
    assertValidWeek(week);
    if (week.league === input.week.league && week.season === input.week.season) {
      available.set(footballWeekKey(week), week);
    }
  }
  return {
    contractRelease: FOOTBALL_WEEKLY_SLATE_CONTRACT_RELEASE,
    week: input.week,
    availableWeeks: [...available.values()].sort(compareFootballWeeks),
    generatedAt: input.generatedAt,
    state: deriveFootballWeeklySlateState(input.games),
    games: [...input.games].sort((a, b) => Date.parse(a.identity.scheduledStart) - Date.parse(b.identity.scheduledStart)),
    providerRequestCount: input.providerRequestCount,
    localOnly: true,
    actionable: false,
  };
}

function earliestKickoff(slate: FootballWeeklySlate): number {
  const values = slate.games.map((game) => Date.parse(game.identity.scheduledStart)).filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : Number.POSITIVE_INFINITY;
}

function compareFootballWeeks(a: FootballWeekIdentity, b: FootballWeekIdentity): number {
  const phaseOrder: Record<FootballSeasonPhase, number> = {
    preseason: 0,
    regular: 1,
    postseason: 2,
    bowl: 2,
  };
  return a.season - b.season || phaseOrder[a.seasonPhase] - phaseOrder[b.seasonPhase] || a.week - b.week;
}

/**
 * Mirrors the useful EPL behavior: retain a partially completed week, then
 * advance only after every completion-counting game is terminal. Explicit
 * requests may still open past or future weeks in the founder reader.
 */
export function selectActiveFootballWeeklySlate(
  slates: FootballWeeklySlate[],
  requestedWeek?: FootballWeekIdentity,
): FootballWeeklySlate | null {
  if (slates.length === 0) return null;
  if (requestedWeek) {
    const requestedKey = footballWeekKey(requestedWeek);
    const exact = slates.find((slate) => footballWeekKey(slate.week) === requestedKey);
    if (exact) return exact;
  }
  const ordered = [...slates].sort((a, b) => earliestKickoff(a) - earliestKickoff(b) || compareFootballWeeks(a.week, b.week));
  return ordered.find((slate) => !slate.games.every(footballGameCompletesWeek)) ?? ordered.at(-1) ?? null;
}
