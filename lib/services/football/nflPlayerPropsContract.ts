/**
 * Local-only NFL player-props research contract.
 *
 * This module deliberately has no database, cron, route, grade, stake, or
 * production-reader imports. It defines the immutable boundary that provider
 * observations and future shadow models must satisfy before any product work.
 */

export const NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE =
  "nfl_player_props_research_schema_2026_08_20_r4" as const;
export const NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE =
  "nfl_player_props_provider_observation_2026_09_03_r7_week_one_identity_capacity" as const;
export const NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE =
  "nfl_player_props_shadow_unfit_2026_08_20_r1" as const;
export const NFL_PLAYER_PROPS_CALIBRATION_RELEASE =
  "nfl_player_props_calibration_unfit_2026_08_20_r1" as const;
export const NFL_PLAYER_PROPS_DECISION_RELEASE =
  "nfl_player_props_decision_unfit_2026_08_20_r1" as const;

export const NFL_PLAYER_PROPS_PHASE_ONE_MARKETS = [
  "passing_attempts",
  "passing_completions",
  "passing_yards",
  "rushing_attempts",
  "rushing_yards",
  "receptions",
  "receiving_yards",
] as const;

export const NFL_PLAYER_PROPS_RESEARCH_MARKETS = [
  ...NFL_PLAYER_PROPS_PHASE_ONE_MARKETS,
  "passing_tds",
  "interceptions",
  "rushing_receiving_yards",
  "touchdowns",
  "anytime_td",
  "first_td",
  "longest_pass",
  "longest_reception",
  "longest_rush",
  "fg_made",
  "kicking_points",
] as const;

export type NflPlayerPropMarket = (typeof NFL_PLAYER_PROPS_RESEARCH_MARKETS)[number];
export type NflPlayerPropPhase = "preseason" | "regular" | "postseason";
export type NflPlayerPropProvider = "balldontlie" | "sharpapi";
export type NflPlayerPropSide = "over" | "under" | "yes";
export type NflPlayerPropOfferType = "over_under" | "milestone";

export type NflPlayerPropGameIdentity = {
  season: number;
  week: number;
  phase: NflPlayerPropPhase;
  providerGameId: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamName: string;
  awayTeamName: string;
};

