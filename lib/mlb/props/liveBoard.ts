import { createHash, randomUUID } from "node:crypto";
import type {
  PlayerPropPreviewRow,
  PlayerPropsDashboardData,
} from "@/app/mlb/props/components/PlayerPropsDashboard";
import { BallDontLieProvider } from "@/lib/providers/real_api/BallDontLieProvider";
import {
  getMlbTeamHittingProfiles,
  getBatterVsPitcherStats,
  getActiveRoster,
  getPitcherSeasonStats,
  searchPersonsByName,
  type MlbRosterEntry,
} from "@/lib/providers/real_api/_mlbStatsApiClient";
import { normalizePlayerName } from "./entityResolution";
import { loadSlateEnvironmentResearch } from "./environmentResearch";
import { allMlbPropMarketDefinitions, getMlbPropMarketDefinition } from "./marketCatalog";
import { resolveMlbStatsTeamId, resolveMlbTeamAlias } from "./mlbTeamAliases";
import { NwsWeatherClient } from "./nwsWeatherClient";
import {
  american_to_implied_probability,
  expected_value,
  fair_american_odds,
  remove_vig_two_way,
} from "./oddsMath";
import {
  BallDontLieMlbPropsClient,
  MLBStatsAPIClient,
  MLBStatsGameLogClient,
} from "./providerClients";
import type {
  MlbGameEntity,
  MlbProbablePitcher,
  PropOddsSnapshot,
} from "./providers";
import {
  realPitcherModelContextKey,
  scoreRealMlbPropsForPaper,
  type RealPitcherModelContext,
  type RealPitcherSeasonStat,
  type RealPropsCandidateSummary,
} from "./realScoring";
import { BallDontLieResearchClient, type BdlResearchPlayer } from "./ballDontLieResearch";
import {
  enrichPlayerPropResearchRows,
  type PlayerPropResearchEnrichment,
} from "./researchEnrichment";
import {
  buildPlayerPropOpponentProfile,
  buildPlayerPropRecentForm,
  buildPlayerBatterPitcherHistoryEvidence,
  type PlayerBatterPitcherHistoryEvidence,
} from "./researchEvidence";
import { StatcastParkFactorClient } from "./statcastParkFactors";
import {
  loadLatestMlbPropsBoardSnapshot,
  measureMlbPropsBoardSnapshot,
  DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES,
  DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES,
  publishMlbPropsBoardSnapshot,
  type MlbPropsBoardMovement,
  type MlbPropsBoardSnapshot,
  type MlbPropsBoardValidation,
} from "./boardSnapshotStore";
import { assessPropPrice } from "./pricePolicy";
import {
  syncInternalMlbPropsTracking,
  type MlbPropsTrackingSyncResult,
} from "./internalTracking";

type RefreshArgs = {
  slateDate: string;
  refreshMode?: "fast" | "full";
  asOfTimestamp?: string;
  persist?: boolean;
};

type PlayerIdentity = {
  bdlPlayerId: number;
  player: BdlResearchPlayer;
  mlbStatsPlayerId: string | null;
};

type MappedOddsRow = {
  odds: PropOddsSnapshot;
  game: MlbGameEntity;
  bdlGameId: string;
  bdlPlayerId: number;
  raw: Record<string, unknown>;
};

type IntegratedPropSignal = {
  side: "over" | "under";
  modelProbability: number;
  finalProbability: number;
  overModelProbability: number;
  underModelProbability: number;
  overFinalProbability: number;
  underFinalProbability: number;
  playGrade: "BEST_ANGLE" | "LEAN" | "WATCHLIST";
  confidence: number;
  reasonCodes: string[];
  projection: number;
  modelFamily: string;
};

export type MlbPropsBoardRefreshResult = {
  published: boolean;
  scoringRunId: string | null;
  usedPreviousSnapshot: boolean;
  snapshot: MlbPropsBoardSnapshot;
  tracking: MlbPropsTrackingSyncResult;
  providerCalls: {
    balldontlie: number;
    balldontlieOdds: number;
    balldontlieResearch: number;
    balldontlieLineups: number;
  };
};

const ACTIONABLE_GRADES = new Set(["BEST_ANGLE", "LEAN"]);
const DEFAULT_MAX_ODDS_AGE_MINUTES = 45;
const DEFAULT_MAX_SOURCE_ODDS_ROWS = 8_000;
const DEFAULT_MAX_BOARD_ROWS = 4_000;
const DEFAULT_MAX_BDL_CALLS_PER_REFRESH = 300;

export async function refreshMlbPropsBoard(args: RefreshArgs): Promise<MlbPropsBoardRefreshResult> {
  const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
  const requestedMode = args.refreshMode ?? "fast";
  const previous = await loadLatestMlbPropsBoardSnapshot(args.slateDate).catch(() => null);
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the live MLB props board.");

  const mlbStats = new MLBStatsAPIClient();
  const oddsClient = new BallDontLieMlbPropsClient(apiKey);
  const [games, probablePitchers, sourceOdds] = await Promise.all([
    mlbStats.getGames({ date: args.slateDate }),
    mlbStats.getProbablePitchers({ date: args.slateDate, asOfTimestamp }),
    oddsClient.getPropOdds({ date: args.slateDate, asOfTimestamp, maxPages: 5 }),
  ]);
  const providerCoverage = oddsClient.getCoverageSummary();
  const maxSourceRows = envPositiveInteger("ODDSPHERE_PROPS_MAX_SOURCE_ODDS_ROWS", DEFAULT_MAX_SOURCE_ODDS_ROWS);
  if (sourceOdds.length > maxSourceRows) {
    throw new Error(`MLB props source-row circuit breaker opened: ${sourceOdds.length} exceeds ${maxSourceRows}.`);
  }

  const mappedOdds = mapOddsToMlbGames(sourceOdds, games);
  const previousIdentities = identitiesFromPrevious(previous);
  const requiredPlayerIds = [...new Set(mappedOdds.map((row) => row.bdlPlayerId))];
  const starterContextChangedGameIds = new Set([
    ...probablePitcherSlateChangedGames(previous, games, probablePitchers),
    ...bdlOpposingPitcherChangedGames(previous, mappedOdds, previousIdentities),
  ]);
  const needsFullResearch = requestedMode === "full" || !previous;
  const refreshMode: "fast" | "full" = needsFullResearch ? "full" : "fast";
  const openingOdds = await loadOpeningPropOdds({
    oddsClient,
    sourceOdds,
    previous,
    asOfTimestamp,
    refreshMode,
  });

  const researchClient = new BallDontLieResearchClient(apiKey);
  const identities = new Map(previousIdentities);
  const missingIdentityIds = requiredPlayerIds.filter((id) => !identities.has(id));
  if (missingIdentityIds.length) {
    for (const [id, identity] of await loadPlayerIdentities(missingIdentityIds, researchClient, probablePitchers, games)) {
      identities.set(id, identity);
    }
  }

  const lineupResult = await loadLineups(mappedOdds, apiKey);
  const lineupRows = lineupResult.rows;
  const environment = await loadSlateEnvironmentResearch({
    games,
    asOfTimestamp,
    parkFactors: new StatcastParkFactorClient(),
    weather: new NwsWeatherClient(mlbStats),
  });

  const researchByKey = needsFullResearch
    ? await loadFullResearch({ mappedOdds, identities, games, probablePitchers, previous, environmentByGame: environment.byGameId, asOfTimestamp, researchClient })
    : reusePreviousResearch(previous as MlbPropsBoardSnapshot, environment.byGameId, starterContextChangedGameIds);

  const seasonStats = needsFullResearch
    ? await loadProbablePitcherSeasonStats(probablePitchers, args.slateDate)
    : new Map(previous?.modelContext?.probablePitcherSeasonStats ?? []);
  const pitcherModelContext = buildPitcherModelContext({ mappedOdds, identities, researchByKey });
  const scoringOdds = sourceOdds.map((odds) => {
    const raw = record(odds.rawPayload);
    const bdlPlayerId = numberValue(raw.bdl_player_id ?? odds.playerId.replace(/^balldontlie-player-/, ""));
    const identity = bdlPlayerId === null ? null : identities.get(bdlPlayerId);
    return identity && !stringValue(raw.player_name)
      ? { ...odds, rawPayload: { ...raw, player_name: identity.player.fullName } }
      : odds;
  });
  const scoring = sourceOdds.length
    ? await scoreRealMlbPropsForPaper({
      games,
      probablePitchers,
      odds: scoringOdds,
      date: args.slateDate,
      asOfTimestamp,
      seasonStatsByPlayerId: seasonStats,
      modelContextByGameAndPlayer: pitcherModelContext,
      providerContext: {
        selectedOddsProvider: "balldontlie",
        sharpApiPropRows: 0,
        bdlPropRows: sourceOdds.length,
        fallbackReason: null,
      },
    })
    : null;

  const props = attachMlbPropOddsMovement(buildDashboardRows({
    mappedOdds,
    identities,
    probablePitchers,
    lineupRows,
    researchByKey,
    scoringCandidates: scoring?.summary.sampleCandidates ?? [],
    asOfTimestamp,
  }), openingOdds, previous);
  const data = buildDashboardData({
    slateDate: args.slateDate,
    asOfTimestamp,
    games,
    probablePitchers,
    props,
    sourceOdds,
    environmentErrors: environment.errors,
  });
  const validation = validateMlbPropsBoardData({
    data,
    sourceRows: sourceOdds.length,
    mappedRows: mappedOdds.length,
    asOfTimestamp,
    providerCoverage,
  });
  const movement = compareMlbPropsBoardMovement(previous, data.props);
  const snapshot: MlbPropsBoardSnapshot = {
    schemaVersion: 1,
    snapshotId: randomUUID(),
    slateDate: args.slateDate,
    asOfTimestamp,
    refreshMode,
    data,
    validation,
    movement,
    modelContext: {
      probablePitcherSeasonStats: [...seasonStats.entries()],
      openingPropOdds: openingOdds,
    },
  };
  enforceSnapshotPayloadLimits(snapshot);

  const providerCalls = {
    balldontlieOdds: oddsClient.getClient().getRequestCount(),
    balldontlieResearch: researchClient.getClient().getRequestCount(),
    balldontlieLineups: lineupResult.balldontlieCalls,
  };
  const balldontlieCalls = providerCalls.balldontlieOdds + providerCalls.balldontlieResearch + providerCalls.balldontlieLineups;
  const maxBdlCalls = envPositiveInteger("ODDSPHERE_PROPS_MAX_BDL_CALLS_PER_REFRESH", DEFAULT_MAX_BDL_CALLS_PER_REFRESH);
  if (balldontlieCalls > maxBdlCalls) {
    throw new Error(`MLB props BDL request budget exceeded: ${balldontlieCalls}/${maxBdlCalls}.`);
  }

  if (!validation.publishable || args.persist === false) {
    return {
      published: false,
      scoringRunId: null,
      usedPreviousSnapshot: Boolean(previous),
      snapshot,
      tracking: disabledTrackingResult(),
      providerCalls: {
        balldontlie: balldontlieCalls,
        ...providerCalls,
      },
    };
  }
  const scoringRunId = await publishMlbPropsBoardSnapshot(snapshot);
  let tracking: MlbPropsTrackingSyncResult;
  try {
    tracking = await syncInternalMlbPropsTracking(snapshot);
  } catch (error) {
    tracking = {
      status: "failed",
      tableAvailable: false,
      candidatesSeen: 0,
      candidatesDue: 0,
      entriesLocked: 0,
      closingPricesUpdated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    published: true,
    scoringRunId,
    usedPreviousSnapshot: false,
    snapshot,
    tracking,
    providerCalls: {
      balldontlie: balldontlieCalls,
      ...providerCalls,
    },
  };
}

function disabledTrackingResult(): MlbPropsTrackingSyncResult {
  return {
    status: "disabled",
    tableAvailable: false,
    candidatesSeen: 0,
    candidatesDue: 0,
    entriesLocked: 0,
    closingPricesUpdated: 0,
    error: null,
  };
}

function mapOddsToMlbGames(odds: PropOddsSnapshot[], games: MlbGameEntity[]): MappedOddsRow[] {
  const rows: MappedOddsRow[] = [];
  for (const oddsRow of odds) {
    const raw = record(oddsRow.rawPayload);
    const home = resolveMlbTeamAlias(stringValue(raw.event_home_team));
    const away = resolveMlbTeamAlias(stringValue(raw.event_away_team));
    const bdlGameId = stringValue(raw.bdl_game_id);
    const bdlPlayerId = numberValue(raw.bdl_player_id ?? oddsRow.playerId.replace(/^balldontlie-player-/, ""));
    if (!home || !away || !bdlGameId || bdlPlayerId === null) continue;
    const candidates = games.filter((game) => {
      const gameHome = resolveMlbStatsTeamId(game.homeTeamId);
      const gameAway = resolveMlbStatsTeamId(game.awayTeamId);
      if (gameHome?.id !== home.id || gameAway?.id !== away.id) return false;
      const eventStart = stringValue(raw.event_start_time);
      if (!eventStart) return true;
      const difference = Math.abs(Date.parse(game.scheduledStart) - Date.parse(eventStart));
      return Number.isFinite(difference) && difference <= 90 * 60_000;
    });
    if (candidates.length !== 1) continue;
    rows.push({ odds: oddsRow, game: candidates[0], bdlGameId, bdlPlayerId, raw });
  }
  return rows;
}

async function loadPlayerIdentities(
  ids: number[],
  researchClient: BallDontLieResearchClient,
  probablePitchers: MlbProbablePitcher[],
  games: MlbGameEntity[],
): Promise<Map<number, PlayerIdentity>> {
  const out = new Map<number, PlayerIdentity>();
  const [players, rosterIndex] = await Promise.all([
    researchClient.getPlayersByIds(ids),
    loadSlateRosterIndex(games),
  ]);
  await mapWithConcurrency(ids, 8, async (id) => {
    const player = players.get(id) ?? null;
    if (!player) return;
    const mlbStatsPlayerId = await resolveMlbStatsPlayerId(player, probablePitchers, rosterIndex);
    out.set(id, { bdlPlayerId: id, player, mlbStatsPlayerId });
  });
  return out;
}

async function resolveMlbStatsPlayerId(
  player: BdlResearchPlayer,
  probablePitchers: MlbProbablePitcher[],
  rosterIndex: Map<string, MlbRosterEntry[]>,
): Promise<string | null> {
  const probable = probablePitchers.find((row) => {
    const name = probablePitcherName(row);
    return row.playerId && name && normalizePlayerName(name) === normalizePlayerName(player.fullName);
  });
  if (probable?.playerId) return probable.playerId;
  const team = resolveMlbTeamAlias(player.teamAbbreviation);
  const rosterMatches = (team ? rosterIndex.get(team.id) ?? [] : [])
    .filter((row) => normalizePlayerName(row.fullName) === normalizePlayerName(player.fullName));
  if (rosterMatches.length === 1) return `mlbstats-player-${rosterMatches[0].personId}`;
  const matches = (await searchPersonsByName(player.fullName, { quiet: true }))
    .filter((row) => normalizePlayerName(row.fullName) === normalizePlayerName(player.fullName));
  const teamMatches = matches.filter((row) => {
    const team = row.currentTeamId ? resolveMlbStatsTeamId(row.currentTeamId) : null;
    return team?.abbreviation === player.teamAbbreviation;
  });
  const selected = teamMatches.length === 1 ? teamMatches[0] : matches.length === 1 ? matches[0] : null;
  return selected ? `mlbstats-player-${selected.id}` : null;
}

async function loadSlateRosterIndex(games: MlbGameEntity[]): Promise<Map<string, MlbRosterEntry[]>> {
  const out = new Map<string, MlbRosterEntry[]>();
  const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId])
    .map((id) => numberValue(String(id).replace(/^mlbstats-team-/, "")))
    .filter((id): id is number => id !== null))];
  await mapWithConcurrency(teamIds, 6, async (teamId) => {
    const alias = resolveMlbStatsTeamId(teamId);
    const roster = await getActiveRoster(teamId, { quiet: true }).catch(() => null);
    if (alias && roster) out.set(alias.id, roster);
  });
  return out;
}

