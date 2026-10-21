/**
 * NBA player-props research boundary.
 *
 * This contract is deliberately disconnected from routes, crons, member DTOs,
 * grades, stakes, database writers, and the production prediction lease. It is
 * safe to use for local capture and chronological replay only.
 */

export const NBA_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE =
  "nba_player_props_research_schema_2026_10_20_r1" as const;
export const NBA_PLAYER_PROPS_OBSERVATION_RELEASE =
  "nba_player_props_observation_2026_10_20_r1" as const;
export const NBA_PLAYER_PROPS_MODEL_RELEASE =
  "nba_player_props_model_unfit_2026_10_20_r1" as const;
export const NBA_PLAYER_PROPS_CALIBRATION_RELEASE =
  "nba_player_props_calibration_unfit_2026_10_20_r1" as const;
export const NBA_PLAYER_PROPS_DECISION_RELEASE =
  "nba_player_props_decision_unfit_2026_10_20_r1" as const;

export const NBA_PLAYER_PROPS_FOUNDATION_MARKETS = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
] as const;

export const NBA_PLAYER_PROPS_RESEARCH_MARKETS = [
  ...NBA_PLAYER_PROPS_FOUNDATION_MARKETS,
  "blocks",
  "steals",
  "blocks_steals",
  "turnovers",
  "field_goals",
  "free_throws_made",
  "free_throws_attempted",
  "double_double",
  "triple_double",
  "points_q1",
  "rebounds_q1",
  "assists_q1",
] as const;

export type NbaPlayerPropMarket = (typeof NBA_PLAYER_PROPS_RESEARCH_MARKETS)[number];
export type NbaPlayerPropProvider = "balldontlie" | "the_odds_api" | "sharpapi";
export type NbaPlayerPropSide = "over" | "under" | "yes" | "no";
export type NbaPlayerPropOfferType = "over_under" | "milestone";

export type NbaPlayerPropGameIdentity = {
  canonicalGameId: string;
  provider: NbaPlayerPropProvider;
  providerGameId: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
};

export type NbaPlayerPropPriceObservation = {
  release: typeof NBA_PLAYER_PROPS_OBSERVATION_RELEASE;
  provider: NbaPlayerPropProvider;
  providerObservationId: string;
  providerEventId: string;
  canonicalGameId: string | null;
  canonicalPlayerId: string | null;
  providerPlayerId: string | null;
  playerName: string | null;
  playerTeam: string | null;
  sportsbook: string;
  market: NbaPlayerPropMarket;
  providerMarket: string;
  offerType: NbaPlayerPropOfferType;
  side: NbaPlayerPropSide;
  line: number;
  americanPrice: number;
  observedAt: string;
  fetchedAt: string;
  isOpening: boolean;
  isLive: boolean;
  homeTeam: string | null;
  awayTeam: string | null;
  scheduledStart: string | null;
};

export type NbaPlayerPropsProviderNormalization = {
  rows: NbaPlayerPropPriceObservation[];
  inputRows: number;
  rejectedRows: number;
  unknownMarkets: Record<string, number>;
};

export type NbaPlayerPropsCoverage = {
  rows: number;
  events: number;
  canonicalGames: number;
  playersWithProviderIdentity: number;
  playersWithName: number;
  sportsbooks: string[];
  markets: Record<string, number>;
  foundationRows: number;
  completeTwoWayBuckets: number;
  openingRows: number;
  currentRows: number;
  invalidFreshnessRows: number;
};

export type NbaPlayerPropsObservationSnapshot = {
  schemaRelease: typeof NBA_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE;
  observationRelease: typeof NBA_PLAYER_PROPS_OBSERVATION_RELEASE;
  modelRelease: typeof NBA_PLAYER_PROPS_MODEL_RELEASE;
  calibrationRelease: typeof NBA_PLAYER_PROPS_CALIBRATION_RELEASE;
  decisionRelease: typeof NBA_PLAYER_PROPS_DECISION_RELEASE;
  mode: "local_observe_only";
  actionable: false;
  generatedAt: string;
  games: NbaPlayerPropGameIdentity[];
  observations: NbaPlayerPropPriceObservation[];
  providerCoverage: Partial<Record<NbaPlayerPropProvider, NbaPlayerPropsCoverage>>;
  providerRequests: Partial<Record<NbaPlayerPropProvider, number>>;
  providerComplete: Partial<Record<NbaPlayerPropProvider, boolean>>;
  collectionComplete: boolean;
  modelingReady: false;
  healthFindings: string[];
};

const FOUNDATION_MARKETS = new Set<string>(NBA_PLAYER_PROPS_FOUNDATION_MARKETS);

