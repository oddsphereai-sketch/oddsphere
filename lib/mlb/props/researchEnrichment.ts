import type { MlbPropMarketKey } from "./config";
import { getMlbPropMarketDefinition } from "./marketCatalog";
import type { BdlHitterPitchTypeStat, BdlPitchTypeStat, BdlResearchPlayer } from "./ballDontLieResearch";
import type { MlbHistoricalStatRow } from "./providers";
import type { MlbTeamHittingProfile } from "@/lib/providers/real_api/_mlbStatsApiClient";
import {
  buildPlayerPitchArsenalEvidence,
  buildPlayerPitchMixMatchupEvidence,
  buildPlayerPropOpponentProfile,
  buildPlayerPropRecentForm,
  type PlayerPitchArsenalEvidence,
  type PlayerBatterPitcherHistoryEvidence,
  type PlayerPitchMixMatchupEvidence,
  type PlayerPropEnvironmentEvidence,
  type PlayerPropOpponentProfile,
  type PlayerPropRecentForm,
} from "./researchEvidence";

export type PlayerPropResearchModule =
  | "player_identity"
  | "recent_form"
  | "opponent_profile"
  | "pitch_arsenal"
  | "opposing_starter"
  | "pitch_mix_matchup"
  | "park_factor"
  | "game_time_weather";

export type PlayerPropResearchCandidate = {
  rowId: string;
  playerName: string;
  marketKey: MlbPropMarketKey;
  bdlPlayerId?: number | null;
  mlbStatsPlayerId?: string | null;
  opponentTeamId?: string | number | null;
  opposingPitcherBdlId?: number | null;
  asOfTimestamp: string;
  recentForm?: PlayerPropRecentForm | null;
  opponentProfile?: PlayerPropOpponentProfile | null;
  environment?: PlayerPropEnvironmentEvidence | null;
  matchupHistory?: PlayerBatterPitcherHistoryEvidence | null;
};

export type PlayerPropResearchDependencies = {
  getBdlPlayer: (playerId: number) => Promise<BdlResearchPlayer | null>;
  getPitcherPitchTypes: (playerId: number, season: number) => Promise<BdlPitchTypeStat[]>;
  getHitterPitchTypes: (playerId: number, season: number) => Promise<BdlHitterPitchTypeStat[]>;
  getPlayerGameLogs?: (playerId: string, before: string, limit: number) => Promise<MlbHistoricalStatRow[]>;
  getHitterGameLogs?: (playerId: string, before: string, limit: number) => Promise<MlbHistoricalStatRow[]>;
  teamHittingProfiles?: MlbTeamHittingProfile[];
};

export type PlayerPropResearchEnrichment = {
  rowId: string;
  status: "complete" | "partial" | "blocked";
  memberReady: boolean;
  evidence: {
    recentForm: PlayerPropRecentForm | null;
    opponentProfile: PlayerPropOpponentProfile | null;
    pitchArsenal: PlayerPitchArsenalEvidence | null;
    pitchMatchup: PlayerPitchMixMatchupEvidence | null;
    matchupHistory: PlayerBatterPitcherHistoryEvidence | null;
    environment: PlayerPropEnvironmentEvidence | null;
  };
  availableModules: PlayerPropResearchModule[];
  missingModules: PlayerPropResearchModule[];
  providerErrors: string[];
};

export type PlayerPropResearchCoverageReport = {
  totalRows: number;
  completeRows: number;
  partialRows: number;
  blockedRows: number;
  automaticRefreshReady: boolean;
  withheldRowIds: string[];
  moduleCoverage: Record<PlayerPropResearchModule, { available: number; required: number }>;
  rows: PlayerPropResearchEnrichment[];
};

const PITCHER_RECENT_FORM_MARKETS = new Set<MlbPropMarketKey>([
  "pitcher_strikeouts",
  "pitcher_outs",
  "pitcher_hits_allowed",
  "pitcher_walks",
  "pitcher_earned_runs",
]);

const ALL_RESEARCH_MODULES: PlayerPropResearchModule[] = [
  "player_identity",
  "recent_form",
  "opponent_profile",
  "pitch_arsenal",
  "opposing_starter",
  "pitch_mix_matchup",
  "park_factor",
  "game_time_weather",
];