async function loadLineups(mappedOdds: MappedOddsRow[], apiKey: string) {
  const provider = new BallDontLieProvider(apiKey);
  const out = new Map<string, Awaited<ReturnType<BallDontLieProvider["getLineups"]>>>();
  const gameIds = [...new Set(mappedOdds.map((row) => Number(row.bdlGameId)).filter(Number.isSafeInteger))];
  const rows = await provider.getLineupsForGames(gameIds).catch(() => []);
  for (const gameId of gameIds) {
    out.set(String(gameId), rows.filter((row) => row.game_external_id === gameId));
  }
  return { rows: out, balldontlieCalls: provider.getClient().getRequestCount() };
}

async function loadFullResearch(args: {
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  previous: MlbPropsBoardSnapshot | null;
  environmentByGame: Map<string, NonNullable<PlayerPropPreviewRow["environment"]>>;
  asOfTimestamp: string;
  researchClient: BallDontLieResearchClient;
}): Promise<Map<string, PlayerPropResearchEnrichment>> {
  const gameLogs = new MLBStatsGameLogClient();
  const profiles = await getMlbTeamHittingProfiles(Number(args.asOfTimestamp.slice(0, 4)), { quiet: true }).catch(() => null) ?? [];
  const unique = uniqueResearchRows(args.mappedOdds);
  const slateDate = args.mappedOdds[0]?.game.gameDate ?? args.asOfTimestamp.slice(0, 10);
  const completedSameDayGames = new Set(args.games
    .filter((game) => game.gameDate === slateDate && isFinalGameStatus(game.gameStatus))
    .map((game) => game.id));
  const logCache = await loadRecentLogCache(unique, args.identities, gameLogs, slateDate);
  const matchupHistories = await loadBatterPitcherHistories({
    mappedOdds: unique,
    identities: args.identities,
    probablePitchers: args.probablePitchers,
    previous: args.previous,
    asOfTimestamp: args.asOfTimestamp,
  });
  const candidates = [];
  for (const row of unique) {
    const identity = args.identities.get(row.bdlPlayerId);
    const definition = getMlbPropMarketDefinition(row.odds.marketKey);
    const mlbId = identity?.mlbStatsPlayerId ?? null;
    const logFamily = definition.family === "pitcher" ? "pitcher" : "hitter";
    const logKey = `${mlbId ?? "unmapped"}:${logFamily}`;
    const fetchedLogs = mlbId ? logCache.get(logKey) ?? [] : [];
    const logs = fetchedLogs
      .filter((log) => log.gameDate < slateDate || completedSameDayGames.has(log.gameId))
      .map((log) => completedSameDayGames.has(log.gameId)
        ? { ...log, asOfTimestamp: new Date(Date.parse(args.asOfTimestamp) - 1).toISOString() }
        : log);
    const opponentTeamId = opponentTeamFor(row, identity);
    const opposingProbable = opposingProbableFor(row, identity, args.probablePitchers);
    const matchupHistoryKey = mlbMatchupKey(mlbId, opposingProbable?.playerId ?? null);
    candidates.push({
      rowId: researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id),
      playerName: identity?.player.fullName ?? stringValue(row.raw.player_name) ?? `Player ${row.bdlPlayerId}`,
      marketKey: row.odds.marketKey,
      bdlPlayerId: row.bdlPlayerId,
      mlbStatsPlayerId: mlbId,
      opponentTeamId,
      opposingPitcherBdlId: opposingPitcherId(row, identity),
      asOfTimestamp: args.asOfTimestamp,
      recentForm: buildPlayerPropRecentForm({ logs, marketKey: row.odds.marketKey, asOfTimestamp: args.asOfTimestamp, coverage: "full_season" }),
      opponentProfile: definition.family === "pitcher" && opponentTeamId
        ? buildPlayerPropOpponentProfile({ profiles, opponentTeamId, marketKey: row.odds.marketKey, asOfTimestamp: args.asOfTimestamp })
        : null,
      environment: args.environmentByGame.get(row.game.id) ?? null,
      matchupHistory: matchupHistoryKey ? matchupHistories.get(matchupHistoryKey) ?? null : null,
    });
  }
  const season = Number(args.asOfTimestamp.slice(0, 4));
  const hitterIds = new Set<number>();
  const pitcherIds = new Set<number>();
  const researchPlayerIds = new Set<number>();
  for (const row of unique) {
    researchPlayerIds.add(row.bdlPlayerId);
    if (getMlbPropMarketDefinition(row.odds.marketKey).family === "pitcher") {
      pitcherIds.add(row.bdlPlayerId);
    } else {
      hitterIds.add(row.bdlPlayerId);
      const opposingId = opposingPitcherId(row, args.identities.get(row.bdlPlayerId));
      if (opposingId !== null) {
        researchPlayerIds.add(opposingId);
        pitcherIds.add(opposingId);
      }
    }
  }
  const researchPlayers = await args.researchClient.getPlayersByIds([...researchPlayerIds]);
  const pitcherPitches = await args.researchClient.getPitcherPitchTypesForPlayers({ playerIds: [...pitcherIds], season });
  const hitterPitches = await args.researchClient.getHitterPitchTypesForPlayers({ playerIds: [...hitterIds], season });
  const report = await enrichPlayerPropResearchRows(candidates, {
    getBdlPlayer: async (id) => researchPlayers.get(id) ?? null,
    getPitcherPitchTypes: async (id) => pitcherPitches.get(id) ?? [],
    getHitterPitchTypes: async (id) => hitterPitches.get(id) ?? [],
    teamHittingProfiles: profiles,
  });
  return new Map(report.rows.map((row) => [row.rowId, row]));
}

