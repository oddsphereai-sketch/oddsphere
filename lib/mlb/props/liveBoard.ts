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
import { FallbackMlbWeatherClient, OpenMeteoWeatherClient } from "./openMeteoWeatherClient";
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
  isSignalOptionalMemberFeature,
  isSignalOptionalResearchModule,
  pitchMixResearchSampleIsUsable,
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
import { publishMlbPropsMemberReadSnapshots } from "./memberReadSnapshotStore";
import { assessPropPrice } from "./pricePolicy";
import {
  activeMlbPropMarketModelVersions,
  MLB_PROPS_MODEL_RELEASE_ID,
} from "./marketModelVersions";
import {
  compareMlbPropsMatchupHistoryCandidates,
  selectMlbPropsMatchupHistoryCandidates,
  type MlbPropsMatchupHistoryCandidate,
} from "./matchupHistoryPriority";
import {
  BATTER_HITS_PA_MODEL_VERSION,
  projectBatterHitsPa,
} from "./batterHitsPaModel";
import {
  BATTER_HRR_MODEL_VERSION,
  projectBatterHrr,
} from "./batterHrrCountModel";
import {
  BATTER_DOUBLES_RESIDUAL_MODEL_VERSION,
  projectBatterDoublesResidual,
} from "./batterDoublesResidualModel";
import {
  BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION,
  projectBatterHomeRunsResidual,
} from "./batterHomeRunsResidualModel";
import { shouldReplaceBestPriceRow } from "./bestPriceSelection";
import {
  syncInternalMlbPropsTracking,
  type MlbPropsTrackingSyncResult,
} from "./internalTracking";
import { calibratedPropModelWeight } from "./probabilityCalibration";
import {
  consensusMarketProbabilityFromAmericanOdds,
  HOME_RUN_STANDARDIZED_QUALITY_POLICY,
  qualifiesBatterDoublesResidualPromotion,
  qualifiesHitsUnderPriceEdge,
  qualifiesValidatedUnderPromotion,
  scoreHrrUnderAccuracyCandidate,
  scoreHomeRunRelativeQualityCandidate,
  selectStandardizedQualityCandidateIds,
} from "./actionabilityPolicy";
import { assertMlbPropsReleaseDoesNotRegress } from "./releaseOrdering";
import { resolveMlbPropsProbablePitchers } from "./probablePitcherResolution";

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
  resolvedTeamAbbreviation: string | null;
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
  shrinkageWeight: number;
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
// BDL expands each posted offer into side/price rows, so a healthy full slate
// can exceed 25k normalized source rows even while the compact member board
// remains safely below its independent 7,500-row payload guard. Keep a real
// corruption ceiling without rejecting normal late-day sportsbook expansion.
const DEFAULT_MAX_SOURCE_ODDS_ROWS = 35_000;
// Full MLB slates can legitimately exceed 6,000 book/side/line rows. Keep a
// bounded corruption guard without rejecting a healthy board merely because
// more sportsbooks or alternates are posted on a larger slate.
const DEFAULT_MAX_BOARD_ROWS = 7_500;
const DEFAULT_MAX_BDL_CALLS_PER_REFRESH = 300;
const DEFAULT_RECENT_FORM_SEASON_LOG_LIMIT = 180;
const MEMBER_EXCLUDED_MARKETS = new Set(["first_home_run", "pitcher_record_a_win"]);

export async function refreshMlbPropsBoard(args: RefreshArgs): Promise<MlbPropsBoardRefreshResult> {
  const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
  const requestedMode = args.refreshMode ?? "fast";
  const previous = await loadLatestMlbPropsBoardSnapshot(args.slateDate).catch(() => null);
  assertMlbPropsReleaseDoesNotRegress({
    candidateReleaseId: MLB_PROPS_MODEL_RELEASE_ID,
    currentReleaseId: previous?.modelContext?.modelReleaseId,
    candidateTimestamp: asOfTimestamp,
    currentTimestamp: previous?.asOfTimestamp,
  });
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the live MLB props board.");

  const mlbStats = new MLBStatsAPIClient();
  const oddsClient = new BallDontLieMlbPropsClient(apiKey);
  const researchClient = new BallDontLieResearchClient(apiKey);
  const [games, mlbStatsProbablePitchers, sourceOdds] = await Promise.all([
    mlbStats.getGames({ date: args.slateDate }),
    mlbStats.getProbablePitchers({ date: args.slateDate, asOfTimestamp }),
    oddsClient.getPropOdds({ date: args.slateDate, asOfTimestamp, maxPages: 5 }),
  ]);
  const probablePitcherResolution = await resolveMlbPropsProbablePitchers({
    games,
    mlbStatsProbablePitchers,
    slateDate: args.slateDate,
    asOfTimestamp,
    fallbackEnabled: process.env.ODDSPHERE_PROPS_PROBABLE_FALLBACK_ENABLED !== "false",
    dependencies: {
      resolveBdlPlayerId: async (fullName, teamAbbreviation) => {
        const player = await researchClient.findPlayerByFullName(fullName).catch(() => null);
        return player && resolveMlbTeamAlias(player.teamAbbreviation)?.id === resolveMlbTeamAlias(teamAbbreviation)?.id
          ? player.playerId
          : null;
      },
    },
  });
  const probablePitchers = probablePitcherResolution.probablePitchers;
  const providerCoverage = oddsClient.getCoverageSummary();
  const maxSourceRows = envPositiveInteger("ODDSPHERE_PROPS_MAX_SOURCE_ODDS_ROWS", DEFAULT_MAX_SOURCE_ODDS_ROWS);
  if (sourceOdds.length > maxSourceRows) {
    throw new Error(`MLB props source-row circuit breaker opened: ${sourceOdds.length} exceeds ${maxSourceRows}.`);
  }

  const boardSourceOdds = sourceOdds.filter((row) => !isMemberExcludedSourceOdds(row));
  const gameMappedOdds = mapOddsToMlbGames(boardSourceOdds, games);
  const previousIdentities = identitiesFromPrevious(previous);
  const requiredPlayerIds = [...new Set(gameMappedOdds.map((row) => row.bdlPlayerId))];
  const starterContextChangedGameIds = new Set([
    ...probablePitcherSlateChangedGames(previous, games, probablePitchers),
    ...bdlOpposingPitcherChangedGames(previous, gameMappedOdds, previousIdentities),
  ]);
  const needsFullResearch = requestedMode === "full" || !previous;
  const refreshMode: "fast" | "full" = needsFullResearch ? "full" : "fast";
  const openingOdds = await loadOpeningPropOdds({
    oddsClient,
    sourceOdds: boardSourceOdds,
    previous,
    asOfTimestamp,
    refreshMode,
  });

  const identities = new Map(previousIdentities);
  const identityIdsToLoad = needsFullResearch
    ? requiredPlayerIds
    : requiredPlayerIds.filter((id) => !identities.has(id));
  if (identityIdsToLoad.length) {
    for (const [id, identity] of await loadPlayerIdentities(identityIdsToLoad, researchClient, probablePitchers, games)) {
      identities.set(id, identity);
    }
  }

  // Provider game identity and player identity arrive from separate payloads.
  // Fail closed when a player profile points to a team that is not in the
  // mapped game; otherwise a stale team can be silently treated as the away
  // side and create a phantom matchup on the member board. The official MLB
  // probable-pitcher assignment remains authoritative for pitcher markets.
  const mappedOdds = gameMappedOdds.filter((row) => playerBelongsToMappedGame({
    game: row.game,
    marketFamily: getMlbPropMarketDefinition(row.odds.marketKey).family,
    playerName: identities.get(row.bdlPlayerId)?.player.fullName ?? null,
    playerTeamAbbreviation: eventScopedPlayerTeam(row)?.abbreviation
      ?? identities.get(row.bdlPlayerId)?.resolvedTeamAbbreviation
      ?? identities.get(row.bdlPlayerId)?.player.teamAbbreviation
      ?? null,
    probablePitchers,
  }));
  const playerGameIdentityConflictRows = gameMappedOdds.length - mappedOdds.length;

  const lineupResult = await loadLineups(mappedOdds, apiKey);
  const lineupRows = lineupResult.rows;
  const environment = await loadSlateEnvironmentResearch({
    games,
    asOfTimestamp,
    parkFactors: new StatcastParkFactorClient(),
    weather: new FallbackMlbWeatherClient(
      mlbStats,
      new NwsWeatherClient(mlbStats),
      new OpenMeteoWeatherClient(mlbStats),
    ),
  });

  const researchByKey = needsFullResearch
    ? await loadFullResearch({ mappedOdds, identities, games, probablePitchers, previous, environmentByGame: environment.byGameId, asOfTimestamp, researchClient })
    : await refreshFastResearch({
        mappedOdds,
        identities,
        games,
        probablePitchers,
        previous: previous as MlbPropsBoardSnapshot,
        environmentByGame: environment.byGameId,
        starterContextChangedGameIds,
        asOfTimestamp,
        researchClient,
      });

  const seasonStats = needsFullResearch
    ? await loadProbablePitcherSeasonStats(probablePitchers, args.slateDate)
    : new Map(previous?.modelContext?.probablePitcherSeasonStats ?? []);
  const pitcherModelContext = buildPitcherModelContext({ mappedOdds, identities, researchByKey });
  const scoringOdds = mappedOdds.map(({ odds }) => {
    const raw = record(odds.rawPayload);
    const bdlPlayerId = numberValue(raw.bdl_player_id ?? odds.playerId.replace(/^balldontlie-player-/, ""));
    const identity = bdlPlayerId === null ? null : identities.get(bdlPlayerId);
    return identity && !stringValue(raw.player_name)
      ? { ...odds, rawPayload: { ...raw, player_name: identity.player.fullName } }
      : odds;
  });
  const scoring = scoringOdds.length
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
        bdlPropRows: scoringOdds.length,
        fallbackReason: null,
      },
    })
    : null;

  const props = compactMemberBoardRows(attachMlbPropOddsMovement(buildDashboardRows({
    mappedOdds,
    identities,
    probablePitchers,
    lineupRows,
    researchByKey,
    scoringCandidates: scoring?.summary.sampleCandidates ?? [],
    asOfTimestamp,
  }), openingOdds, previous), asOfTimestamp);
  const data = buildDashboardData({
    slateDate: args.slateDate,
    asOfTimestamp,
    games,
    probablePitchers,
    props,
    sourceOdds: boardSourceOdds,
    environmentErrors: environment.errors,
  });
  const validation = validateMlbPropsBoardData({
    data,
    sourceRows: boardSourceOdds.length,
    mappedRows: mappedOdds.length,
    asOfTimestamp,
    providerCoverage,
    playerGameIdentityConflictRows,
    previousSnapshot: previous,
    probablePitcherFallbackAssignments: probablePitcherResolution.fallbackAssignments.length,
    probablePitcherFallbackFindings: probablePitcherResolution.findings,
  });
  const movement = compareMlbPropsBoardMovement(previous, data.props);
  const snapshotOpeningOdds = compactOpeningPropOddsForSnapshot(openingOdds, data.props);
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
      modelReleaseId: MLB_PROPS_MODEL_RELEASE_ID,
      probablePitcherSeasonStats: [...seasonStats.entries()],
      openingPropOdds: snapshotOpeningOdds,
      marketModelVersions: activeMlbPropMarketModelVersions(),
      shadowPitcherPredictions: scoring?.summary.sampleCandidates.map((candidate) => ({
        gameId: candidate.gameId,
        playerId: candidate.playerId,
        market: candidate.marketKey,
        line: candidate.line,
        sportsbook: displayBook(candidate.sportsbook),
        prediction: candidate.shadowPrediction,
      })) ?? [],
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
      gameLocksCreated: 0,
      closingPricesUpdated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  // Publish the small, indexed member read models after lock reconciliation.
  // A failure here must not discard the canonical scoring snapshot; readers
  // retain the previous last-known-good member snapshot and the next refresh
  // retries automatically.
  try {
    await publishMlbPropsMemberReadSnapshots(snapshot, { forceFull: tracking.gameLocksCreated > 0 });
  } catch (error) {
    const detail = error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : String(error);
    console.warn(`MLB props member snapshot publish failed: ${detail}`);
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
    gameLocksCreated: 0,
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

function eventScopedPlayerTeam(row: MappedOddsRow) {
  return resolveEventScopedPlayerTeam({
    game: row.game,
    playerTeamId: numberValue(row.raw.bdl_player_team_id),
    providerAwayTeamId: numberValue(row.raw.bdl_away_team_id),
    providerHomeTeamId: numberValue(row.raw.bdl_home_team_id),
  });
}

export function resolveEventScopedPlayerTeam(args: {
  game: MlbGameEntity;
  playerTeamId: number | null;
  providerAwayTeamId: number | null;
  providerHomeTeamId: number | null;
}) {
  const { playerTeamId, providerAwayTeamId, providerHomeTeamId } = args;
  if (playerTeamId === null) return null;
  if (playerTeamId === providerAwayTeamId) return resolveMlbStatsTeamId(args.game.awayTeamId);
  if (playerTeamId === providerHomeTeamId) return resolveMlbStatsTeamId(args.game.homeTeamId);
  return null;
}

export function playerBelongsToMappedGame(args: {
  game: MlbGameEntity;
  marketFamily: "batter" | "pitcher" | "milestone";
  playerName: string | null;
  playerTeamAbbreviation: string | null;
  probablePitchers: MlbProbablePitcher[];
}): boolean {
  if (!args.playerName) return false;
  const officialPitcher = args.marketFamily === "pitcher"
    ? probableForPlayer(args.probablePitchers, args.game.id, args.playerName)
    : null;
  const playerTeam = officialPitcher
    ? resolveMlbStatsTeamId(officialPitcher.teamId)
    : resolveMlbTeamAlias(args.playerTeamAbbreviation);
  const homeTeam = resolveMlbStatsTeamId(args.game.homeTeamId);
  const awayTeam = resolveMlbStatsTeamId(args.game.awayTeamId);
  return Boolean(playerTeam && (playerTeam.id === homeTeam?.id || playerTeam.id === awayTeam?.id));
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
    const resolved = await resolveMlbStatsIdentity(player, probablePitchers, rosterIndex);
    out.set(id, {
      bdlPlayerId: id,
      player,
      mlbStatsPlayerId: resolved.playerId,
      resolvedTeamAbbreviation: resolved.teamAbbreviation,
    });
  });
  return out;
}