export function summarizeNbaPlayerPropsCoverage(
  rows: readonly NbaPlayerPropPriceObservation[],
): NbaPlayerPropsCoverage {
  const markets = new Map<string, number>();
  const paired = new Map<string, Set<NbaPlayerPropSide>>();
  const playerIds = new Set<string>();
  const playerNames = new Set<string>();
  for (const row of rows) {
    markets.set(row.market, (markets.get(row.market) ?? 0) + 1);
    if (row.canonicalPlayerId) playerIds.add(row.canonicalPlayerId);
    else if (row.providerPlayerId) playerIds.add(`${row.provider}:${row.providerPlayerId}`);
    if (row.playerName) playerNames.add(`${row.provider}:${normalizeIdentity(row.playerName)}`);
    if (row.offerType === "over_under") {
      const player = row.canonicalPlayerId ?? row.providerPlayerId ?? normalizeIdentity(row.playerName ?? "");
      const key = [row.provider, row.providerEventId, row.sportsbook, player, row.market, row.line].join("|");
      paired.set(key, new Set([...(paired.get(key) ?? []), row.side]));
    }
  }
  return {
    rows: rows.length,
    events: new Set(rows.map((row) => `${row.provider}:${row.providerEventId}`)).size,
    canonicalGames: new Set(rows.map((row) => row.canonicalGameId).filter((value): value is string => value !== null)).size,
    playersWithProviderIdentity: playerIds.size,
    playersWithName: playerNames.size,
    sportsbooks: [...new Set(rows.map((row) => row.sportsbook))].sort(),
    markets: Object.fromEntries([...markets.entries()].sort(([a], [b]) => a.localeCompare(b))),
    foundationRows: rows.filter((row) => FOUNDATION_MARKETS.has(row.market)).length,
    completeTwoWayBuckets: [...paired.values()].filter((sides) => sides.has("over") && sides.has("under")).length,
    openingRows: rows.filter((row) => row.isOpening).length,
    currentRows: rows.filter((row) => !row.isOpening).length,
    invalidFreshnessRows: rows.filter((row) => !Number.isFinite(Date.parse(row.observedAt))).length,
  };
}

export function buildNbaPlayerPropsObservationSnapshot(args: {
  generatedAt: string;
  games: readonly NbaPlayerPropGameIdentity[];
  observations: readonly NbaPlayerPropPriceObservation[];
  providerRequests: Partial<Record<NbaPlayerPropProvider, number>>;
  providerComplete: Partial<Record<NbaPlayerPropProvider, boolean>>;
  healthFindings?: readonly string[];
}): NbaPlayerPropsObservationSnapshot {
  timestamp(args.generatedAt, "generatedAt");
  const gameKeys = new Set<string>();
  for (const game of args.games) {
    timestamp(game.scheduledStart, "scheduledStart");
    const key = `${game.provider}:${game.providerGameId}`;
    if (gameKeys.has(key)) throw new Error(`NBA props contains duplicate game identity ${key}.`);
    gameKeys.add(key);
  }
  for (const row of args.observations) validateObservation(row);
  const providers = ["balldontlie", "the_odds_api", "sharpapi"] as const;
  const providerCoverage = Object.fromEntries(providers
    .map((provider) => [provider, summarizeNbaPlayerPropsCoverage(args.observations.filter((row) => row.provider === provider))] as const)
    .filter(([, coverage]) => coverage.rows > 0)) as Partial<Record<NbaPlayerPropProvider, NbaPlayerPropsCoverage>>;
  const requested = Object.keys(args.providerRequests) as NbaPlayerPropProvider[];
  const collectionComplete = args.games.length > 0
    && requested.length > 0
    && requested.every((provider) => args.providerComplete[provider] === true);
  return {
    schemaRelease: NBA_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
    observationRelease: NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
    modelRelease: NBA_PLAYER_PROPS_MODEL_RELEASE,
    calibrationRelease: NBA_PLAYER_PROPS_CALIBRATION_RELEASE,
    decisionRelease: NBA_PLAYER_PROPS_DECISION_RELEASE,
    mode: "local_observe_only",
    actionable: false,
    generatedAt: new Date(Date.parse(args.generatedAt)).toISOString(),
    games: [...args.games].sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)),
    observations: [...args.observations].sort(compareObservation),
    providerCoverage,
    providerRequests: { ...args.providerRequests },
    providerComplete: { ...args.providerComplete },
    collectionComplete,
    modelingReady: false,
    healthFindings: [...new Set(args.healthFindings ?? [])].sort(),
  };
}

function validateObservation(row: NbaPlayerPropPriceObservation): void {
  if (!row.providerObservationId || !row.providerEventId || !row.sportsbook) {
    throw new Error("NBA props observation identity is incomplete.");
  }
  if (!Number.isFinite(row.line) || !Number.isInteger(row.americanPrice) || row.americanPrice === 0) {
    throw new Error("NBA props observation contains an invalid line or price.");
  }
  timestamp(row.observedAt, "observedAt");
  timestamp(row.fetchedAt, "fetchedAt");
  if (row.scheduledStart !== null) timestamp(row.scheduledStart, "scheduledStart");
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NBA props ${field} is invalid.`);
  return parsed;
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function compareObservation(first: NbaPlayerPropPriceObservation, second: NbaPlayerPropPriceObservation): number {
  return first.providerEventId.localeCompare(second.providerEventId)
    || (first.playerName ?? first.providerPlayerId ?? "").localeCompare(second.playerName ?? second.providerPlayerId ?? "")
    || first.market.localeCompare(second.market)
    || first.line - second.line
    || first.side.localeCompare(second.side)
    || first.sportsbook.localeCompare(second.sportsbook)
    || first.provider.localeCompare(second.provider);
}