function buildPitcherModelContext(args: {
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  researchByKey: Map<string, PlayerPropResearchEnrichment>;
}): Map<string, RealPitcherModelContext> {
  const out = new Map<string, RealPitcherModelContext>();
  for (const row of args.mappedOdds) {
    if (getMlbPropMarketDefinition(row.odds.marketKey).family !== "pitcher") continue;
    const playerId = args.identities.get(row.bdlPlayerId)?.mlbStatsPlayerId;
    if (!playerId) continue;
    const evidence = args.researchByKey.get(researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id))?.evidence;
    const opponent = evidence?.opponentProfile ?? null;
    const environment = evidence?.environment ?? null;
    out.set(realPitcherModelContextKey(row.game.id, playerId), {
      opponentStrikeoutRate: opponent?.strikeoutRate.value ?? null,
      opponentLeagueStrikeoutRate: opponent?.strikeoutRate.leagueAverage ?? null,
      opponentOps: opponent?.ops.value ?? null,
      opponentLeagueOps: opponent?.ops.leagueAverage ?? null,
      parkStrikeoutFactor: environment?.park.status === "available" ? environment.park.strikeoutFactor : null,
      parkRunFactor: environment?.park.status === "available" ? environment.park.runFactor : null,
      temperatureF: environment?.weather.status === "available" ? environment.weather.temperatureF : null,
      windSpeedMph: environment?.weather.status === "available" ? environment.weather.windSpeedMph : null,
      precipitationProbability: environment?.weather.status === "available" ? environment.weather.precipitationProbability : null,
      roofStatus: environment?.roofStatus ?? null,
      weatherAvailable: environment?.weather.status === "available" || environment?.roofStatus === "dome",
    });
  }
  return out;
}

async function loadRecentLogCache(
  rows: MappedOddsRow[],
  identities: Map<number, PlayerIdentity>,
  gameLogs: MLBStatsGameLogClient,
  slateDate: string,
): Promise<Map<string, Awaited<ReturnType<MLBStatsGameLogClient["getPlayerGameLogs"]>>>> {
  const requests = new Map<string, { playerId: string; family: "pitcher" | "hitter" }>();
  for (const row of rows) {
    const playerId = identities.get(row.bdlPlayerId)?.mlbStatsPlayerId;
    if (!playerId) continue;
    const family = getMlbPropMarketDefinition(row.odds.marketKey).family === "pitcher" ? "pitcher" : "hitter";
    requests.set(`${playerId}:${family}`, { playerId, family });
  }
  const out = new Map<string, Awaited<ReturnType<MLBStatsGameLogClient["getPlayerGameLogs"]>>>();
  const concurrency = Math.min(12, envPositiveInteger("ODDSPHERE_PROPS_GAME_LOG_CONCURRENCY", 8));
  await mapWithConcurrency([...requests.entries()], concurrency, async ([key, request]) => {
    const logs = request.family === "pitcher"
      ? await gameLogs.getPlayerGameLogs({ playerId: request.playerId, before: addCalendarDays(slateDate, 1), limit: 40 }).catch(() => [])
      : await gameLogs.getHitterGameLogs({ playerId: request.playerId, before: addCalendarDays(slateDate, 1), limit: 40 }).catch(() => []);
    out.set(key, logs);
  });
  return out;
}

function reusePreviousResearch(
  previous: MlbPropsBoardSnapshot,
  environmentByGame: Map<string, NonNullable<PlayerPropPreviewRow["environment"]>>,
  invalidateHitterMatchupGameIds: Set<string> = new Set(),
): Map<string, PlayerPropResearchEnrichment> {
  const out = new Map<string, PlayerPropResearchEnrichment>();
  for (const row of previous.data.props) {
    const bdlPlayerId = row.providerIds?.bdlPlayerId;
    if (!bdlPlayerId) continue;
    const key = researchKey(bdlPlayerId, row.market as Parameters<typeof researchKey>[1], row.providerIds?.gameId ?? "");
    const previousEvidence = researchEvidenceForSnapshotRow(previous, row);
    const hitterMatchupInvalid = invalidateHitterMatchupGameIds.has(row.providerIds?.gameId ?? "") && row.marketFamily !== "pitcher";
    const evidence = {
      recentForm: previousEvidence.recentForm,
      opponentProfile: previousEvidence.opponentProfile,
      pitchArsenal: previousEvidence.pitchArsenal,
      pitchMatchup: hitterMatchupInvalid ? null : previousEvidence.pitchMatchup,
      matchupHistory: hitterMatchupInvalid ? null : previousEvidence.matchupHistory,
      environment: environmentByGame.get(row.providerIds?.gameId ?? "") ?? previousEvidence.environment,
    };
    const missingModules = [
      ...(hitterMatchupInvalid ? ["pitch_mix_matchup" as const] : []),
      ...(evidence.environment?.park.status === "available" ? [] : ["park_factor" as const]),
      ...(evidence.environment?.weather.status === "available" || evidence.environment?.roofStatus === "dome" ? [] : ["game_time_weather" as const]),
    ];
    const availableModules = [
      ...(evidence.recentForm ? ["recent_form" as const] : []),
      ...(evidence.opponentProfile ? ["opponent_profile" as const] : []),
      ...(evidence.pitchArsenal ? ["pitch_arsenal" as const] : []),
      ...(evidence.pitchMatchup ? ["pitch_mix_matchup" as const] : []),
      ...(evidence.environment?.park.status === "available" ? ["park_factor" as const] : []),
      ...(evidence.environment?.weather.status === "available" || evidence.environment?.roofStatus === "dome" ? ["game_time_weather" as const] : []),
      "player_identity" as const,
    ];
    out.set(key, {
      rowId: key,
      status: row.missingFeatures.length || missingModules.length ? "partial" : "complete",
      memberReady: row.missingFeatures.length === 0 && missingModules.length === 0,
      evidence,
      availableModules,
      missingModules,
      providerErrors: [],
    });
  }
  return out;
}