export async function enrichPlayerPropResearchRows(
  candidates: PlayerPropResearchCandidate[],
  dependencies: PlayerPropResearchDependencies
): Promise<PlayerPropResearchCoverageReport> {
  const playerCache = new Map<number, Promise<BdlResearchPlayer | null>>();
  const pitcherPitchCache = new Map<string, Promise<BdlPitchTypeStat[]>>();
  const hitterPitchCache = new Map<string, Promise<BdlHitterPitchTypeStat[]>>();
  const rows: PlayerPropResearchEnrichment[] = [];

  const getPlayer = (id: number) => cached(playerCache, id, () => dependencies.getBdlPlayer(id));
  const getPitcherPitches = (id: number, season: number) => cached(pitcherPitchCache, `${id}:${season}`, () => dependencies.getPitcherPitchTypes(id, season));
  const getHitterPitches = (id: number, season: number) => cached(hitterPitchCache, `${id}:${season}`, () => dependencies.getHitterPitchTypes(id, season));

  // Keep provider calls sequential. BDL quota state is shared and should not be
  // raced by a full slate of concurrent player requests.
  for (const candidate of candidates) {
    rows.push(await enrichCandidate(candidate, dependencies, { getPlayer, getPitcherPitches, getHitterPitches }));
  }

  const moduleCoverage = Object.fromEntries(ALL_RESEARCH_MODULES.map((moduleName) => [moduleName, { available: 0, required: 0 }])) as PlayerPropResearchCoverageReport["moduleCoverage"];
  for (const row of rows) {
    for (const moduleName of row.availableModules) moduleCoverage[moduleName].available++;
    for (const moduleName of [...row.availableModules, ...row.missingModules]) moduleCoverage[moduleName].required++;
  }
  const completeRows = rows.filter((row) => row.status === "complete").length;
  const partialRows = rows.filter((row) => row.status === "partial").length;
  const blockedRows = rows.filter((row) => row.status === "blocked").length;
  return {
    totalRows: rows.length,
    completeRows,
    partialRows,
    blockedRows,
    automaticRefreshReady: rows.length > 0 && completeRows === rows.length,
    withheldRowIds: rows.filter((row) => !row.memberReady).map((row) => row.rowId),
    moduleCoverage,
    rows,
  };
}