async function resolveMlbStatsIdentity(
  player: BdlResearchPlayer,
  probablePitchers: MlbProbablePitcher[],
  rosterIndex: Map<string, MlbRosterEntry[]>,
): Promise<{ playerId: string | null; teamAbbreviation: string | null }> {
  const probable = probablePitchers.find((row) => {
    const name = probablePitcherName(row);
    return row.playerId && name && normalizePlayerName(name) === normalizePlayerName(player.fullName);
  });
  if (probable?.playerId) {
    return {
      playerId: probable.playerId,
      teamAbbreviation: resolveMlbStatsTeamId(probable.teamId)?.abbreviation ?? null,
    };
  }
  const team = resolveMlbTeamAlias(player.teamAbbreviation);
  const rosterMatches = (team ? rosterIndex.get(team.id) ?? [] : [])
    .filter((row) => normalizePlayerName(row.fullName) === normalizePlayerName(player.fullName));
  if (rosterMatches.length === 1) {
    return {
      playerId: `mlbstats-player-${rosterMatches[0].personId}`,
      teamAbbreviation: team?.abbreviation ?? null,
    };
  }
  const slateRosterMatches = [...rosterIndex.entries()].flatMap(([teamId, roster]) => roster
    .filter((row) => normalizePlayerName(row.fullName) === normalizePlayerName(player.fullName))
    .map((row) => ({ teamId, row })));
  if (slateRosterMatches.length === 1) {
    const match = slateRosterMatches[0];
    return {
      playerId: `mlbstats-player-${match.row.personId}`,
      teamAbbreviation: resolveMlbTeamAlias(match.teamId)?.abbreviation ?? null,
    };
  }
  const matches = (await searchPersonsByName(player.fullName, { quiet: true }))
    .filter((row) => normalizePlayerName(row.fullName) === normalizePlayerName(player.fullName));
  const teamMatches = matches.filter((row) => {
    const currentTeam = row.currentTeamId ? resolveMlbStatsTeamId(row.currentTeamId) : null;
    return currentTeam?.id === team?.id;
  });
  const selected = teamMatches.length === 1 ? teamMatches[0] : matches.length === 1 ? matches[0] : null;
  return selected ? {
    playerId: `mlbstats-player-${selected.id}`,
    teamAbbreviation: selected.currentTeamId
      ? resolveMlbStatsTeamId(selected.currentTeamId)?.abbreviation ?? null
      : null,
  } : { playerId: null, teamAbbreviation: null };
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
  matchupHistories?: Map<string, PlayerBatterPitcherHistoryEvidence>;
}): Promise<Map<string, PlayerPropResearchEnrichment>> {
  const gameLogs = new MLBStatsGameLogClient();
  const profiles = await getMlbTeamHittingProfiles(Number(args.asOfTimestamp.slice(0, 4)), { quiet: true }).catch(() => null) ?? [];
  const unique = uniqueResearchRows(args.mappedOdds);
  const slateDate = args.mappedOdds[0]?.game.gameDate ?? args.asOfTimestamp.slice(0, 10);
  const completedSameDayGames = new Set(args.games
    .filter((game) => game.gameDate === slateDate && isFinalGameStatus(game.gameStatus))
    .map((game) => game.id));
  const logCache = await loadRecentLogCache(unique, args.identities, gameLogs, slateDate);
  const matchupHistories = args.matchupHistories ?? await loadBatterPitcherHistories({
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
    const opponentTeamId = opponentTeamFor(row, identity, args.probablePitchers);
    const opposingProbable = opposingProbableFor(row, identity, args.probablePitchers);
    const matchupHistoryKey = mlbMatchupKey(mlbId, opposingProbable?.playerId ?? null);
    candidates.push({
      rowId: researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id),
      playerName: identity?.player.fullName ?? stringValue(row.raw.player_name) ?? `Player ${row.bdlPlayerId}`,
      marketKey: row.odds.marketKey,
      bdlPlayerId: row.bdlPlayerId,
      mlbStatsPlayerId: mlbId,
      opponentTeamId,
      opposingPitcherBdlId: opposingPitcherId(row, identity, args.probablePitchers),
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
      const opposingId = opposingPitcherId(row, args.identities.get(row.bdlPlayerId), args.probablePitchers);
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

/**
 * Fast refreshes still need to converge research coverage. Price-only reuse
 * previously meant that missing batter/pitcher history advanced only during
 * the single daily full refresh, while newly posted players or a changed
 * probable starter could remain partial for the rest of the slate.
 *
 * Keep the fast path bounded: reuse the complete prior bundle, fetch only the
 * next prioritized matchup-history batch, and fully rebuild only research
 * keys that are new or belong to a game whose starter changed.
 */
async function refreshFastResearch(args: {
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  previous: MlbPropsBoardSnapshot;
  environmentByGame: Map<string, NonNullable<PlayerPropPreviewRow["environment"]>>;
  starterContextChangedGameIds: Set<string>;
  asOfTimestamp: string;
  researchClient: BallDontLieResearchClient;
}): Promise<Map<string, PlayerPropResearchEnrichment>> {
  const reused = reusePreviousResearch(
    args.previous,
    args.environmentByGame,
    args.starterContextChangedGameIds,
  );
  const matchupHistories = await loadBatterPitcherHistories({
    mappedOdds: uniqueResearchRows(args.mappedOdds),
    identities: args.identities,
    probablePitchers: args.probablePitchers,
    previous: args.previous,
    asOfTimestamp: args.asOfTimestamp,
  });
  attachFastMatchupHistories({
    researchByKey: reused,
    mappedOdds: args.mappedOdds,
    identities: args.identities,
    probablePitchers: args.probablePitchers,
    matchupHistories,
  });

  const targeted = args.mappedOdds.filter((row) => {
    const key = researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id);
    return !reused.has(key) || args.starterContextChangedGameIds.has(row.game.id);
  });
  if (targeted.length === 0) return reused;

  const rebuilt = await loadFullResearch({
    mappedOdds: targeted,
    identities: args.identities,
    games: args.games,
    probablePitchers: args.probablePitchers,
    previous: args.previous,
    environmentByGame: args.environmentByGame,
    asOfTimestamp: args.asOfTimestamp,
    researchClient: args.researchClient,
    matchupHistories,
  });
  for (const [key, value] of rebuilt) reused.set(key, value);
  return reused;
}

function attachFastMatchupHistories(args: {
  researchByKey: Map<string, PlayerPropResearchEnrichment>;
  mappedOdds: MappedOddsRow[];
  identities: Map<number, PlayerIdentity>;
  probablePitchers: MlbProbablePitcher[];
  matchupHistories: Map<string, PlayerBatterPitcherHistoryEvidence>;
}): void {
  for (const row of args.mappedOdds) {
    if (getMlbPropMarketDefinition(row.odds.marketKey).family === "pitcher") continue;
    const identity = args.identities.get(row.bdlPlayerId);
    const opposingProbable = opposingProbableFor(row, identity, args.probablePitchers);
    const matchupKey = mlbMatchupKey(identity?.mlbStatsPlayerId ?? null, opposingProbable?.playerId ?? null);
    const history = matchupKey ? args.matchupHistories.get(matchupKey) ?? null : null;
    if (!history) continue;
    const key = researchKey(row.bdlPlayerId, row.odds.marketKey, row.game.id);
    const existing = args.researchByKey.get(key);
    if (!existing || existing.evidence.matchupHistory) continue;
    args.researchByKey.set(key, {
      ...existing,
      evidence: { ...existing.evidence, matchupHistory: history },
    });
  }
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
    const pitchArsenal = evidence?.pitchArsenal ?? null;
    const environment = evidence?.environment ?? null;
    out.set(realPitcherModelContextKey(row.game.id, playerId), {
      opponentStrikeoutRate: opponent?.strikeoutRate.value ?? null,
      opponentLeagueStrikeoutRate: opponent?.strikeoutRate.leagueAverage ?? null,
      opponentOps: opponent?.ops.value ?? null,
      opponentLeagueOps: opponent?.ops.leagueAverage ?? null,
      opponentWalkRate: opponent?.walkRate.value ?? null,
      opponentLeagueWalkRate: opponent?.walkRate.leagueAverage ?? null,
      opponentBattingAverage: opponent?.battingAverage.value ?? null,
      opponentLeagueBattingAverage: opponent?.battingAverage.leagueAverage ?? null,
      opponentHomeRunRate: opponent?.homeRunRate.value ?? null,
      opponentLeagueHomeRunRate: opponent?.homeRunRate.leagueAverage ?? null,
      pitchArsenalWhiffPercent: weightedPitchArsenalMetric(pitchArsenal, "whiffPercent"),
      pitchArsenalChasePercent: weightedPitchArsenalMetric(pitchArsenal, "chasePercent"),
      pitchArsenalZonePercent: weightedPitchArsenalMetric(pitchArsenal, "zonePercent"),
      pitchArsenalBattingAverageAllowed: weightedPitchArsenalMetric(pitchArsenal, "battingAverageAllowed"),
      pitchArsenalXwobaAllowed: weightedPitchArsenalMetric(pitchArsenal, "xwobaAllowed"),
      pitchArsenalPitchesTracked: pitchArsenal?.pitchesTracked ?? null,
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

function weightedPitchArsenalMetric(
  arsenal: PlayerPropResearchEnrichment["evidence"]["pitchArsenal"],
  metric: "whiffPercent" | "chasePercent" | "zonePercent" | "battingAverageAllowed" | "xwobaAllowed",
): number | null {
  if (!arsenal) return null;
  const available = arsenal.pitches.filter((pitch) =>
    typeof pitch[metric] === "number"
    && Number.isFinite(pitch[metric])
    && pitch.usagePercent > 0,
  );
  const totalUsage = available.reduce((sum, pitch) => sum + pitch.usagePercent, 0);
  if (totalUsage <= 0) return null;
  return available.reduce(
    (sum, pitch) => sum + (pitch[metric] ?? 0) * pitch.usagePercent,
    0,
  ) / totalUsage;
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
  const seasonLogLimit = envPositiveInteger("ODDSPHERE_PROPS_RECENT_FORM_SEASON_LOG_LIMIT", DEFAULT_RECENT_FORM_SEASON_LOG_LIMIT);
  await mapWithConcurrency([...requests.entries()], concurrency, async ([key, request]) => {
    const logs = request.family === "pitcher"
      ? await gameLogs.getPlayerGameLogs({ playerId: request.playerId, before: addCalendarDays(slateDate, 1), limit: seasonLogLimit }).catch(() => [])
      : await gameLogs.getHitterGameLogs({ playerId: request.playerId, before: addCalendarDays(slateDate, 1), limit: seasonLogLimit }).catch(() => []);
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
      ...(row.marketFamily !== "pitcher" && (hitterMatchupInvalid || !pitchMixResearchSampleIsUsable(evidence.pitchMatchup))
        ? ["pitch_mix_matchup" as const]
        : []),
      ...(evidence.environment?.park.status === "available" ? [] : ["park_factor" as const]),
      ...(evidence.environment?.weather.status === "available" || evidence.environment?.roofStatus === "dome" ? [] : ["game_time_weather" as const]),
    ];
    const availableModules = [
      ...(evidence.recentForm ? ["recent_form" as const] : []),
      ...(evidence.opponentProfile ? ["opponent_profile" as const] : []),
      ...(evidence.pitchArsenal ? ["pitch_arsenal" as const] : []),
      ...(pitchMixResearchSampleIsUsable(evidence.pitchMatchup) ? ["pitch_mix_matchup" as const] : []),
      ...(evidence.environment?.park.status === "available" ? ["park_factor" as const] : []),
      ...(evidence.environment?.weather.status === "available" || evidence.environment?.roofStatus === "dome" ? ["game_time_weather" as const] : []),
      "player_identity" as const,
    ];
    out.set(key, {
      rowId: key,
      status: row.missingFeatures.length || missingModules.length ? "partial" : "complete",
      memberReady: missingModules.every(isSignalOptionalResearchModule)
        && row.missingFeatures.every(isSignalOptionalMemberFeature),
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
  const previousPriority = previousMatchupHistoryPriority(args.previous);
  const pairs = new Map<string, MlbPropsMatchupHistoryCandidate<{
    hitterId: number;
    pitcherId: number;
    hitterName: string;
    pitcherName: string;
  }>>();
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
    const priorityKey = `${row.game.id}|${row.bdlPlayerId}`;
    const candidate: MlbPropsMatchupHistoryCandidate<{
      hitterId: number;
      pitcherId: number;
      hitterName: string;
      pitcherName: string;
    }> = {
      key,
      value: { hitterId, pitcherId, hitterName: identity.player.fullName, pitcherName },
      actionablePriority: previousPriority.get(priorityKey) ?? 0,
      gameStartTime: row.game.scheduledStart,
      upcoming: Date.parse(row.game.scheduledStart) > Date.parse(args.asOfTimestamp),
    };
    const current = pairs.get(key);
    if (!current || compareMlbPropsMatchupHistoryCandidates(candidate, current) < 0) {
      pairs.set(key, candidate);
    }
  }

  const maxNewPairs = envPositiveInteger("ODDSPHERE_PROPS_MAX_NEW_MATCHUP_HISTORY_CALLS", 60);
  const concurrency = Math.min(8, envPositiveInteger("ODDSPHERE_PROPS_MATCHUP_HISTORY_CONCURRENCY", 4));
  const timeoutMs = envPositiveInteger("ODDSPHERE_PROPS_MATCHUP_HISTORY_TIMEOUT_MS", 7_000);
  const pending = selectMlbPropsMatchupHistoryCandidates([...pairs.values()], maxNewPairs);
  await mapWithConcurrency(pending, concurrency, async ({ key, value: pair }) => {
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

function previousMatchupHistoryPriority(previous: MlbPropsBoardSnapshot | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!previous) return out;
  for (const row of previous.data.props) {
    const gameId = row.providerIds?.gameId;
    const playerId = row.providerIds?.bdlPlayerId;
    if (!gameId || playerId === undefined) continue;
    const priority = row.playGrade === "BEST_ANGLE"
      ? 3
      : row.playGrade === "LEAN"
        ? 2
        : row.playGrade === "WATCHLIST"
          ? 1
          : 0;
    const key = `${gameId}|${playerId}`;
    out.set(key, Math.max(out.get(key) ?? 0, priority));
  }
  return out;
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
    const recentThree = logs.slice(0, 3);
    const sumRecentThree = (key: string) => recentThree.reduce((total, log) => {
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
      recentThreeStarts: recentThree.length || null,
      recentStrikeouts: logs.length ? sum("strikeouts") : null,
      recentOuts: logs.length ? sum("outs") : null,
      recentThreeOuts: recentThree.length ? sumRecentThree("outs") : null,
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
    // A provider player profile can lag a trade or roster move. For pitchers,
    // the official probable-pitcher assignment is the authoritative game-side
    // identity and must win over the provider's cached team abbreviation.
    const officialPitcher = definition.family === "pitcher"
      ? probableForPlayer(args.probablePitchers, mapped.game.id, identity.player.fullName)
      : null;
    const playerTeam = officialPitcher
      ? resolveMlbStatsTeamId(officialPitcher.teamId)
      : eventScopedPlayerTeam(mapped)
        ?? resolveMlbTeamAlias(identity.resolvedTeamAbbreviation ?? identity.player.teamAbbreviation);
    const homeTeam = resolveMlbStatsTeamId(mapped.game.homeTeamId);
    const awayTeam = resolveMlbStatsTeamId(mapped.game.awayTeamId);
    const team = playerTeam?.abbreviation ?? awayTeam?.abbreviation ?? "MLB";
    const homeAway = team === homeTeam?.abbreviation ? "home" : "away";
    const opponent = homeAway === "home" ? awayTeam?.abbreviation : homeTeam?.abbreviation;
    if (!opponent) continue;
    const lineupStatus = lineupStatusFor(mapped, identity, args.lineupRows.get(mapped.bdlGameId) ?? [], args.asOfTimestamp);
    const scored = findScoringCandidate(args.scoringCandidates, mapped, identity.player.fullName);
    const scoredPitcherSignal = definition.family === "pitcher" && definition.recommendationEligibility !== "research_only" ? scored : null;
    const marketProbability = pairs.get(oddsPairKey(mapped))?.[mapped.odds.side] ?? null;
    const price = assessPropPrice(mapped.odds.americanOdds);
    if (!price.displayEligible) continue;
    const memberReady = Boolean(research?.memberReady);
    const hitterSignal = buildIntegratedHitterSignal({ mapped, definition, research, lineupStatus, marketProbability, currentOdds: mapped.odds.americanOdds, projection, homeAway });
    const pitcherModelProjection = scoredPitcherSignal?.modelProjection ?? projection;
    const signal: IntegratedPropSignal | null = scoredPitcherSignal ? {
      side: scoredPitcherSignal.side,
      modelProbability: scoredPitcherSignal.modelProbability,
      finalProbability: scoredPitcherSignal.finalProbability,
      shrinkageWeight: scoredPitcherSignal.shrinkageWeight,
      overModelProbability: scoredPitcherSignal.side === "over" ? scoredPitcherSignal.modelProbability : 1 - scoredPitcherSignal.modelProbability,
      underModelProbability: scoredPitcherSignal.side === "under" ? scoredPitcherSignal.modelProbability : 1 - scoredPitcherSignal.modelProbability,
      overFinalProbability: scoredPitcherSignal.side === "over" ? scoredPitcherSignal.finalProbability : 1 - scoredPitcherSignal.finalProbability,
      underFinalProbability: scoredPitcherSignal.side === "under" ? scoredPitcherSignal.finalProbability : 1 - scoredPitcherSignal.finalProbability,
      playGrade: definition.recommendationEligibility === "watchlist_until_context" ? "WATCHLIST" : pitcherSignalGrade({
        market: definition.marketKey,
        grade: scoredPitcherSignal.playGrade,
        projection: pitcherModelProjection,
        line: mapped.odds.line,
        side: scoredPitcherSignal.side,
      }),
      confidence: scoredPitcherSignal.featureConfidence ?? 0.65,
      reasonCodes: scoredPitcherSignal.reasonCodes,
      projection: pitcherModelProjection,
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
    // Milestone markets such as home runs are commonly posted as one-sided
    // offers, so there is no paired no-vig probability. The integrated model
    // already falls back to this offer's price-implied probability when it
    // calibrates the final probability; carry that same market reference into
    // the member row so a legitimately promoted one-sided play has a
    // verifiable, non-null model edge at the publication data gate.
    const effectiveMarketProbability = marketProbability ?? (
      signal && mapped.odds.side === signal.side ? price.impliedProbability : null
    );
    const edge = finalProbability !== null && effectiveMarketProbability !== null
      ? finalProbability - effectiveMarketProbability
      : null;
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
      offerContract: stringValue(mapped.raw.market_kind) === "milestone" ? "milestone" : "two_way",
      marketGroup: definition.marketGroup,
      side: mapped.odds.side,
      line: mapped.odds.line,
      odds: mapped.odds.americanOdds,
      book: displayBook(mapped.odds.sportsbook),
      modelProbability: eligibleModel ? modelProbability : null,
      independentProbability: eligibleModel ? modelProbability : null,
      marketProbability: effectiveMarketProbability,
      finalProbability,
      shrinkageWeight: finalProbability === null ? 0 : signal?.shrinkageWeight ?? 1,
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
        ...(definition.family === "pitcher" && probableForPlayer(args.probablePitchers, mapped.game.id, identity.player.fullName) ? ["Starter listed"] : []),
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
  const deduped = dedupeRows(rows);
  const priceDisciplined = applyBestPriceSignalDiscipline(deduped);
  const concentrationDisciplined = applyHitterSignalDiscipline(priceDisciplined);
  const evidenceGraded = applyEvidenceGradeCorrections(concentrationDisciplined);
  const underPromoted = applyValidatedUnderActionablePromotions(evidenceGraded);
  return applyValidatedHomeRunActionablePromotions(underPromoted);
}

const HITTER_LEAN_ELIGIBLE_MARKETS = new Set([
  "batter_hits",
  "batter_total_bases",
  "batter_strikeouts",
  "batter_walks",
  "batter_hits_runs_rbis",
  "batter_singles",
  "batter_runs_scored",
]);

const HITTER_WATCHLIST_ONLY_MARKETS = new Set([
  "batter_rbis",
  "batter_doubles",
  "batter_triples",
  "batter_home_runs",
  "batter_stolen_bases",
]);

const HITTER_LONGSHOT_VALUE_MARKETS = new Set([
  "batter_home_runs",
]);

const DEFAULT_HITTER_LEAN_MIN_AMERICAN_ODDS = -250;
const DEFAULT_HITTER_LEANS_PER_PLAYER = 2;
const DEFAULT_HITTER_LEANS_PER_GAME = 12;
const HOME_RUN_PROJECTION_PRIOR = 0.095;
const HOME_RUN_PROJECTION_PRIOR_GAMES = 20;
const HISTORICALLY_UNSUPPORTED_ACTIONABLE_MARKET_SIDES = new Set([
  "batter_hits|over",
  "batter_hits|under",
  "batter_hits_runs_rbis|over",
  "batter_hits_runs_rbis|under",
  "batter_singles|over",
  "batter_total_bases|over",
  "batter_total_bases|under",
  "batter_walks|over",
  "pitcher_earned_runs|over",
  "pitcher_earned_runs|under",
  "pitcher_outs|under",
  "pitcher_strikeouts|under",
]);

function applyBestPriceSignalDiscipline(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const signalRows = rows.filter((row) => row.playGrade === "BEST_ANGLE" || row.playGrade === "LEAN");
  if (!signalRows.length) return rows;

  const duplicateSignalIds = new Set<string>();
  for (const group of groupRows(signalRows, signalOfferKey).values()) {
    const [best, ...duplicates] = [...group].sort(comparePropSignals);
    if (!best) continue;
    for (const row of duplicates) duplicateSignalIds.add(row.id);
  }

  if (!duplicateSignalIds.size) return rows;
  return rows.map((row) => duplicateSignalIds.has(row.id)
    ? {
      ...row,
      playGrade: "WATCHLIST",
      units: 0,
      reasonCodes: uniqueStrings([...row.reasonCodes, "BETTER_PRICE_AVAILABLE"]),
    }
    : row);
}

function applyEvidenceGradeCorrections(
  rows: PlayerPropPreviewRow[],
): PlayerPropPreviewRow[] {
  return rows.map((row) => {
    const marketSide = `${row.market}|${row.side}`;
    if (
      (row.playGrade !== "BEST_ANGLE" && row.playGrade !== "LEAN")
      || !HISTORICALLY_UNSUPPORTED_ACTIONABLE_MARKET_SIDES.has(marketSide)
    ) return row;
    return {
      ...row,
      playGrade: "WATCHLIST",
      units: 0,
      reasonCodes: uniqueStrings([
        ...row.reasonCodes,
        "HISTORICALLY_UNSUPPORTED_ACTIONABLE_PATH",
      ]),
    };
  });
}

function applyHitterSignalDiscipline(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  // Home-run Leans already pass their own rare-event probability, EV,
  // confidence, price, and best-offer gates. Do not hide a qualified HR read
  // behind generic hitter concentration caps.
  const hitterLeans = rows.filter((row) =>
    row.marketFamily !== "pitcher"
    && row.market !== "batter_home_runs"
    && row.playGrade === "LEAN"
  );
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
    if (
      row.marketFamily === "pitcher"
      || row.market === "batter_home_runs"
      || row.playGrade !== "LEAN"
      || keptIds.has(row.id)
    ) return row;
    const reasonCode = downgradeReasons.get(row.id) ?? "HITTER_SIGNAL_DISCIPLINE";
    return {
      ...row,
      playGrade: "WATCHLIST",
      units: 0,
      reasonCodes: uniqueStrings([...row.reasonCodes, reasonCode]),
    };
  });
}

function applyValidatedUnderActionablePromotions(
  rows: PlayerPropPreviewRow[],
): PlayerPropPreviewRow[] {
  const hrrScores = new Map<string, ReturnType<typeof scoreHrrUnderAccuracyCandidate>>();
  const eligible = rows.filter((row) => {
    if (
      row.side !== "under"
      || (row.playGrade !== "WATCHLIST" && row.playGrade !== "LEAN")
    ) return false;
    if (
      row.modelProbability === null
      || row.marketProbability === null
      || row.modelEdge === null
      || row.expectedValue === null
    ) return false;
    const hitsPriceEdge =
      row.market === "batter_hits"
      && qualifiesHitsUnderPriceEdge({
        marketProbability: row.marketProbability,
        americanOdds: row.odds,
      });
    const doublesResidual =
      row.market === "batter_doubles"
      && row.reasonCodes.includes("DOUBLES_MARKET_RESIDUAL_READ")
      && qualifiesBatterDoublesResidualPromotion({
        modelProbability: row.modelProbability,
        marketProbability: row.marketProbability,
        expectedValue: row.expectedValue,
        americanOdds: row.odds,
      });
    const genericEligible = qualifiesValidatedUnderPromotion({
      market: row.market,
      line: row.line,
      modelProbability: row.modelProbability,
      marketProbability: row.marketProbability,
      finalEdge: row.modelEdge,
      expectedValue: row.expectedValue,
      americanOdds: row.odds,
    });
    const seasonValues = row.recentForm?.samples?.season.values ?? [];
    const hrrAccuracy = row.market === "batter_hits_runs_rbis"
      ? scoreHrrUnderAccuracyCandidate({
        line: row.line,
        seasonValues,
        marketProbability: row.marketProbability,
        americanOdds: row.odds,
      })
      : null;
    if (hrrAccuracy?.eligible) hrrScores.set(row.id, hrrAccuracy);
    if (hitsPriceEdge) return true;
    if (doublesResidual) return true;
    if (hrrAccuracy?.eligible) return true;
    return row.playGrade === "WATCHLIST" && genericEligible;
  });

  const bestOfferIds = new Set<string>();
  for (const offers of groupRows(eligible, signalOfferKey).values()) {
    const [best] = [...offers].sort(comparePropSignals);
    if (best) bestOfferIds.add(best.id);
  }

  const promotedIds = new Set<string>();
  const bestOffers = eligible.filter((row) => bestOfferIds.has(row.id));
  for (const row of bestOffers) promotedIds.add(row.id);
  if (!promotedIds.size) return rows;

  return rows.map((row) => {
    if (!promotedIds.has(row.id)) return row;
    const hrrScore = hrrScores.get(row.id);
    return {
      ...row,
      ...(hrrScore ? {
        modelProbability: hrrScore.independentProbability,
        independentProbability: hrrScore.independentProbability,
        finalProbability: hrrScore.finalProbability,
        shrinkageWeight: 0.25,
        modelEdge: hrrScore.finalEdge,
        expectedValue: hrrScore.expectedValue,
        fairOdds: safeFairOdds(hrrScore.finalProbability),
        overProbability: 1 - hrrScore.finalProbability,
        underProbability: hrrScore.finalProbability,
      } : {}),
      playGrade: "BEST_ANGLE",
      units: 0.25,
      reasonCodes: uniqueStrings([
        ...row.reasonCodes,
        "VALIDATED_MARKET_PROMOTION",
        "VALIDATED_UNDER_BEST_ANGLE",
        ...(hrrScore ? ["VALIDATED_HRR_UNDER_ACCURACY_BEST_ANGLE"] : []),
        ...(row.market === "batter_doubles"
          ? ["VALIDATED_DOUBLES_RESIDUAL_BEST_ANGLE"]
          : []),
      ]),
    };
  });
}

function applyValidatedHomeRunActionablePromotions(
  rows: PlayerPropPreviewRow[],
): PlayerPropPreviewRow[] {
  const freshOffers = rows.filter((row) =>
    row.market === "batter_home_runs"
    && row.side === "over"
    && row.line === 0.5
    && row.playGrade !== "PENDING_DATA"
    && row.lineupStatus?.status !== "not_in_lineup"
    && row.missingFeatures.every(isSignalOptionalMemberFeature)
    && !row.reasonCodes.includes("STALE_ODDS")
    && !row.reasonCodes.includes("MODEL_CONTEXT_NOT_INTEGRATED")
    && !row.reasonCodes.includes("INVALID_PRICE_FORMAT"));
  const eligible = [...groupRows(freshOffers, signalOfferKey).values()]
    .flatMap((offers) => {
      const distinctBooks = new Set(offers.map((row) => row.book));
      if (distinctBooks.size < 2) return [];
      const marketProbability = consensusMarketProbabilityFromAmericanOdds(
        offers.map((row) => row.odds),
      );
      if (marketProbability === null) return [];
      const [bestOffer] = [...offers].sort((a, b) =>
        b.odds - a.odds || comparePropSignals(a, b));
      if (!bestOffer) return [];

      const seasonValues = bestOffer.recentForm?.samples?.season.values
        .filter((value) => Number.isFinite(value)) ?? [];
      if (seasonValues.length < 10) return [];
      const seasonMean = averageNumber(seasonValues);
      const auditProjection = (
        seasonMean * seasonValues.length
        + HOME_RUN_PROJECTION_PRIOR * HOME_RUN_PROJECTION_PRIOR_GAMES
      ) / (seasonValues.length + HOME_RUN_PROJECTION_PRIOR_GAMES);

      const recentValues = seasonValues.slice(0, 20);
      const recentSurvival = (
        recentValues.filter((value) => value > bestOffer.line).length
        + 2 * marketProbability
      ) / (recentValues.length + 2);
      const score = scoreHomeRunRelativeQualityCandidate({
        projection: auditProjection,
        recentSurvival,
        marketProbability,
        americanOdds: bestOffer.odds,
        line: bestOffer.line,
      });
      return score.eligible ? [{
        row: bestOffer,
        score,
        auditProjection,
        marketProbability,
      }] : [];
    });

  const promotedIds = selectStandardizedQualityCandidateIds(
    eligible
      .map(({ row, score }) => ({
        id: row.id,
        expectedValue: score.expectedValue,
      })),
  );
  if (!promotedIds.size) return rows;

  const promotedById = new Map(
    eligible
      .filter(({ row }) => promotedIds.has(row.id))
      .map((candidate) => [candidate.row.id, candidate]),
  );
  return rows.map((row) => {
    const promoted = promotedById.get(row.id);
    if (!promoted) return row;
    const { score, auditProjection, marketProbability } = promoted;
    return {
      ...row,
      modelProbability: score.modelProbability,
      independentProbability: score.modelProbability,
      marketProbability,
      finalProbability: score.finalProbability,
      shrinkageWeight: HOME_RUN_STANDARDIZED_QUALITY_POLICY.reliabilityWeight,
      modelEdge: score.finalProbability - marketProbability,
      expectedValue: score.expectedValue,
      fairOdds: safeFairOdds(score.finalProbability),
      projection: auditProjection,
      projectionSource: "model",
      overProbability: score.finalProbability,
      underProbability: 1 - score.finalProbability,
      playGrade: "LEAN",
      units: 0.25,
      reasonCodes: uniqueStrings([
        ...row.reasonCodes.filter((code) => code !== "MARKET_RESEARCH_ONLY"),
        "LONGSHOT_VALUE_CONTEXT",
        "VALIDATED_HOME_RUN_CONSENSUS_BEST_PRICE_PROMOTION",
      ]),
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
  return signalOfferKey(row);
}

function signalOfferKey(row: PlayerPropPreviewRow): string {
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
  return comparePropSignals(a, b);
}

function comparePropSignals(a: PlayerPropPreviewRow, b: PlayerPropPreviewRow): number {
  return propSignalScore(b) - propSignalScore(a)
    || (b.expectedValue ?? -99) - (a.expectedValue ?? -99)
    || (b.modelEdge ?? -99) - (a.modelEdge ?? -99)
    || b.odds - a.odds;
}

function propSignalScore(row: PlayerPropPreviewRow): number {
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
  homeAway: "home" | "away";
}): IntegratedPropSignal | null {
  if (args.definition.family !== "batter") return null;
  if (!HITTER_LEAN_ELIGIBLE_MARKETS.has(args.definition.marketKey) && !HITTER_WATCHLIST_ONLY_MARKETS.has(args.definition.marketKey)) return null;
  if (args.lineupStatus.status === "not_in_lineup") return null;
  const recent = args.research?.evidence.recentForm;
  const logs = recent?.logs ?? [];
  if (logs.length < 5) return null;

  if (args.definition.marketKey === "batter_hits") {
    return buildDedicatedBatterHitsSignal(args, logs);
  }
  if (args.definition.marketKey === "batter_hits_runs_rbis") {
    return buildDedicatedBatterHrrSignal(args, logs);
  }
  if (args.definition.marketKey === "batter_doubles") {
    return buildDedicatedBatterDoublesResidualSignal(args);
  }
  if (args.definition.marketKey === "batter_home_runs") {
    return buildDedicatedBatterHomeRunsResidualSignal(args);
  }

  // Published snapshots intentionally keep only the ten display logs. The
  // sample summaries still contain the full-season aggregates, so fast
  // refreshes must read those summaries instead of treating the compact log
  // list as the player's entire season. Otherwise a fast refresh can produce
  // a materially different projection from a full research refresh.
  const l5 = recent?.samples?.last5.average ?? averageNumber(logs.slice(0, 5).map((row) => row.value));
  const l10 = recent?.samples?.last10.average ?? averageNumber(logs.slice(0, 10).map((row) => row.value));
  const season = recent?.samples?.season.average ?? averageNumber(logs.map((row) => row.value));
  const seasonSampleSize = recent?.samples?.season.count ?? logs.length;
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
  if (seasonSampleSize >= 20) confidence += 0.06;
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
  const longshotValueRead = HITTER_LONGSHOT_VALUE_MARKETS.has(market) && args.mapped.odds.side === "over";
  const side = longshotValueRead ? "over" : overModelProbability >= underModelProbability ? "over" : "under";
  const modelProbability = side === "over" ? overModelProbability : underModelProbability;
  const priceAssessment = assessPropPrice(args.currentOdds);
  const priceProbability = priceAssessment.impliedProbability;
  const marketSideProbability = args.marketProbability === null
    ? longshotValueRead ? priceProbability : null
    : args.mapped.odds.side === side ? args.marketProbability : 1 - args.marketProbability;
  const shrinkageWeight = calibratedPropModelWeight({
    marketKey: market,
    side,
    baseWeight: confidence >= 0.78 ? 0.62 : confidence >= 0.68 ? 0.52 : 0.42,
  });
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
  const longshotValueWatch = longshotValueRead
    && priceAssessment.signalEligible
    && confidence >= 0.62
    && (edge ?? 0) >= 0.012
    && (ev ?? 0) >= 0.02;
  const standardWatch = modelProbability >= 0.54 || (edge ?? 0) >= 0.01 || Math.abs(projection - args.mapped.odds.line) >= lineGapThreshold(market);
  const canWatch = longshotValueRead ? longshotValueWatch : standardWatch;
  if (!canLean && !canWatch) return null;
  if (longshotValueWatch) reasons.push("LONGSHOT_VALUE_CONTEXT");
  if (watchlistOnly) reasons.push("RARE_OR_CONTEXT_HEAVY_MARKET_CAPPED");
  return {
    side,
    modelProbability,
    finalProbability,
    shrinkageWeight,
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

function buildDedicatedBatterHomeRunsResidualSignal(
  args: Parameters<typeof buildIntegratedHitterSignal>[0],
): IntegratedPropSignal | null {
  const seasonValues = args.research?.evidence.recentForm?.samples?.season.values
    .filter((value) => Number.isFinite(value)) ?? [];
  const priceProbability = assessPropPrice(args.currentOdds).impliedProbability;
  const marketOverProbability = args.marketProbability === null
    ? priceProbability
    : args.mapped.odds.side === "over"
      ? args.marketProbability
      : 1 - args.marketProbability;
  if (marketOverProbability === null || seasonValues.length < 10) return null;
  const residual = projectBatterHomeRunsResidual({
    marketOverProbability,
    line: args.mapped.odds.line,
    home: args.homeAway === "home",
    homeRunsLast20: seasonValues.slice(0, 20),
  });
  if (!residual) return null;
  const seasonMean = averageNumber(seasonValues);
  const projection = (
    seasonMean * seasonValues.length
    + HOME_RUN_PROJECTION_PRIOR * HOME_RUN_PROJECTION_PRIOR_GAMES
  ) / (seasonValues.length + HOME_RUN_PROJECTION_PRIOR_GAMES);
  return {
    side: "over",
    modelProbability: residual.overProbability,
    finalProbability: residual.overProbability,
    shrinkageWeight: 1,
    overModelProbability: residual.overProbability,
    underModelProbability: residual.underProbability,
    overFinalProbability: residual.overProbability,
    underFinalProbability: residual.underProbability,
    playGrade: "WATCHLIST",
    confidence: 0.74,
    reasonCodes: [
      "HITTER_INTEGRATED_MODEL_READ",
      "RECENT_FORM_EDGE",
      "MARKET_PRIOR_SHRINKAGE",
      "HOME_RUN_MARKET_RESIDUAL_READ",
      "RARE_OR_CONTEXT_HEAVY_MARKET_CAPPED",
    ],
    projection: round(projection, 3),
    modelFamily: BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION,
  };
}

function buildDedicatedBatterDoublesResidualSignal(
  args: Parameters<typeof buildIntegratedHitterSignal>[0],
): IntegratedPropSignal | null {
  const features = args.research?.evidence.recentForm?.doublesResidualFeatures;
  if (!features || features.doublesLast20.length < 10 || args.marketProbability === null) {
    return null;
  }
  const marketOverProbability = args.mapped.odds.side === "over"
    ? args.marketProbability
    : 1 - args.marketProbability;
  const residual = projectBatterDoublesResidual({
    marketOverProbability,
    plateAppearancesLast5: features.plateAppearancesLast5,
    rbisLast5: features.rbisLast5,
    rbisSeason: features.rbisSeason,
    runsLast10: features.runsLast10,
    walksLast20: features.walksLast20,
    walksSeason: features.walksSeason,
    doublesOverRateLast20: features.doublesLast20.filter(
      (value) => value > args.mapped.odds.line,
    ).length / features.doublesLast20.length,
  });
  if (!residual) return null;
  const side = residual.overProbability >= residual.underProbability
    ? "over"
    : "under";
  const modelProbability = side === "over"
    ? residual.overProbability
    : residual.underProbability;
  return {
    side,
    modelProbability,
    finalProbability: modelProbability,
    shrinkageWeight: 1,
    overModelProbability: residual.overProbability,
    underModelProbability: residual.underProbability,
    overFinalProbability: residual.overProbability,
    underFinalProbability: residual.underProbability,
    playGrade: "WATCHLIST",
    confidence: 0.72,
    reasonCodes: [
      "HITTER_INTEGRATED_MODEL_READ",
      "RECENT_FORM_EDGE",
      "MARKET_PRIOR_SHRINKAGE",
      "DOUBLES_MARKET_RESIDUAL_READ",
      "RARE_OR_CONTEXT_HEAVY_MARKET_CAPPED",
    ],
    projection: args.projection,
    modelFamily: BATTER_DOUBLES_RESIDUAL_MODEL_VERSION,
  };
}

function buildDedicatedBatterHitsSignal(
  args: Parameters<typeof buildIntegratedHitterSignal>[0],
  logs: NonNullable<PlayerPropResearchEnrichment["evidence"]["recentForm"]>["logs"],
): IntegratedPropSignal | null {
  const pitchMix = args.research?.evidence.pitchMatchup ?? null;
  const distribution = projectBatterHitsPa({
    line: args.mapped.odds.line,
    battingOrder: args.lineupStatus.battingOrder,
    recentLogs: logs,
    pitchMixBattingAverage: pitchMix?.weighted.battingAverage ?? null,
    pitchMixPitchesSeen: pitchMix?.hitterPitchesSeen ?? null,
  });
  if (!distribution) return null;

  const side = distribution.overProbability >= distribution.underProbability ? "over" : "under";
  const modelProbability = side === "over" ? distribution.overProbability : distribution.underProbability;
  const marketSideProbability = args.marketProbability === null
    ? null
    : args.mapped.odds.side === side ? args.marketProbability : 1 - args.marketProbability;
  const shrinkageWeight = calibratedPropModelWeight({
    marketKey: "batter_hits",
    side,
    baseWeight: 1,
  });
  const finalProbability = marketSideProbability === null
    ? modelProbability
    : clampProbability(
      modelProbability * shrinkageWeight
      + marketSideProbability * (1 - shrinkageWeight),
    );
  const overFinalProbability = side === "over" ? finalProbability : round(1 - finalProbability, 4);
  const underFinalProbability = side === "under" ? finalProbability : round(1 - finalProbability, 4);
  const edge = marketSideProbability === null ? null : finalProbability - marketSideProbability;
  const ev = args.mapped.odds.side === side ? safeExpectedValue(finalProbability, args.currentOdds) : null;
  const confidence = round(Math.min(0.9,
    0.58
    + (distribution.games >= 10 ? 0.08 : 0)
    + (distribution.observedAtBats >= 30 ? 0.06 : 0)
    + (args.lineupStatus.battingOrder !== null ? 0.04 : 0)
    + 0.06
    + (distribution.pitchMixWeight > 0 ? 0.04 : 0),
  ), 3);
  const canLean = args.mapped.odds.side === side
    && confidence >= 0.66
    && modelProbability >= 0.56
    && (edge ?? 0) >= 0.02
    && (ev ?? 0) >= 0.01;
  const canWatch = modelProbability >= 0.54
    || (edge ?? 0) >= 0.01
    || Math.abs(distribution.projectedHits - args.mapped.odds.line) >= lineGapThreshold("batter_hits");
  if (!canLean && !canWatch) return null;

  return {
    side,
    modelProbability,
    finalProbability,
    shrinkageWeight,
    overModelProbability: distribution.overProbability,
    underModelProbability: distribution.underProbability,
    overFinalProbability,
    underFinalProbability,
    playGrade: canLean ? "LEAN" : "WATCHLIST",
    confidence,
    reasonCodes: uniqueStrings([
      "HITTER_INTEGRATED_MODEL_READ",
      "RECENT_FORM_EDGE",
      "MARKET_PRIOR_SHRINKAGE",
      args.lineupStatus.status === "posted" || args.lineupStatus.status === "confirmed"
        ? "LINEUP_STATUS_POSTED"
        : "PROJECTED_LINEUP_CONTEXT",
      distribution.pitchMixWeight > 0 ? "PITCH_MIX_MATCHUP_EDGE" : "PITCH_MIX_MATCHUP_NEUTRAL",
    ]),
    projection: distribution.projectedHits,
    modelFamily: BATTER_HITS_PA_MODEL_VERSION,
  };
}

function buildDedicatedBatterHrrSignal(
  args: Parameters<typeof buildIntegratedHitterSignal>[0],
  logs: NonNullable<PlayerPropResearchEnrichment["evidence"]["recentForm"]>["logs"],
): IntegratedPropSignal | null {
  const distribution = projectBatterHrr({
    line: args.mapped.odds.line,
    battingOrder: args.lineupStatus.battingOrder,
    recentValues: logs.map((row) => row.value),
  });
  if (!distribution) return null;

  const side = distribution.overProbability >= distribution.underProbability ? "over" : "under";
  const modelProbability = side === "over" ? distribution.overProbability : distribution.underProbability;
  const marketSideProbability = args.marketProbability === null
    ? null
    : args.mapped.odds.side === side ? args.marketProbability : 1 - args.marketProbability;
  const shrinkageWeight = calibratedPropModelWeight({
    marketKey: "batter_hits_runs_rbis",
    side,
    baseWeight: 1,
  });
  const finalProbability = marketSideProbability === null
    ? modelProbability
    : clampProbability(
      modelProbability * shrinkageWeight
      + marketSideProbability * (1 - shrinkageWeight),
    );
  const edge = marketSideProbability === null ? null : finalProbability - marketSideProbability;
  const ev = args.mapped.odds.side === side ? safeExpectedValue(finalProbability, args.currentOdds) : null;
  const confidence = round(Math.min(0.88,
    0.6
    + (distribution.games >= 10 ? 0.08 : 0)
    + (args.lineupStatus.battingOrder !== null ? 0.04 : 0)
    + 0.06,
  ), 3);
  const canLean = args.mapped.odds.side === side
    && confidence >= 0.66
    && modelProbability >= 0.56
    && (edge ?? 0) >= 0.02
    && (ev ?? 0) >= 0.01;
  const canWatch = modelProbability >= 0.54
    || (edge ?? 0) >= 0.01
    || Math.abs(distribution.projectedMean - args.mapped.odds.line) >= lineGapThreshold("batter_hits_runs_rbis");
  if (!canLean && !canWatch) return null;

  return {
    side,
    modelProbability,
    finalProbability,
    shrinkageWeight,
    overModelProbability: distribution.overProbability,
    underModelProbability: distribution.underProbability,
    overFinalProbability: side === "over" ? finalProbability : round(1 - finalProbability, 4),
    underFinalProbability: side === "under" ? finalProbability : round(1 - finalProbability, 4),
    playGrade: canLean ? "LEAN" : "WATCHLIST",
    confidence,
    reasonCodes: uniqueStrings([
      "HITTER_INTEGRATED_MODEL_READ",
      "RECENT_FORM_EDGE",
      "MARKET_PRIOR_SHRINKAGE",
      args.lineupStatus.status === "posted" || args.lineupStatus.status === "confirmed"
        ? "LINEUP_STATUS_POSTED"
        : "PROJECTED_LINEUP_CONTEXT",
    ]),
    projection: distribution.projectedMean,
    modelFamily: BATTER_HRR_MODEL_VERSION,
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

function pitcherSignalGrade(args: {
  market: string;
  grade: string | null | undefined;
  projection: number;
  line: number;
  side: "over" | "under";
}): IntegratedPropSignal["playGrade"] {
  const grade = signalGrade(args.grade);
  if (grade !== "BEST_ANGLE") return grade;
  const minGap = pitcherBestAngleProjectionGap(args.market);
  if (minGap === null) return "LEAN";
  const signedGap = args.side === "over" ? args.projection - args.line : args.line - args.projection;
  return signedGap >= minGap ? "BEST_ANGLE" : "LEAN";
}

function pitcherBestAngleProjectionGap(market: string): number | null {
  if (market === "pitcher_outs") return 1;
  if (market === "pitcher_strikeouts") return 0.35;
  return null;
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
      research[row.researchKey] = {
        recentForm: recentForm ? { ...recentForm, logs: recentForm.logs.slice(0, 10) } : null,
        opponentProfile,
        pitchArsenal,
        pitchMatchup,
        matchupHistory,
        environment,
      };
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
  playerGameIdentityConflictRows?: number;
  previousSnapshot?: MlbPropsBoardSnapshot | null;
  probablePitcherFallbackAssignments?: number;
  probablePitcherFallbackFindings?: string[];
}): MlbPropsBoardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const staleOddsRows = args.data.props.filter((row) => isOddsStale(row.lastUpdated, args.asOfTimestamp)).length;
  const ids = args.data.props.map((row) => row.id);
  if (args.sourceRows === 0) errors.push("PROP_ODDS_UNAVAILABLE");
  if (args.providerCoverage) {
    if (args.providerCoverage.normalizedRows < args.sourceRows) errors.push("BDL_NORMALIZED_ROW_COUNT_MISMATCH");
    if (args.providerCoverage.normalizedRawProps + args.providerCoverage.droppedRawProps !== args.providerCoverage.totalRawProps) {
      errors.push("BDL_RAW_COVERAGE_COUNT_MISMATCH");
    }
    const malformedMarketTypes = args.providerCoverage.unmappedMarketTypes.filter((market) => market === "missing");
    const unsupportedMarketTypes = args.providerCoverage.unmappedMarketTypes.filter((market) => market !== "missing");
    if (malformedMarketTypes.length > 0) errors.push("BDL_PLAYER_PROP_TYPE_MISSING");
    // BDL can add unrelated combo or game markets to the player-props
    // endpoint without notice. Preserve every normalized supported market,
    // disclose the extras, and do not freeze the complete board merely
    // because the provider expanded its response.
    if (unsupportedMarketTypes.length > 0) {
      warnings.push(`IGNORED_UNSUPPORTED_BDL_MARKET_TYPES_${unsupportedMarketTypes.join("|")}`);
    }
    if (args.providerCoverage.droppedRawProps > 0) {
      warnings.push(`${args.providerCoverage.droppedRawProps}_BDL_RAW_OFFERS_NOT_NORMALIZED`);
    }
  }
  if (args.mappedRows === 0 && args.sourceRows > 0) errors.push("NO_ODDS_ROWS_MAPPED_TO_MLB_GAMES");
  if (args.sourceRows > 0 && args.mappedRows / args.sourceRows < 0.9) errors.push("ODDS_GAME_MAPPING_BELOW_90_PERCENT");
  if ((args.playerGameIdentityConflictRows ?? 0) > 0) {
    warnings.push(`${args.playerGameIdentityConflictRows}_PLAYER_GAME_IDENTITY_CONFLICT_ROWS_EXCLUDED`);
  }
  if ((args.probablePitcherFallbackAssignments ?? 0) > 0) {
    warnings.push(`PROBABLE_PITCHER_FALLBACK_ASSIGNMENTS_${args.probablePitcherFallbackAssignments}`);
  }
  warnings.push(...(args.probablePitcherFallbackFindings ?? []));
  if (args.data.props.length === 0 && args.sourceRows > 0) errors.push("NO_MEMBER_ROWS_WITH_VERIFIED_PLAYER_HISTORY");
  const maxBoardRows = envPositiveInteger("ODDSPHERE_PROPS_MAX_BOARD_ROWS", DEFAULT_MAX_BOARD_ROWS);
  if (args.data.props.length > maxBoardRows) errors.push(`BOARD_ROW_LIMIT_EXCEEDED_${args.data.props.length}_OF_${maxBoardRows}`);
  if (new Set(ids).size !== ids.length) errors.push("DUPLICATE_BOARD_ROW_IDS");
  if (args.data.props.some((row) => !Number.isFinite(row.line) || !Number.isFinite(row.odds) || !Number.isFinite(row.projection))) errors.push("NON_FINITE_MEMBER_VALUE");
  if (staleOddsRows > 0) {
    errors.push("STALE_ODDS_PRESENT");
    warnings.push(`${staleOddsRows}_STALE_ODDS_ROWS_WITHHELD_FROM_SIGNALS`);
  }
  const incompleteResearchRows = args.data.props.filter((row) => row.missingFeatures.length > 0);
  // Missing required research is a row-scoped hold when the row has already
  // failed closed to PENDING_DATA/RESEARCH. Do not let those explicitly held
  // rows freeze an otherwise coherent full-slate snapshot. Conversely, any
  // incomplete row that escaped into a normal grade remains a publication
  // error; this prevents missing evidence from masquerading as an ordinary
  // NO_PLAY/Watchlist or actionable recommendation.
  const unsafeIncompleteResearchRows = incompleteResearchRows.filter((row) =>
    row.playGrade !== "PENDING_DATA" && row.playGrade !== "RESEARCH"
  );
  if (unsafeIncompleteResearchRows.length > 0) {
    errors.push(`REQUIRED_RESEARCH_INCOMPLETE_${unsafeIncompleteResearchRows.length}`);
  } else if (incompleteResearchRows.length > 0) {
    warnings.push(`REQUIRED_RESEARCH_HELD_ROWS_${incompleteResearchRows.length}`);
    const starterUnavailableRows = incompleteResearchRows.filter((row) =>
      row.missingFeatures.includes("opposing starter")
    );
    if (starterUnavailableRows.length > 0) {
      warnings.push(`OPPOSING_STARTER_UNAVAILABLE_ROWS_${starterUnavailableRows.length}`);
    }
    const isolatedPitchMixRows = incompleteResearchRows.filter((row) =>
      row.missingFeatures.includes("pitch mix matchup") && !row.missingFeatures.includes("opposing starter")
    );
    const pitchMixSampleRows = isolatedPitchMixRows.filter((row) => {
      const shared = row.researchKey ? args.data.research?.[row.researchKey] : null;
      return Boolean(row.pitchMatchup ?? shared?.pitchMatchup);
    });
    if (pitchMixSampleRows.length > 0) {
      warnings.push(`PITCH_MIX_SAMPLE_INSUFFICIENT_ROWS_${pitchMixSampleRows.length}`);
    }
    const pitchMixUnavailableRows = isolatedPitchMixRows.length - pitchMixSampleRows.length;
    if (pitchMixUnavailableRows > 0) {
      warnings.push(`PITCH_MIX_DATA_UNAVAILABLE_ROWS_${pitchMixUnavailableRows}`);
    }
  }
  const pendingLineups = args.data.props.filter((row) => row.marketFamily !== "pitcher" && row.lineupStatus?.status === "pending").length;
  if (pendingLineups > 0) warnings.push(`${pendingLineups}_HITTER_ROWS_PROJECTED_LINEUP`);
  const actionableRows = args.data.props.filter((row) => ACTIONABLE_GRADES.has(row.playGrade)).length;
  const invalidActionable = args.data.props.filter((row) => ACTIONABLE_GRADES.has(row.playGrade) && (
    row.finalProbability === null
    || row.modelEdge === null
    || row.oddsSanity.length > 0
    || row.missingFeatures.some((feature) => !isSignalOptionalMemberFeature(feature))
    || !assessPropPrice(row.odds).signalEligible
  ));
  if (invalidActionable.length) errors.push("ACTIONABLE_ROWS_FAILED_DATA_GATE");
  const previous = args.previousSnapshot;
  if (previous && previous.validation.sourceRows > 0 && args.sourceRows >= previous.validation.sourceRows * 0.9) {
    // Normalize an older snapshot through the current member-board compaction
    // contract before comparing counts. Otherwise a release that removes
    // duplicate books/alternate lines looks like a catastrophic board/model
    // contraction even when the underlying provider and unique plays grew.
    const comparablePreviousRows = compactMemberBoardRows(
      previous.data.props,
      previous.asOfTimestamp,
    );
    const previousRows = comparablePreviousRows.length;
    if (previousRows >= 20 && args.data.props.length < previousRows * 0.75) {
      errors.push(`UNEXPECTED_BOARD_CONTRACTION_${args.data.props.length}_OF_${previousRows}`);
    }
    const previousActionable = comparablePreviousRows.filter((row) =>
      ACTIONABLE_GRADES.has(row.playGrade)
    ).length;
    if (previousActionable >= 10 && actionableRows < previousActionable * 0.5) {
      errors.push(`UNEXPECTED_ACTIONABLE_CONTRACTION_${actionableRows}_OF_${previousActionable}`);
    }
  }
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

function compactOpeningPropOddsForSnapshot(
  openingOdds: PropOddsSnapshot[],
  memberRows: PlayerPropPreviewRow[],
): PropOddsSnapshot[] {
  const exactOpenings = new Map(openingOdds.map((row) => [openingOddsExactKey(row), row]));
  const openingsByBase = new Map<string, PropOddsSnapshot[]>();
  for (const opening of openingOdds) {
    const base = openingOddsBaseKey(opening);
    openingsByBase.set(base, [...(openingsByBase.get(base) ?? []), opening]);
  }
  const selected = new Map<string, PropOddsSnapshot>();
  for (const row of memberRows) {
    const opening = exactOpenings.get(dashboardOddsExactKey(row))
      ?? nearestOpeningQuote(row, openingsByBase.get(dashboardOddsBaseKey(row)) ?? []);
    if (opening) selected.set(openingOddsExactKey(opening), opening);
  }
  return [...selected.values()];
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
      resolvedTeamAbbreviation: row.team,
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

function opponentTeamFor(
  row: MappedOddsRow,
  identity: PlayerIdentity | undefined,
  probables: MlbProbablePitcher[] = [],
): string | null {
  const officialPitcher = identity
    ? probableForPlayer(probables, row.game.id, identity.player.fullName)
    : null;
  const playerTeam = officialPitcher
    ? resolveMlbStatsTeamId(officialPitcher.teamId)
    : eventScopedPlayerTeam(row)
      ?? resolveMlbTeamAlias(identity?.resolvedTeamAbbreviation ?? identity?.player.teamAbbreviation);
  const home = resolveMlbStatsTeamId(row.game.homeTeamId);
  return playerTeam?.id === home?.id ? row.game.awayTeamId : row.game.homeTeamId;
}

function opposingPitcherId(
  row: MappedOddsRow,
  identity: PlayerIdentity | undefined,
  probables: MlbProbablePitcher[] = [],
): number | null {
  const playerTeam = eventScopedPlayerTeam(row)
    ?? resolveMlbTeamAlias(identity?.resolvedTeamAbbreviation ?? identity?.player.teamAbbreviation);
  const home = resolveMlbTeamAlias(stringValue(row.raw.event_home_team));
  const value = playerTeam?.id === home?.id ? row.raw.bdl_away_pitcher_id : row.raw.bdl_home_pitcher_id;
  const providerId = numberValue(value);
  if (providerId !== null) return providerId;
  const probable = opposingProbableFor(row, identity, probables);
  return probable ? numberValue(record(probable.rawPayload).bdl_player_id) : null;
}

function opposingProbableFor(
  row: MappedOddsRow,
  identity: PlayerIdentity | undefined,
  probables: MlbProbablePitcher[],
): MlbProbablePitcher | null {
  const opponentTeamId = opponentTeamFor(row, identity, probables);
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
  const playerTeam = eventScopedPlayerTeam(row)
    ?? resolveMlbTeamAlias(identity.resolvedTeamAbbreviation ?? identity.player.teamAbbreviation);
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
  // Provider quote IDs are refresh-scoped and can rotate even when the
  // underlying offer is unchanged. The compact member board has one selected
  // main-line row per player/market/side, so use that stable identity here and
  // leave book, line, and price out of the key: those are the values movement
  // tracking is supposed to compare between snapshots.
  return `${mainLineKey(row)}|${row.side}`;
}

function dedupeRows(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const out = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const current = out.get(row.id);
    if (!current || row.lastUpdated > current.lastUpdated) out.set(row.id, row);
  }
  return [...out.values()].sort((a, b) => a.gameStartTime.localeCompare(b.gameStartTime) || a.player.localeCompare(b.player) || a.marketLabel.localeCompare(b.marketLabel));
}

function compactMemberBoardRows(rows: PlayerPropPreviewRow[], asOfTimestamp: string): PlayerPropPreviewRow[] {
  const freshVisible = rows.filter((row) => !isOddsStale(row.lastUpdated, asOfTimestamp) && !MEMBER_EXCLUDED_MARKETS.has(row.market));
  const selectedLines = selectMainLines(freshVisible);
  const mainLineRows = freshVisible.filter((row) => selectedLines.get(mainLineKey(row)) === row.line);
  return selectBestPriceRows(mainLineRows).sort((a, b) =>
    a.gameStartTime.localeCompare(b.gameStartTime)
    || a.player.localeCompare(b.player)
    || a.marketLabel.localeCompare(b.marketLabel)
    || a.side.localeCompare(b.side)
  );
}

function isMemberExcludedSourceOdds(row: PropOddsSnapshot): boolean {
  if (MEMBER_EXCLUDED_MARKETS.has(row.marketKey)) return true;
  const raw = record(row.rawPayload);
  const alternateLine = raw.is_alternate_line ?? raw.alternate ?? raw.isAlternateLine;
  return alternateLine === true || alternateLine === "true";
}

function selectMainLines(rows: PlayerPropPreviewRow[]): Map<string, number> {
  const groups = new Map<string, Map<number, PlayerPropPreviewRow[]>>();
  for (const row of rows) {
    const key = mainLineKey(row);
    const lines = groups.get(key) ?? new Map<number, PlayerPropPreviewRow[]>();
    lines.set(row.line, [...(lines.get(row.line) ?? []), row]);
    groups.set(key, lines);
  }
  const selected = new Map<string, number>();
  for (const [key, lines] of groups) {
    const ranked = [...lines.entries()].map(([line, lineRows]) => ({
      line,
      sides: new Set(lineRows.map((row) => row.side)).size,
      books: new Set(lineRows.map((row) => row.book)).size,
      balance: lineRows.reduce((sum, row) => sum + Math.abs((assessPropPrice(row.odds).impliedProbability ?? 0.5) - 0.5), 0) / lineRows.length,
    })).sort((a, b) => b.sides - a.sides || b.books - a.books || a.balance - b.balance || a.line - b.line);
    if (ranked[0]) selected.set(key, ranked[0].line);
  }
  return selected;
}

function selectBestPriceRows(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const best = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const key = `${mainLineKey(row)}|${row.side}|${row.line}`;
    const current = best.get(key);
    if (!current || shouldReplaceBestPriceRow(current, row)) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

function mainLineKey(row: PlayerPropPreviewRow): string {
  return `${row.providerIds?.gameId ?? row.gameStartTime}|${row.providerIds?.bdlPlayerId ?? row.player}|${row.team}|${row.opponent}|${row.market}`;
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
  // The canonical fast writer runs every 30 minutes. The five-minute margin
  // covers normal scheduler jitter; stale quote rows are still rejected by
  // the independent 45-minute odds-age policy.
  const maxMinutes = Number(process.env.ODDSPHERE_PROPS_MAX_SNAPSHOT_AGE_MINUTES ?? 35);
  const age = now.getTime() - Date.parse(snapshot.asOfTimestamp);
  return Number.isFinite(age) && age >= 0 && age <= maxMinutes * 60_000;
}

export function supportedLiveMlbPropMarkets(): string[] {
  return allMlbPropMarketDefinitions().map((market) => market.marketKey);
}