async function loadBatterPitcherHistories(args: {
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  probablePitchers: MlbProbablePitcher[];
  previous: MlbPropsBoardSnapshot | null;
  asOfTimestamp: string;
}): Promise<Map<string, PlayerBatterPitcherHistoryEvidence>> {
  const histories = matchupHistoriesFromPrevious(args.previous);
  const pairs = new Map<string, { hitterId: number; pitcherId: number; hitterName: string; pitcherName: string }>();
  for (const row of args.mappedOdds) {
    const definition = getMlbPropMarketDefinition(row.odds.marketKey);
    if (definition.family === "pitcher") continue;
    const identity = args.identities.get(row.bdlPlayerId);
    const hitterId = mlbPersonNumber(identity?.mlbStatsPlayerId ?? null);
    const opposingProbable = opposingProbableFor(row, identity, args.probablePitchers);
    const pitcherId = mlbPersonNumber(opposingProbable?.playerId ?? null);
    const key = mlbMatchupKey(identity?.mlbStatsPlayerId ?? null, opposingProbable?.playerId ?? null);
    const pitcherName = opposingProbable ? probablePitcherName(opposingProbable) : null;
    if (!key || hitterId === null || pitcherId === null || !identity || !pitcherName || histories.has(key)) continue;
    pairs.set(key, { hitterId, pitcherId, hitterName: identity.player.fullName, pitcherName });
  }

  const maxNewPairs = envPositiveInteger("ODDSPHERE_PROPS_MAX_NEW_MATCHUP_HISTORY_CALLS", 60);
  const concurrency = Math.min(8, envPositiveInteger("ODDSPHERE_PROPS_MATCHUP_HISTORY_CONCURRENCY", 4));
  const timeoutMs = envPositiveInteger("ODDSPHERE_PROPS_MATCHUP_HISTORY_TIMEOUT_MS", 7_000);
  const pending = [...pairs.entries()].slice(0, maxNewPairs);
  await mapWithConcurrency(pending, concurrency, async ([key, pair]) => {
    const record = await getBatterVsPitcherStats(pair.hitterId, pair.pitcherId, {
      quiet: true,
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!record) return;
    histories.set(key, buildPlayerBatterPitcherHistoryEvidence({
      record,
      hitterName: pair.hitterName,
      pitcherName: pair.pitcherName,
      asOfTimestamp: args.asOfTimestamp,
    }));
  });
  return histories;
}

function matchupHistoriesFromPrevious(previous: MlbPropsBoardSnapshot | null): Map<string, PlayerBatterPitcherHistoryEvidence> {
  const out = new Map<string, PlayerBatterPitcherHistoryEvidence>();
  if (!previous) return out;
  for (const evidence of Object.values(previous.data.research ?? {})) {
    if (evidence.matchupHistory) out.set(`${evidence.matchupHistory.hitterMlbId}|${evidence.matchupHistory.pitcherMlbId}`, evidence.matchupHistory);
  }
  for (const row of previous.data.props) {
    if (row.matchupHistory) out.set(`${row.matchupHistory.hitterMlbId}|${row.matchupHistory.pitcherMlbId}`, row.matchupHistory);
  }
  return out;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function loadProbablePitcherSeasonStats(probables: MlbProbablePitcher[], slateDate: string): Promise<Map<string, RealPitcherSeasonStat>> {
  const out = new Map<string, RealPitcherSeasonStat>();
  const season = Number(slateDate.slice(0, 4));
  const gameLogs = new MLBStatsGameLogClient();
  const concurrency = Math.min(10, envPositiveInteger("ODDSPHERE_PROPS_PITCHER_STATS_CONCURRENCY", 6));
  await mapWithConcurrency(probables, concurrency, async (probable) => {
    const id = numberValue(probable.playerId?.replace(/^mlbstats-player-/, ""));
    if (id === null || !probable.playerId) return;
    const [stat, logs] = await Promise.all([
      getPitcherSeasonStats(id, season, { quiet: true }).catch(() => null),
      gameLogs.getPlayerGameLogs({ playerId: probable.playerId, before: slateDate, limit: 10 }).catch(() => []),
    ]);
    if (!stat) return;
    const sum = (key: string) => logs.reduce((total, log) => {
      const value = numberValue(log.stats[key]);
      return total + (value ?? 0);
    }, 0);
    out.set(probable.playerId, {
      playerId: probable.playerId,
      pitchingGs: stat.games_started,
      pitchingGp: stat.games_played,
      pitchingIp: stat.innings_pitched,
      pitchingK: stat.strikeouts,
      pitchingKPer9: stat.strikeouts_per_9,
      pitchingBb: stat.walks,
      pitchingH: stat.hits_allowed,
      pitchingEr: stat.earned_runs,
      recentStarts: logs.length || null,
      recentStrikeouts: logs.length ? sum("strikeouts") : null,
      recentOuts: logs.length ? sum("outs") : null,
      recentBattersFaced: logs.length ? sum("batters_faced") : null,
      recentPitchCount: logs.length ? sum("pitch_count") : null,
    });
  });
  return out;
}

function buildDashboardRows(args: {
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  probablePitchers: MlbProbablePitcher[];
  lineupRows: Map<string, Awaited<ReturnType<BallDontLieProvider["getLineups"]>>>;
  researchByKey: Map<string, PlayerPropResearchEnrichment>;
  scoringCandidates: RealPropsCandidateSummary[];
  asOfTimestamp: string;
}): PlayerPropPreviewRow[] {
  const pairs = twoWayMarketProbabilities(args.mappedOdds);
  const rows: PlayerPropPreviewRow[] = [];
  for (const mapped of args.mappedOdds) {
    const identity = args.identities.get(mapped.bdlPlayerId);
    const research = args.researchByKey.get(researchKey(mapped.bdlPlayerId, mapped.odds.marketKey, mapped.game.id));
    const recentLogs = research?.evidence.recentForm?.logs.slice(0, 10) ?? [];
    if (!identity || !recentLogs.length) continue;
    const projection = round(recentLogs.reduce((sum, row) => sum + row.value, 0) / recentLogs.length, 2);
    const definition = getMlbPropMarketDefinition(mapped.odds.marketKey);
    const playerTeam = resolveMlbTeamAlias(identity.player.teamAbbreviation);
    const homeTeam = resolveMlbStatsTeamId(mapped.game.homeTeamId);
    const awayTeam = resolveMlbStatsTeamId(mapped.game.awayTeamId);
    const team = playerTeam?.abbreviation ?? awayTeam?.abbreviation ?? "MLB";
    const homeAway = team === homeTeam?.abbreviation ? "home" : "away";
    const opponent = homeAway === "home" ? awayTeam?.abbreviation : homeTeam?.abbreviation;
    if (!opponent) continue;
    const lineupStatus = lineupStatusFor(mapped, identity, args.lineupRows.get(mapped.bdlGameId) ?? [], args.asOfTimestamp);
    const scored = findScoringCandidate(args.scoringCandidates, mapped, identity.player.fullName);
    const scoredPitcherSignal = definition.family === "pitcher" && definition.recommendationEligibility === "eligible_now" ? scored : null;
    const marketProbability = pairs.get(oddsPairKey(mapped))?.[mapped.odds.side] ?? null;
    const price = assessPropPrice(mapped.odds.americanOdds);
    if (!price.displayEligible) continue;
    const memberReady = Boolean(research?.memberReady);
    const hitterSignal = buildIntegratedHitterSignal({ mapped, definition, research, lineupStatus, marketProbability, currentOdds: mapped.odds.americanOdds, projection });
    const signal: IntegratedPropSignal | null = scoredPitcherSignal ? {
      side: scoredPitcherSignal.side,
      modelProbability: scoredPitcherSignal.modelProbability,
      finalProbability: scoredPitcherSignal.finalProbability,
      overModelProbability: scoredPitcherSignal.side === "over" ? scoredPitcherSignal.modelProbability : 1 - scoredPitcherSignal.modelProbability,
      underModelProbability: scoredPitcherSignal.side === "under" ? scoredPitcherSignal.modelProbability : 1 - scoredPitcherSignal.modelProbability,
      overFinalProbability: scoredPitcherSignal.side === "over" ? scoredPitcherSignal.finalProbability : 1 - scoredPitcherSignal.finalProbability,
      underFinalProbability: scoredPitcherSignal.side === "under" ? scoredPitcherSignal.finalProbability : 1 - scoredPitcherSignal.finalProbability,
      playGrade: signalGrade(scoredPitcherSignal.playGrade),
      confidence: scoredPitcherSignal.featureConfidence ?? 0.65,
      reasonCodes: scoredPitcherSignal.reasonCodes,
      projection,
      modelFamily: definition.modelFamily,
    } : hitterSignal;
    const selectedProbability = signal
      ? mapped.odds.side === signal.side ? signal.finalProbability : 1 - signal.finalProbability
      : null;
    const modelProbability = signal
      ? mapped.odds.side === "over" ? signal.overModelProbability : signal.underModelProbability
      : null;
    const eligibleModel = Boolean(scoredPitcherSignal || hitterSignal);
    const blockingModelWarnings = (scoredPitcherSignal?.featureWarnings ?? []).filter(isBlockingModelContextWarning);
    const modelContextIntegrated = blockingModelWarnings.length === 0;
    const isSelectedModelSide = Boolean(signal && mapped.odds.side === signal.side);
    const canSignal = Boolean(eligibleModel && modelContextIntegrated && isSelectedModelSide && memberReady && price.signalEligible && (scoredPitcherSignal ? scoredPitcherSignal.status === "recommended" : true) && !isOddsStale(mapped.odds.asOfTimestamp, args.asOfTimestamp));
    const playGrade = canSignal && signal
      ? signal.playGrade
      : definition.recommendationEligibility === "research_only" || !eligibleModel ? "RESEARCH"
        : !memberReady ? "PENDING_DATA"
          : !price.signalEligible ? "RESEARCH"
          : isSelectedModelSide ? "WATCHLIST" : "NO_PLAY";
    const reasonCodes = uniqueStrings([
      ...(signal?.reasonCodes ?? []),
      ...(research?.missingModules.map((module) => `MISSING_${module.toUpperCase()}`) ?? []),
      ...(lineupStatus.status === "not_in_lineup" ? ["PLAYER_NOT_IN_POSTED_LINEUP"] : []),
      ...(isOddsStale(mapped.odds.asOfTimestamp, args.asOfTimestamp) ? ["STALE_ODDS"] : []),
      ...(!modelContextIntegrated && eligibleModel ? ["MODEL_CONTEXT_NOT_INTEGRATED"] : []),
      ...(!eligibleModel ? ["MARKET_RESEARCH_ONLY"] : []),
      ...(price.reasonCode ? [price.reasonCode] : []),
    ]);
    const finalProbability = eligibleModel ? selectedProbability : null;
    const edge = finalProbability !== null && marketProbability !== null ? finalProbability - marketProbability : null;
    const expectedValue = finalProbability !== null ? safeExpectedValue(finalProbability, mapped.odds.americanOdds) : null;
    const fairOdds = finalProbability !== null ? safeFairOdds(finalProbability) : null;
    const bdlPlayerTeamId = bdlTeamIdFor(mapped, identity);
    rows.push({
      id: rowId(mapped),
      researchKey: researchKey(mapped.bdlPlayerId, mapped.odds.marketKey, mapped.game.id),
      player: identity.player.fullName,
      headshotUrl: identity.mlbStatsPlayerId ? `/api/mlb/player-headshot/${identity.mlbStatsPlayerId.replace(/^mlbstats-player-/, "")}` : null,
      team,
      opponent,
      homeAway,
      gameStartTime: mapped.game.scheduledStart,
      market: mapped.odds.marketKey,
      marketLabel: definition.label,
      marketFamily: definition.family,
      marketGroup: definition.marketGroup,
      side: mapped.odds.side,
      line: mapped.odds.line,
      odds: mapped.odds.americanOdds,
      book: displayBook(mapped.odds.sportsbook),
      modelProbability: eligibleModel ? modelProbability : null,
      independentProbability: eligibleModel ? modelProbability : null,
      marketProbability,
      finalProbability,
      shrinkageWeight: finalProbability === null ? 0 : 1,
      modelEdge: edge,
      expectedValue,
      fairOdds,
      units: canSignal && (playGrade === "BEST_ANGLE" || playGrade === "LEAN") ? 0.25 : 0,
      confidence: signal?.confidence ?? (memberReady ? 0.65 : 0.35),
      confidenceBucket: (signal?.confidence ?? 0) >= 0.8 ? "high" : (signal?.confidence ?? 0) >= 0.6 ? "medium" : "low",
      playGrade,
      source: "Ball Don't Lie + MLB Stats + NWS + Baseball Savant",
      lastUpdated: mapped.odds.asOfTimestamp,
      projection: signal?.projection ?? projection,
      projectionSource: signal ? "model" : "recent_form",
      overProbability: eligibleModel && signal ? signal.overFinalProbability : null,
      underProbability: eligibleModel && signal ? signal.underFinalProbability : null,
      lineupStatus,
      providerIds: {
        gameId: mapped.game.id,
        bdlGameId: mapped.bdlGameId,
        bdlPropId: stringValue(mapped.raw.provider_prop_id),
        bdlPlayerId: mapped.bdlPlayerId,
        mlbStatsPlayerId: identity.mlbStatsPlayerId,
      },
      keyFeatures: uniqueStrings([
        `${recentLogs.length} recent ${research?.evidence.recentForm?.sampleLabel ?? "games"}`,
        ...(definition.family === "pitcher" && probableForPlayer(args.probablePitchers, mapped.game.id, identity.player.fullName) ? ["Starter confirmed"] : []),
        ...(hitterSignal ? ["integrated hitter read"] : []),
        ...(research?.availableModules.map((module) => module.replaceAll("_", " ")) ?? []),
      ]),
      missingFeatures: research?.missingModules.map((module) => module.replaceAll("_", " ")) ?? ["research evidence"],
      modelInputWarnings: scoredPitcherSignal?.featureWarnings ?? [],
      marketContext: [
        `Lineup ${lineupContextLabel(lineupStatus.status)}`,
        `Quote updated ${mapped.odds.asOfTimestamp}`,
        bdlPlayerTeamId ? `Provider team ${bdlPlayerTeamId}` : "Provider team pending",
      ],
      recentForm: research?.evidence.recentForm ?? null,
      opponentProfile: research?.evidence.opponentProfile ?? null,
      pitchArsenal: research?.evidence.pitchArsenal ?? null,
      pitchMatchup: research?.evidence.pitchMatchup ?? null,
      matchupHistory: research?.evidence.matchupHistory ?? null,
      environment: research?.evidence.environment ?? null,
      reasonCodes,
      oddsSanity: isOddsStale(mapped.odds.asOfTimestamp, args.asOfTimestamp) ? ["STALE_ODDS"] : [],
      settlementStatus: "pending",
      clvStatus: "pending",
    });
  }
  return applyHitterSignalDiscipline(dedupeRows(rows));
}

const HITTER_LEAN_ELIGIBLE_MARKETS = new Set([
  "batter_hits",
  "batter_total_bases",
  "batter_strikeouts",
  "batter_walks",
  "batter_hits_runs_rbis",
  "batter_singles",
]);

const HITTER_WATCHLIST_ONLY_MARKETS = new Set([
  "batter_rbis",
  "batter_runs_scored",
  "batter_doubles",
  "batter_triples",
  "batter_home_runs",
  "batter_stolen_bases",
]);

const DEFAULT_HITTER_LEAN_MIN_AMERICAN_ODDS = -250;
const DEFAULT_HITTER_LEANS_PER_PLAYER = 2;
const DEFAULT_HITTER_LEANS_PER_GAME = 12;

function applyHitterSignalDiscipline(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const hitterLeans = rows.filter((row) => row.marketFamily !== "pitcher" && row.playGrade === "LEAN");
  if (!hitterLeans.length) return rows;

  const minOdds = envInteger("ODDSPHERE_PROPS_HITTER_LEAN_MIN_AMERICAN_ODDS", DEFAULT_HITTER_LEAN_MIN_AMERICAN_ODDS);
  const perPlayerLimit = envPositiveInteger("ODDSPHERE_PROPS_HITTER_LEANS_PER_PLAYER", DEFAULT_HITTER_LEANS_PER_PLAYER);
  const perGameLimit = envPositiveInteger("ODDSPHERE_PROPS_HITTER_LEANS_PER_GAME", DEFAULT_HITTER_LEANS_PER_GAME);
  const downgradeReasons = new Map<string, string>();
  const bestOfferIds = new Set<string>();

  for (const group of groupRows(hitterLeans, hitterOfferKey).values()) {
    const eligible = group.filter((row) => row.odds >= minOdds);
    if (!eligible.length) {
      for (const row of group) downgradeReasons.set(row.id, "HITTER_LEAN_PRICE_TOO_SHORT");
      continue;
    }
    const [best] = [...eligible].sort(compareHitterSignals);
    if (!best) continue;
    bestOfferIds.add(best.id);
    for (const row of group) {
      if (row.id !== best.id) downgradeReasons.set(row.id, row.odds < minOdds ? "HITTER_LEAN_PRICE_TOO_SHORT" : "BETTER_PRICE_AVAILABLE");
    }
  }

  const clusterCandidateIds = new Set<string>();
  const bestOfferRows = hitterLeans.filter((row) => bestOfferIds.has(row.id));
  for (const playerRows of groupRows(bestOfferRows, hitterPlayerKey).values()) {
    const clusterWinners: PlayerPropPreviewRow[] = [];
    for (const clusterRows of groupRows(playerRows, (row) => hitterSignalCluster(row.market)).values()) {
      const [winner, ...clusterDuplicates] = [...clusterRows].sort(compareHitterSignals);
      if (!winner) continue;
      clusterWinners.push(winner);
      for (const row of clusterDuplicates) downgradeReasons.set(row.id, "CORRELATED_HITTER_MARKET_CAPPED");
    }
    const ranked = clusterWinners.sort(compareHitterSignals);
    for (const row of ranked.slice(0, perPlayerLimit)) clusterCandidateIds.add(row.id);
    for (const row of ranked.slice(perPlayerLimit)) downgradeReasons.set(row.id, "PLAYER_HITTER_SIGNAL_LIMIT");
  }

  const keptIds = new Set<string>();
  const clusterCandidates = hitterLeans.filter((row) => clusterCandidateIds.has(row.id));
  for (const gameRows of groupRows(clusterCandidates, (row) => row.providerIds?.gameId ?? row.gameStartTime).values()) {
    const ranked = [...gameRows].sort(compareHitterSignals);
    for (const row of ranked.slice(0, perGameLimit)) keptIds.add(row.id);
    for (const row of ranked.slice(perGameLimit)) downgradeReasons.set(row.id, "SLATE_HITTER_SIGNAL_LIMIT");
  }

  return rows.map((row) => {
    if (row.marketFamily === "pitcher" || row.playGrade !== "LEAN" || keptIds.has(row.id)) return row;
    const reasonCode = downgradeReasons.get(row.id) ?? "HITTER_SIGNAL_DISCIPLINE";
    return {
      ...row,
      playGrade: "WATCHLIST",
      units: 0,
      reasonCodes: uniqueStrings([...row.reasonCodes, reasonCode]),
    };
  });
}

function groupRows<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = out.get(key);
    if (existing) existing.push(row);
    else out.set(key, [row]);
  }
  return out;
}