async function enrichCandidate(
  candidate: PlayerPropResearchCandidate,
  dependencies: PlayerPropResearchDependencies,
  loaders: {
    getPlayer: (id: number) => Promise<BdlResearchPlayer | null>;
    getPitcherPitches: (id: number, season: number) => Promise<BdlPitchTypeStat[]>;
    getHitterPitches: (id: number, season: number) => Promise<BdlHitterPitchTypeStat[]>;
  }
): Promise<PlayerPropResearchEnrichment> {
  const definition = getMlbPropMarketDefinition(candidate.marketKey);
  const season = Number(candidate.asOfTimestamp.slice(0, 4));
  const providerErrors: string[] = [];
  const evidence: PlayerPropResearchEnrichment["evidence"] = {
    recentForm: candidate.recentForm ?? null,
    opponentProfile: candidate.opponentProfile ?? null,
    pitchArsenal: null,
    pitchMatchup: null,
    matchupHistory: candidate.matchupHistory ?? null,
    environment: candidate.environment ?? null,
  };
  let player: BdlResearchPlayer | null = null;

  if (candidate.bdlPlayerId) {
    player = await safely(() => loaders.getPlayer(candidate.bdlPlayerId as number), providerErrors, "player_identity");
  }
  if (definition.family === "pitcher" && player) {
    const pitches = await safely(() => loaders.getPitcherPitches(player.playerId, season), providerErrors, "pitch_arsenal") ?? [];
    evidence.pitchArsenal = buildPlayerPitchArsenalEvidence({ player, pitchTypes: pitches, asOfTimestamp: candidate.asOfTimestamp });
    if (!evidence.recentForm && candidate.mlbStatsPlayerId && dependencies.getPlayerGameLogs) {
      const before = candidate.asOfTimestamp.slice(0, 10);
      const logs = await safely(() => dependencies.getPlayerGameLogs?.(candidate.mlbStatsPlayerId as string, before, 40) ?? Promise.resolve([]), providerErrors, "recent_form") ?? [];
      evidence.recentForm = buildPlayerPropRecentForm({ logs, marketKey: candidate.marketKey, asOfTimestamp: candidate.asOfTimestamp, coverage: "full_season" });
    }
    if (!evidence.opponentProfile && candidate.opponentTeamId && dependencies.teamHittingProfiles) {
      evidence.opponentProfile = buildPlayerPropOpponentProfile({
        profiles: dependencies.teamHittingProfiles,
        opponentTeamId: candidate.opponentTeamId,
        marketKey: candidate.marketKey,
        asOfTimestamp: candidate.asOfTimestamp,
      });
    }
  }

  if (definition.family !== "pitcher" && player) {
    if (!evidence.recentForm && candidate.mlbStatsPlayerId && dependencies.getHitterGameLogs) {
      const before = candidate.asOfTimestamp.slice(0, 10);
      const logs = await safely(() => dependencies.getHitterGameLogs?.(candidate.mlbStatsPlayerId as string, before, 40) ?? Promise.resolve([]), providerErrors, "recent_form") ?? [];
      evidence.recentForm = buildPlayerPropRecentForm({ logs, marketKey: candidate.marketKey, asOfTimestamp: candidate.asOfTimestamp, coverage: "full_season" });
    }
    if (candidate.opposingPitcherBdlId) {
      const opposingPitcher = await safely(() => loaders.getPlayer(candidate.opposingPitcherBdlId as number), providerErrors, "opposing_starter");
      if (opposingPitcher) {
      const hitterPitches = await safely(() => loaders.getHitterPitches(player.playerId, season), providerErrors, "pitch_mix_matchup") ?? [];
      const pitcherPitches = await safely(() => loaders.getPitcherPitches(opposingPitcher.playerId, season), providerErrors, "pitch_mix_matchup") ?? [];
      evidence.pitchMatchup = buildPlayerPitchMixMatchupEvidence({
        hitter: player,
        pitcher: opposingPitcher,
        hitterPitchTypes: hitterPitches,
        pitcherPitchTypes: pitcherPitches,
        asOfTimestamp: candidate.asOfTimestamp,
      });
      }
    }
  }

  const required = requiredModules(candidate, definition.family);
  const available = required.filter((module) => moduleAvailable(module, player, candidate, evidence));
  const missing = required.filter((module) => !available.includes(module));
  const blocking = missing.includes("player_identity") || missing.includes("opposing_starter");
  const status = blocking ? "blocked" : missing.length ? "partial" : "complete";
  return {
    rowId: candidate.rowId,
    status,
    memberReady: status === "complete" && providerErrors.length === 0,
    evidence,
    availableModules: available,
    missingModules: missing,
    providerErrors,
  };
}

function requiredModules(candidate: PlayerPropResearchCandidate, family: "pitcher" | "batter" | "milestone"): PlayerPropResearchModule[] {
  if (family === "pitcher") {
    return [
      "player_identity",
      ...(PITCHER_RECENT_FORM_MARKETS.has(candidate.marketKey) ? ["recent_form" as const] : []),
      "opponent_profile",
      "pitch_arsenal",
      "park_factor",
      "game_time_weather",
    ];
  }
  return ["player_identity", "recent_form", "opposing_starter", "pitch_mix_matchup", "park_factor", "game_time_weather"];
}

function moduleAvailable(
  module: PlayerPropResearchModule,
  player: BdlResearchPlayer | null,
  candidate: PlayerPropResearchCandidate,
  evidence: PlayerPropResearchEnrichment["evidence"]
): boolean {
  switch (module) {
    case "player_identity": return player !== null;
    case "recent_form": return evidence.recentForm !== null;
    case "opponent_profile": return evidence.opponentProfile !== null;
    case "pitch_arsenal": return evidence.pitchArsenal !== null;
    case "opposing_starter": return Boolean(candidate.opposingPitcherBdlId);
    case "pitch_mix_matchup": return evidence.pitchMatchup !== null && evidence.pitchMatchup.coverageStatus === "available";
    case "park_factor": return evidence.environment?.park.status === "available";
    case "game_time_weather": return evidence.environment?.weather.status === "available";
  }
}

function cached<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load();
  cache.set(key, pending);
  return pending;
}

async function safely<T>(load: () => Promise<T>, errors: string[], module: PlayerPropResearchModule): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    errors.push(`${module}:${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
