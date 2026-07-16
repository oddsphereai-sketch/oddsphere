import type { MlbPropMarketKey } from "./config";

export type ProviderIdMap = Record<string, string | number | null>;

export type MlbTeamEntity = {
  id: string;
  providerIds: ProviderIdMap;
  abbreviation: string;
  name: string;
  league?: string | null;
  division?: string | null;
};

export type MlbPlayerEntity = {
  id: string;
  providerIds: ProviderIdMap;
  fullName: string;
  normalizedName: string;
  teamId?: string | null;
  bats?: string | null;
  throws?: string | null;
  primaryPosition?: string | null;
  birthDate?: string | null;
  active: boolean;
};

export type MlbGameEntity = {
  id: string;
  providerIds: ProviderIdMap;
  season: number;
  gameDate: string;
  scheduledStart: string;
  homeTeamId: string;
  awayTeamId: string;
  venue?: string | null;
  roofStatus?: string | null;
  gameStatus: string;
};

export type MlbProbablePitcher = {
  gameId: string;
  teamId: string;
  playerId: string | null;
  status: "announced" | "unannounced" | "changed" | "unknown";
  asOfTimestamp: string;
  provider: string;
  rawPayload?: unknown;
};

export type MlbLineupSpot = {
  gameId: string;
  teamId: string;
  playerId: string;
  battingOrder: number;
  position?: string | null;
  lineupStatus: "confirmed" | "projected" | "unknown";
  asOfTimestamp: string;
  provider: string;
  rawPayload?: unknown;
};

export type MlbInjury = {
  playerId: string;
  teamId?: string | null;
  status: string;
  description?: string | null;
  startDate?: string | null;
  expectedReturn?: string | null;
  asOfTimestamp: string;
  provider: string;
  rawPayload?: unknown;
};

export type MlbWeatherSnapshot = {
  gameId: string;
  asOfTimestamp: string;
  temperatureF?: number | null;
  windSpeedMph?: number | null;
  windDirection?: string | null;
  humidityPct?: number | null;
  precipitationProbability?: number | null;
  conditions?: string | null;
  airDensity?: number | null;
  provider: string;
  rawPayload?: unknown;
};

export type MlbHistoricalStatRow = {
  gameId: string;
  playerId: string;
  teamId: string;
  opponentTeamId: string;
  gameDate: string;
  stats: Record<string, number | string | null>;
  provider: string;
  asOfTimestamp?: string;
};

export type PropOddsSnapshot = {
  marketKey: MlbPropMarketKey;
  gameId: string;
  playerId: string;
  sportsbook: string;
  side: "over" | "under";
  line: number;
  americanOdds: number;
  decimalOdds: number;
  impliedProbability: number;
  asOfTimestamp: string;
  snapshotRole?: "opening" | "current" | "closing" | "reference";
  provider: string;
  rawPayload?: unknown;
};

export type PropSettlementResult = {
  marketKey: MlbPropMarketKey;
  playerId: string;
  gameId: string;
  resultValue: number;
  overWon: boolean;
  underWon: boolean;
  push: boolean;
  settlementStatus: "settled" | "pending" | "void";
  provider: string;
  rawPayload?: unknown;
};

export interface PropOddsProvider {
  getPropOdds(args: { date: string; asOfTimestamp?: string; maxPages?: number }): Promise<PropOddsSnapshot[]>;
}

export interface MlbScheduleGameProvider {
  getGames(args: { date: string }): Promise<MlbGameEntity[]>;
}

export interface MlbPlayerTeamMetadataProvider {
  getTeams(): Promise<MlbTeamEntity[]>;
  getPlayers(args?: { activeOnly?: boolean }): Promise<MlbPlayerEntity[]>;
}

export interface MlbProbablePitcherProvider {
  getProbablePitchers(args: { date: string; asOfTimestamp?: string }): Promise<MlbProbablePitcher[]>;
}

export interface MlbLineupProvider {
  getLineups(args: { date: string; asOfTimestamp?: string }): Promise<MlbLineupSpot[]>;
}

export interface MlbInjuryProvider {
  getInjuries(args: { date: string; asOfTimestamp?: string }): Promise<MlbInjury[]>;
}

export interface MlbWeatherProvider {
  getWeather(args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]>;
}

export interface MlbHistoricalStatProvider {
  getPlayerGameLogs(args: {
    playerId: string;
    before: string;
    limit?: number;
  }): Promise<MlbHistoricalStatRow[]>;
}

export interface PropSettlementProvider {
  getResults(args: { date: string }): Promise<PropSettlementResult[]>;
}

export type MlbPropProviderBundle = PropOddsProvider &
  MlbScheduleGameProvider &
  MlbPlayerTeamMetadataProvider &
  MlbProbablePitcherProvider &
  MlbLineupProvider &
  MlbInjuryProvider &
  MlbWeatherProvider &
  MlbHistoricalStatProvider &
  PropSettlementProvider;