function hitterOfferKey(row: PlayerPropPreviewRow): string {
  return [
    row.providerIds?.gameId ?? row.gameStartTime,
    row.providerIds?.bdlPlayerId ?? row.player,
    row.market,
    row.side,
    row.line,
  ].join("|");
}

function hitterPlayerKey(row: PlayerPropPreviewRow): string {
  return `${row.providerIds?.gameId ?? row.gameStartTime}|${row.providerIds?.bdlPlayerId ?? row.player}`;
}

function hitterSignalCluster(market: string): string {
  if (["batter_hits", "batter_total_bases", "batter_singles", "batter_hits_runs_rbis"].includes(market)) return "hit_production";
  if (market === "batter_walks") return "walks";
  if (market === "batter_strikeouts") return "strikeouts";
  return market;
}

function compareHitterSignals(a: PlayerPropPreviewRow, b: PlayerPropPreviewRow): number {
  return hitterSignalScore(b) - hitterSignalScore(a)
    || (b.expectedValue ?? -99) - (a.expectedValue ?? -99)
    || (b.modelEdge ?? -99) - (a.modelEdge ?? -99)
    || b.odds - a.odds;
}

function hitterSignalScore(row: PlayerPropPreviewRow): number {
  return (row.expectedValue ?? -99) * 100 + (row.modelEdge ?? 0) * 20 + row.confidence;
}

function buildIntegratedHitterSignal(args: {
  mapped: MappedOddsRow;
  definition: ReturnType<typeof getMlbPropMarketDefinition>;
  research: PlayerPropResearchEnrichment | undefined;
  lineupStatus: NonNullable<PlayerPropPreviewRow["lineupStatus"]>;
  marketProbability: number | null;
  currentOdds: number;
  projection: number;
}): IntegratedPropSignal | null {
  if (args.definition.family !== "batter") return null;
  if (!HITTER_LEAN_ELIGIBLE_MARKETS.has(args.definition.marketKey) && !HITTER_WATCHLIST_ONLY_MARKETS.has(args.definition.marketKey)) return null;
  if (args.lineupStatus.status === "not_in_lineup") return null;
  const recent = args.research?.evidence.recentForm;
  const logs = recent?.logs ?? [];
  if (logs.length < 5) return null;

  const l5 = averageNumber(logs.slice(0, 5).map((row) => row.value));
  const l10 = averageNumber(logs.slice(0, 10).map((row) => row.value));
  const season = averageNumber(logs.map((row) => row.value));
  const hitRate = recentHitRate(logs.slice(0, 10), args.mapped.odds.line);
  const market = args.definition.marketKey;
  const pitchMix = args.research?.evidence.pitchMatchup ?? null;
  const history = args.research?.evidence.matchupHistory ?? null;
  const environment = args.research?.evidence.environment ?? null;
  const movement = movementAdjustment(args.mapped.odds.side, record(args.mapped.odds.rawPayload));

  let projection = Math.max(0.02, season * 0.45 + l10 * 0.35 + l5 * 0.2);
  let confidence = 0.46;
  const reasons = ["HITTER_INTEGRATED_MODEL_READ", "RECENT_FORM_EDGE"];
  if (logs.length >= 10) confidence += 0.12;
  if (logs.length >= 20) confidence += 0.06;
  if (hitRate >= 0.7 || hitRate <= 0.3) confidence += 0.04;

  const pitchMixEdge = hitterPitchMixAdjustment(market, pitchMix);
  if (pitchMixEdge !== 0) {
    projection *= 1 + pitchMixEdge;
    confidence += pitchMix?.coverageStatus === "available" ? 0.1 : 0.04;
    reasons.push("PITCH_MIX_MATCHUP_EDGE");
  }

  const historyEdge = hitterHistoryAdjustment(market, history);
  if (historyEdge !== 0) {
    projection *= 1 + historyEdge;
    confidence += 0.04;
    reasons.push("DIRECT_MATCHUP_CONTEXT");
  } else if (history?.status === "no_history") {
    reasons.push("NO_DIRECT_MATCHUP_HISTORY");
  }

  const environmentEdge = hitterEnvironmentAdjustment(market, environment);
  if (environmentEdge !== 0) {
    projection *= 1 + environmentEdge;
    confidence += 0.04;
    reasons.push("PARK_WEATHER_CONTEXT");
  }

  confidence += 0.04;
  reasons.push(args.lineupStatus.status === "posted" || args.lineupStatus.status === "confirmed"
    ? "LINEUP_STATUS_POSTED"
    : "PROJECTED_LINEUP_CONTEXT");

  confidence = round(Math.min(0.88, confidence), 3);
  projection = round(Math.max(0.02, projection), 2);
  let overModelProbability = poissonProbabilityOver(projection, Math.floor(args.mapped.odds.line) + 1);
  if (movement !== 0) {
    overModelProbability = clampProbability(overModelProbability + movement);
    reasons.push("MARKET_MOVEMENT_CONTEXT");
  }
  const underModelProbability = round(1 - overModelProbability, 4);
  const side = overModelProbability >= underModelProbability ? "over" : "under";
  const modelProbability = side === "over" ? overModelProbability : underModelProbability;
  const marketSideProbability = args.marketProbability === null
    ? null
    : args.mapped.odds.side === side ? args.marketProbability : 1 - args.marketProbability;
  const shrinkageWeight = confidence >= 0.78 ? 0.62 : confidence >= 0.68 ? 0.52 : 0.42;
  const finalProbability = marketSideProbability === null
    ? modelProbability
    : clampProbability(modelProbability * shrinkageWeight + marketSideProbability * (1 - shrinkageWeight));
  const overFinalProbability = side === "over" ? finalProbability : round(1 - finalProbability, 4);
  const underFinalProbability = side === "under" ? finalProbability : round(1 - finalProbability, 4);
  const edge = marketSideProbability === null ? null : finalProbability - marketSideProbability;
  const ev = args.mapped.odds.side === side ? safeExpectedValue(finalProbability, args.currentOdds) : null;
  const leanEligible = HITTER_LEAN_ELIGIBLE_MARKETS.has(market);
  const watchlistOnly = HITTER_WATCHLIST_ONLY_MARKETS.has(market);
  const canLean = leanEligible
    && args.mapped.odds.side === side
    && confidence >= 0.66
    && modelProbability >= 0.56
    && (edge ?? 0) >= 0.02
    && (ev ?? 0) >= 0.01;
  const canWatch = modelProbability >= 0.54 || (edge ?? 0) >= 0.01 || Math.abs(projection - args.mapped.odds.line) >= lineGapThreshold(market);
  if (!canLean && !canWatch) return null;
  if (watchlistOnly) reasons.push("RARE_OR_CONTEXT_HEAVY_MARKET_CAPPED");
  return {
    side,
    modelProbability,
    finalProbability,
    overModelProbability,
    underModelProbability,
    overFinalProbability,
    underFinalProbability,
    playGrade: canLean && !watchlistOnly ? "LEAN" : "WATCHLIST",
    confidence,
    reasonCodes: uniqueStrings(reasons),
    projection,
    modelFamily: `${args.definition.modelFamily}_integrated_read_v1`,
  };
}