export type NflPlayerPropPriceObservation = {
  provider: NflPlayerPropProvider;
  providerObservationId: string;
  providerEventId: string;
  canonicalGameId: string | null;
  providerPlayerId: string | null;
  playerName: string | null;
  playerTeam: string | null;
  sportsbook: string;
  market: NflPlayerPropMarket;
  providerMarket: string;
  offerType: NflPlayerPropOfferType;
  side: NflPlayerPropSide;
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

export type NflPlayerPropsProviderNormalization = {
  rows: NflPlayerPropPriceObservation[];
  inputRows: number;
  rejectedRows: number;
  unknownMarkets: Record<string, number>;
};

export type NflPlayerPropsCoverage = {
  rows: number;
  events: number;
  canonicalGames: number;
  playersWithProviderIdentity: number;
  playersWithName: number;
  sportsbooks: string[];
  markets: Record<string, number>;
  researchMarketRows: number;
  phaseOneTwoWayRows: number;
  milestoneRows: number;
  completeTwoWayBuckets: number;
  openingRows: number;
  currentRows: number;
  invalidFreshnessRows: number;
};

export type NflPlayerPropsObservationSnapshot = {
  schemaRelease: typeof NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE;
  snapshotRelease: typeof NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE;
  shadowModelRelease: typeof NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE;
  calibrationRelease: typeof NFL_PLAYER_PROPS_CALIBRATION_RELEASE;
  decisionRelease: typeof NFL_PLAYER_PROPS_DECISION_RELEASE;
  mode: "local_observe_only";
  actionable: false;
  generatedAt: string;
  fetchedAt: string;
  season: number;
  week: number;
  phase: NflPlayerPropPhase;
  games: NflPlayerPropGameIdentity[];
  observations: NflPlayerPropPriceObservation[];
  providerCoverage: Partial<Record<NflPlayerPropProvider, NflPlayerPropsCoverage>>;
  providerRequests: Partial<Record<NflPlayerPropProvider, number>>;
  collectionComplete: boolean;
  modelingReady: false;
  healthFindings: string[];
};

const PHASE_ONE = new Set<string>(NFL_PLAYER_PROPS_PHASE_ONE_MARKETS);

export function summarizeNflPlayerPropsCoverage(
  rows: NflPlayerPropPriceObservation[],
): NflPlayerPropsCoverage {
  const markets = new Map<string, number>();
  const paired = new Map<string, Set<NflPlayerPropSide>>();
  const playerIds = new Set<string>();
  const playerNames = new Set<string>();
  for (const row of rows) {
    markets.set(row.market, (markets.get(row.market) ?? 0) + 1);
    if (row.providerPlayerId) playerIds.add(`${row.provider}:${row.providerPlayerId}`);
    if (row.playerName) playerNames.add(`${row.provider}:${row.playerName.toLowerCase()}`);
    if (row.offerType === "over_under") {
      const key = [row.provider, row.providerEventId, row.sportsbook, row.providerPlayerId ?? row.playerName, row.market, row.line].join("|");
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
    researchMarketRows: rows.length,
    phaseOneTwoWayRows: rows.filter((row) => PHASE_ONE.has(row.market) && row.offerType === "over_under").length,
    milestoneRows: rows.filter((row) => row.offerType === "milestone").length,
    completeTwoWayBuckets: [...paired.values()].filter((sides) => sides.has("over") && sides.has("under")).length,
    openingRows: rows.filter((row) => row.isOpening).length,
    currentRows: rows.filter((row) => !row.isOpening).length,
    invalidFreshnessRows: rows.filter((row) => !Number.isFinite(Date.parse(row.observedAt))).length,
  };
}

export function buildNflPlayerPropsObservationSnapshot(args: {
  generatedAt?: string;
  fetchedAt: string;
  season: number;
  week: number;
  phase: NflPlayerPropPhase;
  games: NflPlayerPropGameIdentity[];
  observations: NflPlayerPropPriceObservation[];
  providerRequests: Partial<Record<NflPlayerPropProvider, number>>;
  providerComplete: Partial<Record<NflPlayerPropProvider, boolean>>;
  healthFindings?: string[];
}): NflPlayerPropsObservationSnapshot {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  if (!Number.isInteger(args.season) || args.season < 2002) throw new Error("NFL props season is invalid.");
  if (!Number.isInteger(args.week) || args.week < 1 || args.week > 22) throw new Error("NFL props week is invalid.");
  if (!Number.isFinite(Date.parse(args.fetchedAt)) || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("NFL props snapshot timestamps must be valid ISO timestamps.");
  }
  const duplicateGames = args.games.length !== new Set(args.games.map((game) => game.providerGameId)).size;
  if (duplicateGames) throw new Error("NFL props snapshot contains duplicate game identities.");
  const invalidRows = args.observations.filter((row) => (
    !row.providerEventId || !row.sportsbook || !Number.isFinite(row.line)
    || !Number.isFinite(row.americanPrice) || row.americanPrice === 0
    || !Number.isFinite(Date.parse(row.observedAt))
  ));
  if (invalidRows.length > 0) throw new Error(`NFL props snapshot contains ${invalidRows.length} invalid price rows.`);
  const gameIds = new Set(args.games.map((game) => game.providerGameId));
  const bdlOutsideSlate = args.observations.filter((row) => row.provider === "balldontlie" && !gameIds.has(row.providerEventId));
  if (bdlOutsideSlate.length > 0) throw new Error("NFL props BALLDONTLIE rows fall outside the requested slate.");
  const providerCoverage = Object.fromEntries(
    (["balldontlie", "sharpapi"] as const)
      .map((provider) => [provider, summarizeNflPlayerPropsCoverage(args.observations.filter((row) => row.provider === provider))])
      .filter(([, coverage]) => (coverage as NflPlayerPropsCoverage).rows > 0),
  ) as Partial<Record<NflPlayerPropProvider, NflPlayerPropsCoverage>>;
  const requestedProviders = Object.keys(args.providerRequests) as NflPlayerPropProvider[];
  const collectionComplete = args.games.length > 0
    && requestedProviders.length > 0
    && requestedProviders.every((provider) => args.providerComplete[provider] === true);
  return {
    schemaRelease: NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
    snapshotRelease: NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
    shadowModelRelease: NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
    calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
    mode: "local_observe_only",
    actionable: false,
    generatedAt,
    fetchedAt: args.fetchedAt,
    season: args.season,
    week: args.week,
    phase: args.phase,
    games: [...args.games].sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)),
    observations: [...args.observations].sort(compareObservation),
    providerCoverage,
    providerRequests: args.providerRequests,
    collectionComplete,
    modelingReady: false,
    healthFindings: [...(args.healthFindings ?? [])],
  };
}

function compareObservation(first: NflPlayerPropPriceObservation, second: NflPlayerPropPriceObservation): number {
  return first.providerEventId.localeCompare(second.providerEventId)
    || (first.playerName ?? first.providerPlayerId ?? "").localeCompare(second.playerName ?? second.providerPlayerId ?? "")
    || first.market.localeCompare(second.market)
    || first.line - second.line
    || first.side.localeCompare(second.side)
    || first.sportsbook.localeCompare(second.sportsbook)
    || first.provider.localeCompare(second.provider);
}