function hitterPitchMixAdjustment(market: string, pitchMix: PlayerPropResearchEnrichment["evidence"]["pitchMatchup"]): number {
  if (!pitchMix) return 0;
  const coverageWeight = pitchMix.coverageStatus === "available" ? 1 : 0.45;
  if (market === "batter_strikeouts") {
    const whiff = pitchMix.weighted.whiffPercent;
    if (whiff === null) return 0;
    if (whiff >= 30) return 0.1 * coverageWeight;
    if (whiff >= 25) return 0.05 * coverageWeight;
    if (whiff <= 18) return -0.07 * coverageWeight;
    return 0;
  }
  const xwoba = pitchMix.weighted.xwoba;
  const slug = pitchMix.weighted.slugging;
  let edge = 0;
  if (xwoba !== null) edge += xwoba >= 0.390 ? 0.08 : xwoba >= 0.350 ? 0.04 : xwoba <= 0.285 ? -0.06 : 0;
  if (slug !== null && ["batter_total_bases", "batter_home_runs", "batter_doubles", "batter_triples"].includes(market)) {
    edge += slug >= 0.520 ? 0.05 : slug <= 0.350 ? -0.04 : 0;
  }
  return Math.max(-0.1, Math.min(0.13, edge * coverageWeight));
}

function hitterHistoryAdjustment(market: string, history: PlayerPropResearchEnrichment["evidence"]["matchupHistory"]): number {
  if (!history || history.status !== "available" || history.plateAppearances < 6) return 0;
  const games = Math.max(1, history.gamesPlayed);
  if (market === "batter_hits") return clampAdjustment(history.hits / games - 0.9, 0.07);
  if (market === "batter_total_bases") return clampAdjustment(history.totalBases / games - 1.4, 0.08);
  if (market === "batter_strikeouts") return clampAdjustment(history.strikeouts / Math.max(1, history.plateAppearances) - 0.22, 0.08);
  if (market === "batter_walks") return clampAdjustment(history.walks / Math.max(1, history.plateAppearances) - 0.08, 0.06);
  if (market === "batter_home_runs") return history.homeRuns > 0 ? 0.06 : 0;
  if (market === "batter_rbis") return clampAdjustment(history.rbis / games - 0.45, 0.05);
  return 0;
}

function hitterEnvironmentAdjustment(market: string, environment: PlayerPropResearchEnrichment["evidence"]["environment"]): number {
  if (!environment) return 0;
  const runFactor = environment.park.status === "available" ? environment.park.runFactor : null;
  const hrFactor = environment.park.status === "available" ? environment.park.homeRunFactor : null;
  if (["batter_home_runs", "batter_total_bases", "batter_doubles", "batter_triples"].includes(market) && hrFactor !== null) {
    return Math.max(-0.06, Math.min(0.08, (hrFactor - 100) / 100 * 0.5));
  }
  if (["batter_hits", "batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis"].includes(market) && runFactor !== null) {
    return Math.max(-0.04, Math.min(0.05, (runFactor - 100) / 100 * 0.35));
  }
  return 0;
}

function movementAdjustment(side: "over" | "under", rawPayload: Record<string, unknown>): number {
  const movement = record(rawPayload.oddsMovement);
  const delta = numberValue(movement.impliedProbabilityDelta);
  if (delta === null) return 0;
  const sideDelta = side === "over" ? delta : -delta;
  return Math.max(-0.025, Math.min(0.025, sideDelta * 0.35));
}

function lineGapThreshold(market: string): number {
  if (market === "batter_home_runs" || market === "batter_stolen_bases") return 0.08;
  if (market === "batter_total_bases" || market === "batter_hits_runs_rbis") return 0.35;
  return 0.25;
}

function signalGrade(value: string | null | undefined): IntegratedPropSignal["playGrade"] {
  return value === "BEST_ANGLE" || value === "LEAN" || value === "WATCHLIST" ? value : "LEAN";
}

function averageNumber(values: number[]): number {
  const present = values.filter((value) => Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : 0;
}

function recentHitRate(logs: Array<{ value: number }>, line: number): number {
  if (!logs.length) return 0.5;
  return logs.filter((row) => row.value > line).length / logs.length;
}

function poissonProbabilityOver(mean: number, threshold: number): number {
  if (!Number.isFinite(mean) || mean <= 0) return 0.5;
  const maxK = Math.max(0, threshold - 1);
  let cumulative = 0;
  let term = Math.exp(-mean);
  cumulative += term;
  for (let k = 1; k <= maxK; k++) {
    term *= mean / k;
    cumulative += term;
  }
  return round(clampProbability(1 - cumulative), 4);
}

function clampProbability(value: number): number {
  return Math.min(0.95, Math.max(0.05, value));
}

function clampAdjustment(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function isBlockingModelContextWarning(value: string): boolean {
  return [
    "bdl_stat_bundle_pending_baseline_used",
    "low_feature_confidence",
    "opponent_k_profile_unavailable_non_blocking",
    "recent_logs_unavailable_non_blocking",
    "weather_unavailable_non_blocking",
    "weak_pitcher_baseline",
  ].includes(value);
}

function buildDashboardData(args: {
  slateDate: string;
  asOfTimestamp: string;
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  props: PlayerPropPreviewRow[];
  sourceOdds: PropOddsSnapshot[];
  environmentErrors: string[];
}): PlayerPropsDashboardData {
  const matchups = args.games.map((game) => {
    const away = resolveMlbStatsTeamId(game.awayTeamId)?.abbreviation ?? "AWAY";
    const home = resolveMlbStatsTeamId(game.homeTeamId)?.abbreviation ?? "HOME";
    const awayProbable = args.probablePitchers.find((row) => row.gameId === game.id && row.teamId === game.awayTeamId);
    const homeProbable = args.probablePitchers.find((row) => row.gameId === game.id && row.teamId === game.homeTeamId);
    return {
      awayTeam: away,
      homeTeam: home,
      gameStartTime: game.scheduledStart,
      awayProbablePitcher: awayProbable ? probablePitcherName(awayProbable) : null,
      homeProbablePitcher: homeProbable ? probablePitcherName(homeProbable) : null,
      starterStatus: awayProbable?.playerId && homeProbable?.playerId ? "confirmed" as const : awayProbable?.playerId || homeProbable?.playerId ? "partial" as const : "pending" as const,
    };
  });
  const grades = (grade: PlayerPropPreviewRow["playGrade"]) => args.props.filter((row) => row.playGrade === grade).length;
  const compacted = compactResearchEvidence(args.props);
  return {
    date: args.slateDate,
    lastUpdated: args.asOfTimestamp,
    slate: {
      practice: false,
      contextStatus: args.environmentErrors.length ? "partial" : "available",
      matchups,
    },
    providerStatus: {
      selectedOddsSource: "Ball Don't Lie",
      sharpApi: "fallback only",
      bdl: "live",
      publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
      paperPersistenceEnabled: process.env.ODDSPHERE_PROPS_PAPER_PERSIST_ENABLED === "true",
      writesToSupabase: true,
    },
    summary: {
      gamesWithProps: new Set(args.props.map((row) => row.providerIds?.gameId).filter(Boolean)).size,
      scoredProps: args.props.filter((row) => row.finalProbability !== null).length,
      recommendations: grades("BEST_ANGLE"),
      leans: grades("LEAN"),
      watchlist: grades("WATCHLIST"),
      noPlay: grades("NO_PLAY"),
      pendingData: grades("PENDING_DATA"),
      researchOnly: grades("RESEARCH"),
      booksCovered: new Set(args.props.map((row) => row.book)).size,
      marketsAvailable: new Set(args.sourceOdds.map((row) => row.marketKey)).size,
      averageDataConfidence: args.props.length ? round(args.props.reduce((sum, row) => sum + row.confidence, 0) / args.props.length, 3) : 0,
    },
    props: compacted.props,
    research: compacted.research,
  };
}

function compactResearchEvidence(rows: PlayerPropPreviewRow[]): {
  props: PlayerPropPreviewRow[];
  research: NonNullable<PlayerPropsDashboardData["research"]>;
} {
  const research: NonNullable<PlayerPropsDashboardData["research"]> = {};
  const props = rows.map((row) => {
    const {
      recentForm = null,
      opponentProfile = null,
      pitchArsenal = null,
      pitchMatchup = null,
      matchupHistory = null,
      environment = null,
      ...compact
    } = row;
    if (row.researchKey && !research[row.researchKey]) {
      research[row.researchKey] = { recentForm, opponentProfile, pitchArsenal, pitchMatchup, matchupHistory, environment };
    }
    return compact;
  });
  return { props, research };
}

function researchEvidenceForSnapshotRow(
  snapshot: MlbPropsBoardSnapshot,
  row: PlayerPropPreviewRow,
): NonNullable<PlayerPropsDashboardData["research"]>[string] {
  const shared = row.researchKey ? snapshot.data.research?.[row.researchKey] : null;
  return {
    recentForm: row.recentForm ?? shared?.recentForm ?? null,
    opponentProfile: row.opponentProfile ?? shared?.opponentProfile ?? null,
    pitchArsenal: row.pitchArsenal ?? shared?.pitchArsenal ?? null,
    pitchMatchup: row.pitchMatchup ?? shared?.pitchMatchup ?? null,
    matchupHistory: row.matchupHistory ?? shared?.matchupHistory ?? null,
    environment: row.environment ?? shared?.environment ?? null,
  };
}

function enforceSnapshotPayloadLimits(snapshot: MlbPropsBoardSnapshot): void {
  const size = measureMlbPropsBoardSnapshot(snapshot);
  const maxJson = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_JSON_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES);
  const maxGzip = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_GZIP_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES);
  if (size.jsonBytes > maxJson) snapshot.validation.errors.push(`SNAPSHOT_JSON_LIMIT_EXCEEDED_${size.jsonBytes}_OF_${maxJson}`);
  if (size.gzipBytes > maxGzip) snapshot.validation.errors.push(`SNAPSHOT_GZIP_LIMIT_EXCEEDED_${size.gzipBytes}_OF_${maxGzip}`);
  if (snapshot.validation.errors.length) snapshot.validation.publishable = false;
}

export function validateMlbPropsBoardData(args: {
  data: PlayerPropsDashboardData;
  sourceRows: number;
  mappedRows: number;
  asOfTimestamp: string;
  providerCoverage?: ReturnType<BallDontLieMlbPropsClient["getCoverageSummary"]>;
}): MlbPropsBoardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const staleOddsRows = args.data.props.filter((row) => isOddsStale(row.lastUpdated, args.asOfTimestamp)).length;
  const ids = args.data.props.map((row) => row.id);
  if (args.sourceRows === 0) errors.push("PROP_ODDS_UNAVAILABLE");
  if (args.providerCoverage) {
    if (args.providerCoverage.normalizedRows !== args.sourceRows) errors.push("BDL_NORMALIZED_ROW_COUNT_MISMATCH");
    if (args.providerCoverage.normalizedRawProps + args.providerCoverage.droppedRawProps !== args.providerCoverage.totalRawProps) {
      errors.push("BDL_RAW_COVERAGE_COUNT_MISMATCH");
    }
    if (args.providerCoverage.unmappedMarketTypes.length > 0) {
      errors.push(`UNMAPPED_BDL_MARKET_TYPES_${args.providerCoverage.unmappedMarketTypes.join("_")}`);
    }
    if (args.providerCoverage.droppedRawProps > 0) {
      warnings.push(`${args.providerCoverage.droppedRawProps}_BDL_RAW_OFFERS_NOT_NORMALIZED`);
    }
  }
  if (args.mappedRows === 0 && args.sourceRows > 0) errors.push("NO_ODDS_ROWS_MAPPED_TO_MLB_GAMES");
  if (args.sourceRows > 0 && args.mappedRows / args.sourceRows < 0.9) errors.push("ODDS_GAME_MAPPING_BELOW_90_PERCENT");
  if (args.data.props.length === 0 && args.sourceRows > 0) errors.push("NO_MEMBER_ROWS_WITH_VERIFIED_PLAYER_HISTORY");
  const maxBoardRows = envPositiveInteger("ODDSPHERE_PROPS_MAX_BOARD_ROWS", DEFAULT_MAX_BOARD_ROWS);
  if (args.data.props.length > maxBoardRows) errors.push(`BOARD_ROW_LIMIT_EXCEEDED_${args.data.props.length}_OF_${maxBoardRows}`);
  if (new Set(ids).size !== ids.length) errors.push("DUPLICATE_BOARD_ROW_IDS");
  if (args.data.props.some((row) => !Number.isFinite(row.line) || !Number.isFinite(row.odds) || !Number.isFinite(row.projection))) errors.push("NON_FINITE_MEMBER_VALUE");
  if (staleOddsRows > 0) {
    errors.push("STALE_ODDS_PRESENT");
    warnings.push(`${staleOddsRows}_STALE_ODDS_ROWS_WITHHELD_FROM_SIGNALS`);
  }
  const pendingLineups = args.data.props.filter((row) => row.marketFamily !== "pitcher" && row.lineupStatus?.status === "pending").length;
  if (pendingLineups > 0) warnings.push(`${pendingLineups}_HITTER_ROWS_PROJECTED_LINEUP`);
  const actionableRows = args.data.props.filter((row) => ACTIONABLE_GRADES.has(row.playGrade)).length;
  const invalidActionable = args.data.props.filter((row) => ACTIONABLE_GRADES.has(row.playGrade) && (
    row.finalProbability === null
    || row.modelEdge === null
    || row.oddsSanity.length > 0
    || row.missingFeatures.length > 0
    || !assessPropPrice(row.odds).signalEligible
  ));
  if (invalidActionable.length) errors.push("ACTIONABLE_ROWS_FAILED_DATA_GATE");
  return {
    publishable: errors.length === 0,
    actionableRows,
    researchRows: args.data.props.length - actionableRows,
    mappedRows: args.mappedRows,
    sourceRows: args.sourceRows,
    staleOddsRows,
    providerCoverage: args.providerCoverage ? {
      rawOffers: args.providerCoverage.totalRawProps,
      normalizedOffers: args.providerCoverage.normalizedRawProps,
      droppedOffers: args.providerCoverage.droppedRawProps,
      normalizedPriceRows: args.providerCoverage.normalizedRows,
      marketTypes: Object.keys(args.providerCoverage.marketTypeCounts).sort(),
      unmappedMarketTypes: [...args.providerCoverage.unmappedMarketTypes],
      vendors: [...args.providerCoverage.vendorsFound],
    } : undefined,
    errors,
    warnings,
  };
}

export function compareMlbPropsBoardMovement(
  previous: MlbPropsBoardSnapshot | null,
  currentRows: PlayerPropPreviewRow[],
): MlbPropsBoardMovement {
  if (!previous) return { comparedWith: null, changedPrices: 0, changedLines: 0, addedRows: currentRows.length, removedRows: 0 };
  const previousMap = new Map(previous.data.props.map((row) => [movementKey(row), row]));
  const currentMap = new Map(currentRows.map((row) => [movementKey(row), row]));
  let changedPrices = 0;
  let changedLines = 0;
  let addedRows = 0;
  for (const [key, row] of currentMap) {
    const old = previousMap.get(key);
    if (!old) {
      addedRows++;
      continue;
    }
    if (old.odds !== row.odds) changedPrices++;
    if (old.line !== row.line) changedLines++;
  }
  const removedRows = [...previousMap.keys()].filter((key) => !currentMap.has(key)).length;
  return { comparedWith: previous.snapshotId, changedPrices, changedLines, addedRows, removedRows };
}

async function loadOpeningPropOdds(args: {
  oddsClient: BallDontLieMlbPropsClient;
  sourceOdds: PropOddsSnapshot[];
  previous: MlbPropsBoardSnapshot | null;
  asOfTimestamp: string;
  refreshMode: "fast" | "full";
}): Promise<PropOddsSnapshot[]> {
  const currentGameIds = [...new Set(args.sourceOdds.map(bdlGameIdForOdds).filter((value): value is string => value !== null))];
  const carried = (args.previous?.modelContext?.openingPropOdds ?? [])
    .filter((row) => currentGameIds.includes(bdlGameIdForOdds(row) ?? ""));
  const covered = new Set(carried.map(bdlGameIdForOdds).filter((value): value is string => value !== null));
  const gameIdsToFetch = args.refreshMode === "full"
    ? currentGameIds
    : currentGameIds.filter((gameId) => !covered.has(gameId));
  let fetched: PropOddsSnapshot[] = [];
  if (gameIdsToFetch.length) {
    try {
      fetched = await args.oddsClient.getOpeningPropOdds({ gameIds: gameIdsToFetch, asOfTimestamp: args.asOfTimestamp });
    } catch {
      fetched = [];
    }
  }
  const byQuote = new Map<string, PropOddsSnapshot>();
  for (const row of [...carried, ...fetched]) {
    const stripped = stripOpeningQuote(row);
    byQuote.set(openingOddsExactKey(stripped), stripped);
  }
  return [...byQuote.values()];
}

export function attachMlbPropOddsMovement(
  rows: PlayerPropPreviewRow[],
  openingOdds: PropOddsSnapshot[],
  previous: MlbPropsBoardSnapshot | null,
): PlayerPropPreviewRow[] {
  const exactOpenings = new Map<string, PropOddsSnapshot>();
  const openingsByBase = new Map<string, PropOddsSnapshot[]>();
  for (const opening of openingOdds) {
    exactOpenings.set(openingOddsExactKey(opening), opening);
    const base = openingOddsBaseKey(opening);
    openingsByBase.set(base, [...(openingsByBase.get(base) ?? []), opening]);
  }
  const previousByMovement = new Map((previous?.data.props ?? []).map((row) => [movementKey(row), row]));
  const previousByExact = new Map((previous?.data.props ?? []).map((row) => [dashboardOddsExactKey(row), row]));
  return rows.map((row) => {
    const opening = exactOpenings.get(dashboardOddsExactKey(row))
      ?? nearestOpeningQuote(row, openingsByBase.get(dashboardOddsBaseKey(row)) ?? []);
    const prior = previousByMovement.get(movementKey(row)) ?? previousByExact.get(dashboardOddsExactKey(row)) ?? null;
    const inherited = prior?.oddsMovement ?? null;
    const openingLine = opening?.line ?? inherited?.openingLine ?? prior?.line ?? row.line;
    const openingOddsValue = opening?.americanOdds ?? inherited?.openingOdds ?? prior?.odds ?? row.odds;
    const openingTimestamp = opening?.asOfTimestamp ?? inherited?.openingTimestamp ?? prior?.lastUpdated ?? row.lastUpdated;
    const openingSource = opening
      ? "balldontlie_opening" as const
      : inherited?.openingSource ?? "first_tracked_snapshot" as const;
    const lineDelta = round(row.line - openingLine, 3);
    const impliedProbabilityDelta = round(
      american_to_implied_probability(row.odds) - american_to_implied_probability(openingOddsValue),
      6,
    );
    return {
      ...row,
      oddsMovement: {
        openingLine,
        openingOdds: openingOddsValue,
        openingTimestamp,
        openingSource,
        previousLine: prior?.line ?? row.line,
        previousOdds: prior?.odds ?? row.odds,
        previousTimestamp: prior?.lastUpdated ?? row.lastUpdated,
        currentLine: row.line,
        currentOdds: row.odds,
        currentTimestamp: row.lastUpdated,
        lineDelta,
        impliedProbabilityDelta,
        hasMoved: lineDelta !== 0 || openingOddsValue !== row.odds,
      },
    };
  });
}

function nearestOpeningQuote(row: PlayerPropPreviewRow, candidates: PropOddsSnapshot[]): PropOddsSnapshot | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => Math.abs(a.line - row.line) - Math.abs(b.line - row.line))[0] ?? null;
}

function stripOpeningQuote(row: PropOddsSnapshot): PropOddsSnapshot {
  const raw = record(row.rawPayload);
  return {
    ...row,
    snapshotRole: "opening",
    rawPayload: {
      provider_prop_id: stringValue(raw.provider_prop_id),
      bdl_game_id: stringValue(raw.bdl_game_id) ?? bdlGameIdForOdds(row),
      bdl_player_id: stringValue(raw.bdl_player_id) ?? row.playerId.replace(/^balldontlie-player-/, ""),
    },
  };
}

function bdlGameIdForOdds(row: PropOddsSnapshot): string | null {
  return stringValue(record(row.rawPayload).bdl_game_id) ?? (row.gameId.replace(/^balldontlie-game-/, "") || null);
}

function openingOddsBaseKey(row: PropOddsSnapshot): string {
  return `${bdlGameIdForOdds(row) ?? ""}|${row.playerId.replace(/^balldontlie-player-/, "")}|${row.marketKey}|${row.side}|${normalizeMovementBook(row.sportsbook)}`;
}

function openingOddsExactKey(row: PropOddsSnapshot): string {
  return `${openingOddsBaseKey(row)}|${row.line}`;
}

function dashboardOddsBaseKey(row: PlayerPropPreviewRow): string {
  return `${row.providerIds?.bdlGameId ?? ""}|${row.providerIds?.bdlPlayerId ?? row.player}|${row.market}|${row.side}|${normalizeMovementBook(row.book)}`;
}

function dashboardOddsExactKey(row: PlayerPropPreviewRow): string {
  return `${dashboardOddsBaseKey(row)}|${row.line}`;
}

function normalizeMovementBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function identitiesFromPrevious(previous: MlbPropsBoardSnapshot | null): Map<number, PlayerIdentity> {
  const out = new Map<number, PlayerIdentity>();
  for (const row of previous?.data.props ?? []) {
    const id = row.providerIds?.bdlPlayerId;
    if (!id || out.has(id)) continue;
    out.set(id, {
      bdlPlayerId: id,
      mlbStatsPlayerId: row.providerIds?.mlbStatsPlayerId ?? null,
      player: {
        playerId: id,
        fullName: row.player,
        bats: null,
        throws: null,
        position: null,
        teamAbbreviation: row.team,
      },
    });
  }
  return out;
}

function uniqueResearchRows(rows: MappedOddsRow[]): MappedOddsRow[] {
  const byKey = new Map<string, MappedOddsRow>();
  for (const row of rows) byKey.set(researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id), row);
  return [...byKey.values()];
}

function researchKey(playerId: number, market: PropOddsSnapshot["marketKey"], gameId: string): string {
  return `${gameId}|${playerId}|${market}`;
}

function opponentTeamFor(row: MappedOddsRow, identity: PlayerIdentity | undefined): string | null {
  const playerTeam = resolveMlbTeamAlias(identity?.player.teamAbbreviation);
  const home = resolveMlbStatsTeamId(row.game.homeTeamId);
  return playerTeam?.id === home?.id ? row.game.awayTeamId : row.game.homeTeamId;
}

function opposingPitcherId(row: MappedOddsRow, identity: PlayerIdentity | undefined): number | null {
  const playerTeam = resolveMlbTeamAlias(identity?.player.teamAbbreviation);
  const home = resolveMlbTeamAlias(stringValue(row.raw.event_home_team));
  const value = playerTeam?.id === home?.id ? row.raw.bdl_away_pitcher_id : row.raw.bdl_home_pitcher_id;
  return numberValue(value);
}

function opposingProbableFor(
  row: MappedOddsRow,
  identity: PlayerIdentity | undefined,
  probables: MlbProbablePitcher[],
): MlbProbablePitcher | null {
  const opponentTeamId = opponentTeamFor(row, identity);
  return probables.find((probable) => probable.gameId === row.game.id && probable.teamId === opponentTeamId) ?? null;
}

function mlbMatchupKey(hitterPlayerId: string | null, pitcherPlayerId: string | null): string | null {
  const hitter = mlbPersonNumber(hitterPlayerId);
  const pitcher = mlbPersonNumber(pitcherPlayerId);
  return hitter === null || pitcher === null ? null : `${hitter}|${pitcher}`;
}

function mlbPersonNumber(playerId: string | null): number | null {
  return numberValue(playerId?.replace(/^mlbstats-player-/, ""));
}

function bdlTeamIdFor(row: MappedOddsRow, identity: PlayerIdentity): number | null {
  const direct = numberValue(row.raw.bdl_player_team_id);
  if (direct !== null) return direct;
  const playerTeam = resolveMlbTeamAlias(identity.player.teamAbbreviation);
  const home = resolveMlbTeamAlias(stringValue(row.raw.event_home_team));
  return numberValue(playerTeam?.id === home?.id ? row.raw.bdl_home_team_id : row.raw.bdl_away_team_id);
}

function lineupStatusFor(
  row: MappedOddsRow,
  identity: PlayerIdentity,
  lineups: Awaited<ReturnType<BallDontLieProvider["getLineups"]>>,
  asOfTimestamp: string,
): NonNullable<PlayerPropPreviewRow["lineupStatus"]> {
  const teamId = bdlTeamIdFor(row, identity);
  const player = lineups.find((candidate) => candidate.player_external_id === row.bdlPlayerId);
  if (player) {
    return {
      status: player.is_confirmed ? "confirmed" : player.batting_position ? "posted" : "pending",
      battingOrder: player.batting_position,
      position: player.starting_position,
      source: "Ball Don't Lie",
      asOfTimestamp,
    };
  }
  const postedTeamRows = lineups.filter((candidate) => candidate.team_external_id === teamId && candidate.batting_position !== null);
  return {
    status: postedTeamRows.length >= 8 ? "not_in_lineup" : "pending",
    battingOrder: null,
    position: null,
    source: "Ball Don't Lie",
    asOfTimestamp,
  };
}

function lineupContextLabel(status: NonNullable<PlayerPropPreviewRow["lineupStatus"]>["status"]): string {
  if (status === "pending") return "projected";
  if (status === "not_in_lineup") return "not listed";
  return status;
}

function twoWayMarketProbabilities(rows: MappedOddsRow[]): Map<string, { over: number; under: number }> {
  const groups = new Map<string, Partial<Record<"over" | "under", MappedOddsRow>>>();
  for (const row of rows) {
    const key = oddsPairKey(row);
    groups.set(key, { ...(groups.get(key) ?? {}), [row.odds.side]: row });
  }
  const out = new Map<string, { over: number; under: number }>();
  for (const [key, pair] of groups) {
    if (!pair.over || !pair.under) continue;
    try {
      out.set(key, remove_vig_two_way(pair.over.odds.americanOdds, pair.under.odds.americanOdds));
    } catch {
      continue;
    }
  }
  return out;
}

function oddsPairKey(row: MappedOddsRow): string {
  return `${row.game.id}|${row.bdlPlayerId}|${row.odds.marketKey}|${row.odds.line}|${row.odds.sportsbook}`;
}

function findScoringCandidate(candidates: RealPropsCandidateSummary[], row: MappedOddsRow, playerName: string): RealPropsCandidateSummary | null {
  const providerPlayerIds = new Set([
    row.odds.playerId,
    `balldontlie-player-${row.bdlPlayerId}`,
  ]);
  return candidates.find((candidate) =>
    candidate.gameId === row.game.id
    && (providerPlayerIds.has(candidate.playerId) || normalizePlayerName(candidate.playerName) === normalizePlayerName(playerName))
    && candidate.marketKey === row.odds.marketKey
    && candidate.line === row.odds.line
    && normalizeBook(candidate.sportsbook) === normalizeBook(row.odds.sportsbook)
  ) ?? null;
}

function probableForPlayer(probables: MlbProbablePitcher[], gameId: string, playerName: string): MlbProbablePitcher | null {
  return probables.find((row) => row.gameId === gameId && normalizePlayerName(probablePitcherName(row) ?? "") === normalizePlayerName(playerName)) ?? null;
}

function probablePitcherName(probable: MlbProbablePitcher): string | null {
  const raw = record(probable.rawPayload);
  return stringValue(record(raw.probablePitcher).fullName)
    ?? stringValue(record(raw.probablePitcher).full_name)
    ?? stringValue(raw.player_name);
}

function probablePitcherSlateChangedGames(
  previous: MlbPropsBoardSnapshot | null,
  games: MlbGameEntity[],
  probables: MlbProbablePitcher[],
): Set<string> {
  const changed = new Set<string>();
  if (!previous?.data.slate?.matchups.length) return changed;
  for (const game of games) {
    const away = resolveMlbStatsTeamId(game.awayTeamId)?.abbreviation;
    const home = resolveMlbStatsTeamId(game.homeTeamId)?.abbreviation;
    if (!away || !home) continue;
    const old = previous.data.slate.matchups.find((matchup) => matchup.awayTeam === away && matchup.homeTeam === home);
    if (!old) continue;
    const currentAway = probables.find((row) => row.gameId === game.id && row.teamId === game.awayTeamId);
    const currentHome = probables.find((row) => row.gameId === game.id && row.teamId === game.homeTeamId);
    const awayName = currentAway ? probablePitcherName(currentAway) : null;
    const homeName = currentHome ? probablePitcherName(currentHome) : null;
    if (awayName && normalizePlayerName(awayName) !== normalizePlayerName(old.awayProbablePitcher ?? "")) changed.add(game.id);
    if (homeName && normalizePlayerName(homeName) !== normalizePlayerName(old.homeProbablePitcher ?? "")) changed.add(game.id);
  }
  return changed;
}

function bdlOpposingPitcherChangedGames(
  previous: MlbPropsBoardSnapshot | null,
  mappedOdds: MappedOddsRow[],
  identities: Map<number, PlayerIdentity>,
): Set<string> {
  const changed = new Set<string>();
  if (!previous) return changed;
  const previousPitchers = new Map<string, number>();
  for (const row of previous.data.props) {
    const playerId = row.providerIds?.bdlPlayerId;
    const gameId = row.providerIds?.gameId;
    const evidence = researchEvidenceForSnapshotRow(previous, row).pitchMatchup;
    if (playerId && gameId && evidence) previousPitchers.set(`${gameId}|${playerId}`, evidence.pitcherId);
  }
  for (const row of mappedOdds) {
    const current = opposingPitcherId(row, identities.get(row.bdlPlayerId));
    const old = previousPitchers.get(`${row.game.id}|${row.bdlPlayerId}`);
    if (current !== null && old !== undefined && current !== old) changed.add(row.game.id);
  }
  return changed;
}

function rowId(row: MappedOddsRow): string {
  return createHash("sha1")
    .update(`${row.game.id}|${row.bdlPlayerId}|${row.odds.marketKey}|${row.odds.side}|${row.odds.line}|${row.odds.sportsbook}`)
    .digest("hex")
    .slice(0, 18);
}

function movementKey(row: PlayerPropPreviewRow): string {
  const providerPropId = row.providerIds?.bdlPropId;
  if (providerPropId) return `${row.providerIds?.gameId ?? ""}|prop:${providerPropId}|${row.side}`;
  return `${row.providerIds?.gameId ?? ""}|${row.providerIds?.bdlPlayerId ?? row.player}|${row.market}|${row.side}|${row.book}|${row.line}`;
}

function dedupeRows(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const out = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const current = out.get(row.id);
    if (!current || row.lastUpdated > current.lastUpdated) out.set(row.id, row);
  }
  return [...out.values()].sort((a, b) => a.gameStartTime.localeCompare(b.gameStartTime) || a.player.localeCompare(b.player) || a.marketLabel.localeCompare(b.marketLabel));
}

function isOddsStale(timestamp: string, asOfTimestamp: string): boolean {
  const maxMinutes = Number(process.env.ODDSPHERE_PROPS_MAX_ODDS_AGE_MINUTES ?? DEFAULT_MAX_ODDS_AGE_MINUTES);
  const age = Date.parse(asOfTimestamp) - Date.parse(timestamp);
  return !Number.isFinite(age) || age > maxMinutes * 60_000;
}

function safeExpectedValue(probability: number, odds: number): number | null {
  try {
    return round(expected_value(probability, odds), 4);
  } catch {
    return null;
  }
}

function safeFairOdds(probability: number): number | null {
  try {
    return fair_american_odds(probability);
  } catch {
    return null;
  }
}

function displayBook(value: string): string {
  const normalized = normalizeBook(value);
  const names: Record<string, string> = {
    hardrock: "Hard Rock",
    draftkings: "DraftKings",
    fanduel: "FanDuel",
    betmgm: "BetMGM",
    caesars: "Caesars",
  };
  return names[normalized] ?? value;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isFinalGameStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "final" || normalized === "completed" || normalized === "game over";
}

function addCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function easternSlateDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function mlbPropsSnapshotIsFresh(snapshot: MlbPropsBoardSnapshot, now = new Date()): boolean {
  const maxMinutes = Number(process.env.ODDSPHERE_PROPS_MAX_SNAPSHOT_AGE_MINUTES ?? 25);
  const age = now.getTime() - Date.parse(snapshot.asOfTimestamp);
  return Number.isFinite(age) && age >= 0 && age <= maxMinutes * 60_000;
}

export function supportedLiveMlbPropMarkets(): string[] {
  return allMlbPropMarketDefinitions().map((market) => market.marketKey);
}
