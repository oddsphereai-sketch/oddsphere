import {
  american_to_decimal,
  american_to_implied_probability,
} from "./oddsMath";
import { BdlClient, BdlNotFoundError } from "../../providers/real_api/_bdlClient";
import { getHitterGameLogs as fetchHitterGameLogs, getPitcherGameLogs } from "../../providers/real_api/_mlbStatsApiClient";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type {
  MlbGameEntity,
  MlbHistoricalStatProvider,
  MlbHistoricalStatRow,
  MlbInjury,
  MlbInjuryProvider,
  MlbLineupProvider,
  MlbLineupSpot,
  MlbPlayerEntity,
  MlbPlayerTeamMetadataProvider,
  MlbProbablePitcher,
  MlbProbablePitcherProvider,
  MlbPropProviderBundle,
  MlbScheduleGameProvider,
  MlbTeamEntity,
  MlbWeatherProvider,
  MlbWeatherSnapshot,
  PropOddsProvider,
  PropOddsSnapshot,
  PropSettlementProvider,
  PropSettlementResult,
} from "./providers";
import type { MlbPropMarketKey } from "./config";
import { getMlbPropMarketDefinition } from "./marketCatalog";

type MockFixture = {
  teams: MlbTeamEntity[];
  players: MlbPlayerEntity[];
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  lineups: MlbLineupSpot[];
  injuries: MlbInjury[];
  weather: MlbWeatherSnapshot[];
  playerGameLogs: MlbHistoricalStatRow[];
  odds: PropOddsSnapshot[];
  results: PropSettlementResult[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this provider`);
  return value;
}

type BallDontLieMlbGame = {
  id?: number | string | null;
  date?: string | null;
  game_date?: string | null;
  status?: string | null;
  season?: number | null;
  home_team?: Record<string, unknown> | null;
  away_team?: Record<string, unknown> | null;
  home_team_id?: number | string | null;
  away_team_id?: number | string | null;
  home_team_pitcher?: Record<string, unknown> | null;
  away_team_pitcher?: Record<string, unknown> | null;
  home_team_pitcher_id?: number | string | null;
  away_team_pitcher_id?: number | string | null;
  venue?: string | null;
};

export type BallDontLiePlayerPropCoverage = {
  totalRawProps: number;
  normalizedRawProps: number;
  droppedRawProps: number;
  normalizedRows: number;
  marketTypeCounts: Record<string, number>;
  unmappedMarketTypes: string[];
  vendorsFound: string[];
};

type BallDontLiePlayerPropTrace = BallDontLiePlayerPropCoverage & {
  provider: "balldontlie";
  date: string;
  generatedAt: string;
  writesToSupabase: false;
  gamesFound: number;
  gamesWithPlayerProps: number;
  pitcherStrikeoutRows: number;
  pitcherOutsRows: number;
  overUnderRows: number;
  milestoneRows: number;
  hardRockRows: number;
  games: Array<{
    gameId: string;
    scheduledStart: string | null;
    status: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    rawProps: number;
    normalizedRawProps: number;
    droppedRawProps: number;
    normalizedRows: number;
    marketTypesFound: string[];
    unmappedMarketTypes: string[];
    pitcherStrikeoutRows: number;
    pitcherOutsRows: number;
    vendorsFound: string[];
    error: string | null;
  }>;
};

const BALLDONTLIE_MARKET_MAP: Record<string, MlbPropMarketKey> = {
  pitcher_strikeouts: "pitcher_strikeouts",
  pitching_strikeouts: "pitcher_strikeouts",
  player_pitching_strikeouts: "pitcher_strikeouts",
  pitcher_outs: "pitcher_outs",
  pitching_outs: "pitcher_outs",
  pitcher_outs_recorded: "pitcher_outs",
  outs_recorded: "pitcher_outs",
  outs: "pitcher_outs",
  pitcher_hits_allowed: "pitcher_hits_allowed",
  pitching_hits_allowed: "pitcher_hits_allowed",
  hits_allowed: "pitcher_hits_allowed",
  pitcher_walks: "pitcher_walks",
  pitching_walks: "pitcher_walks",
  pitcher_bases_on_balls: "pitcher_walks",
  pitcher_earned_runs: "pitcher_earned_runs",
  pitching_earned_runs: "pitcher_earned_runs",
  earned_runs_allowed: "pitcher_earned_runs",
  pitcher_record_a_win: "pitcher_record_a_win",
  pitcher_win: "pitcher_record_a_win",
  pitcher_to_record_a_win: "pitcher_record_a_win",
  hits: "batter_hits",
  batter_hits: "batter_hits",
  player_hits: "batter_hits",
  home_runs: "batter_home_runs",
  homeruns: "batter_home_runs",
  batter_home_runs: "batter_home_runs",
  total_bases: "batter_total_bases",
  batter_total_bases: "batter_total_bases",
  rbis: "batter_rbis",
  runs_batted_in: "batter_rbis",
  batter_rbis: "batter_rbis",
  stolen_bases: "batter_stolen_bases",
  batter_stolen_bases: "batter_stolen_bases",
  singles: "batter_singles",
  batter_singles: "batter_singles",
  doubles: "batter_doubles",
  batter_doubles: "batter_doubles",
  triples: "batter_triples",
  batter_triples: "batter_triples",
  walks: "batter_walks",
  batter_walks: "batter_walks",
  batter_bases_on_balls: "batter_walks",
  strikeouts: "batter_strikeouts",
  batter_strikeouts: "batter_strikeouts",
  runs_scored: "batter_runs_scored",
  batter_runs_scored: "batter_runs_scored",
  hits_runs_rbis: "batter_hits_runs_rbis",
  hits_runs_and_rbis: "batter_hits_runs_rbis",
  batter_hits_runs_rbis: "batter_hits_runs_rbis",
  first_home_run: "first_home_run",
  first_homerun: "first_home_run",
};

export class BallDontLieMlbPropsClient implements PropOddsProvider {
  private readonly client: BdlClient;
  private coverage: BallDontLiePlayerPropCoverage = emptyBallDontLiePlayerPropCoverage();

  constructor(apiKey = requireEnv("BALLDONTLIE_API_KEY")) {
    this.client = new BdlClient(apiKey);
  }

  getClient(): BdlClient {
    return this.client;
  }

  getCoverageSummary(): BallDontLiePlayerPropCoverage {
    return {
      ...this.coverage,
      marketTypeCounts: { ...this.coverage.marketTypeCounts },
      unmappedMarketTypes: [...this.coverage.unmappedMarketTypes],
      vendorsFound: [...this.coverage.vendorsFound],
    };
  }

  async getPropOdds(args: { date: string; asOfTimestamp?: string; maxPages?: number }): Promise<PropOddsSnapshot[]> {
    const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
    const maxPages = Math.max(1, Math.min(args.maxPages ?? 5, 20));
    const games = await this.enrichGamesWithProbablePitchers(await this.getGamesForDate(args.date, maxPages));
    const trace: BallDontLiePlayerPropTrace = {
      provider: "balldontlie",
      date: args.date,
      generatedAt: asOfTimestamp,
      writesToSupabase: false,
      gamesFound: games.length,
      gamesWithPlayerProps: 0,
      totalRawProps: 0,
      normalizedRawProps: 0,
      droppedRawProps: 0,
      normalizedRows: 0,
      pitcherStrikeoutRows: 0,
      pitcherOutsRows: 0,
      overUnderRows: 0,
      milestoneRows: 0,
      marketTypeCounts: {},
      unmappedMarketTypes: [],
      vendorsFound: [],
      hardRockRows: 0,
      games: [],
    };
    const rows: PropOddsSnapshot[] = [];
    for (const game of games) {
      const gameId = stringOrNull(game.id);
      if (!gameId) continue;
      const gameTrace: BallDontLiePlayerPropTrace["games"][number] = {
        gameId,
        scheduledStart: bdlGameStartTime(game),
        status: stringOrNull(game.status),
        homeTeam: bdlGameTeamName(game, "home"),
        awayTeam: bdlGameTeamName(game, "away"),
        rawProps: 0,
        normalizedRawProps: 0,
        droppedRawProps: 0,
        normalizedRows: 0,
        marketTypesFound: [],
        unmappedMarketTypes: [],
        pitcherStrikeoutRows: 0,
        pitcherOutsRows: 0,
        vendorsFound: [],
        error: null,
      };
      try {
        const rawProps = await this.client.fetchAll<Record<string, unknown>>({
          path: "/odds/player_props",
          query: { game_id: gameId, per_page: 100 },
          maxPages,
        });
        gameTrace.rawProps = rawProps.length;
        if (rawProps.length > 0) trace.gamesWithPlayerProps++;
        const rawCoverage = rawProps.map((rawProp) => {
          const marketType = normalizeBdlMarketKey(stringOrNull(rawProp.prop_type)) ?? "missing";
          trace.marketTypeCounts[marketType] = (trace.marketTypeCounts[marketType] ?? 0) + 1;
          return {
            marketType,
            mapped: marketType !== "missing" && Boolean(BALLDONTLIE_MARKET_MAP[marketType]),
            rows: parseBallDontLiePlayerProps([rawProp], asOfTimestamp, game),
          };
        });
        const parsed = rawCoverage.flatMap((entry) => entry.rows);
        const normalizedRawProps = rawCoverage.filter((entry) => entry.rows.length > 0).length;
        const unmappedMarketTypes = [...new Set(rawCoverage.filter((entry) => !entry.mapped).map((entry) => entry.marketType))].sort();
        rows.push(...parsed);
        gameTrace.normalizedRawProps = normalizedRawProps;
        gameTrace.droppedRawProps = rawProps.length - normalizedRawProps;
        gameTrace.normalizedRows = parsed.length;
        gameTrace.marketTypesFound = [...new Set(rawCoverage.map((entry) => entry.marketType))].sort();
        gameTrace.unmappedMarketTypes = unmappedMarketTypes;
        gameTrace.pitcherStrikeoutRows = parsed.filter((row) => row.marketKey === "pitcher_strikeouts").length;
        gameTrace.pitcherOutsRows = parsed.filter((row) => row.marketKey === "pitcher_outs").length;
        gameTrace.vendorsFound = [...new Set(parsed.map((row) => row.sportsbook))].sort();
        trace.totalRawProps += rawProps.length;
        trace.normalizedRawProps += normalizedRawProps;
        trace.droppedRawProps += rawProps.length - normalizedRawProps;
        trace.overUnderRows += rawProps.filter((row) => stringOrNull(rawObj(row.market).type)?.toLowerCase() === "over_under").length;
        trace.milestoneRows += rawProps.filter((row) => stringOrNull(rawObj(row.market).type)?.toLowerCase() === "milestone").length;
        trace.unmappedMarketTypes = [...new Set([...trace.unmappedMarketTypes, ...unmappedMarketTypes])].sort();
      } catch (e) {
        if (e instanceof BdlNotFoundError) {
          gameTrace.error = null;
        } else {
          gameTrace.error = e instanceof Error ? e.message : String(e);
        }
      }
      trace.games.push(gameTrace);
    }
    trace.normalizedRows = rows.length;
    trace.pitcherStrikeoutRows = rows.filter((row) => row.marketKey === "pitcher_strikeouts").length;
    trace.pitcherOutsRows = rows.filter((row) => row.marketKey === "pitcher_outs").length;
    trace.vendorsFound = [...new Set(rows.map((row) => row.sportsbook))].sort();
    trace.hardRockRows = rows.filter((row) => normalizeBook(row.sportsbook) === "hardrock").length;
    this.coverage = {
      totalRawProps: trace.totalRawProps,
      normalizedRawProps: trace.normalizedRawProps,
      droppedRawProps: trace.droppedRawProps,
      normalizedRows: trace.normalizedRows,
      marketTypeCounts: { ...trace.marketTypeCounts },
      unmappedMarketTypes: [...trace.unmappedMarketTypes],
      vendorsFound: [...trace.vendorsFound],
    };
    await writeBallDontLieTrace(trace);
    return rows;
  }

  async getOpeningPropOdds(args: { gameIds: string[]; asOfTimestamp?: string }): Promise<PropOddsSnapshot[]> {
    const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
    const rows: PropOddsSnapshot[] = [];
    for (const gameId of [...new Set(args.gameIds.map((value) => value.trim()).filter(Boolean))]) {
      try {
        const rawProps = await this.client.fetchAll<Record<string, unknown>>({
          path: "/odds/player_props/opening",
          query: { game_id: gameId },
          maxPages: 1,
        });
        rows.push(...parseBallDontLiePlayerProps(rawProps, asOfTimestamp, undefined, "opening"));
      } catch (error) {
        if (error instanceof BdlNotFoundError) continue;
        throw error;
      }
    }
    return rows;
  }

  private async getGamesForDate(date: string, maxPages: number): Promise<BallDontLieMlbGame[]> {
    const dates = [date, addOneCalendarDayUTC(date)];
    const byId = new Map<string, BallDontLieMlbGame>();
    for (const d of dates) {
      try {
        const rows = await this.client.fetchAll<BallDontLieMlbGame>({
          path: "/games",
          query: { "dates[]": [d], per_page: 100 },
          maxPages,
        });
        for (const row of rows) {
          const id = stringOrNull(row.id);
          if (!id || byId.has(id)) continue;
          const start = bdlGameStartTime(row);
          if ((start && eventEtDate({ start_time: start }) === date) || (!start && String(row.date ?? row.game_date ?? "").slice(0, 10) === date)) {
            byId.set(id, row);
          }
        }
      } catch (e) {
        if (e instanceof BdlNotFoundError) continue;
        throw e;
      }
    }
    return [...byId.values()].sort((a, b) => String(bdlGameStartTime(a) ?? "").localeCompare(String(bdlGameStartTime(b) ?? "")));
  }

  private async enrichGamesWithProbablePitchers(games: BallDontLieMlbGame[]): Promise<BallDontLieMlbGame[]> {
    const missing = games.filter((game) => !bdlGamePitcherId(game, "home") || !bdlGamePitcherId(game, "away"));
    const gameIds = missing.map((game) => stringOrNull(game.id)).filter((id): id is string => id !== null);
    if (!gameIds.length) return games;
    try {
      const rows = await this.client.fetchAll<Record<string, unknown>>({
        path: "/lineups",
        query: { "game_ids[]": gameIds, per_page: 100 },
        maxPages: 10,
      });
      const probableByGameAndTeam = new Map<string, string>();
      for (const row of rows) {
        if (!booleanValue(row.is_probable_pitcher) && !booleanValue(row.probable_pitcher)) continue;
        const gameId = stringOrNull(row.game_id ?? rawObj(row.game).id);
        const teamId = stringOrNull(row.team_id ?? rawObj(row.team).id);
        const playerId = stringOrNull(row.player_id ?? rawObj(row.player).id);
        if (gameId && playerId && teamId) probableByGameAndTeam.set(`${gameId}|${teamId}`, playerId);
      }
      return games.map((game) => {
        const gameId = stringOrNull(game.id);
        const homeTeamId = stringOrNull(game.home_team_id ?? game.home_team?.id);
        const awayTeamId = stringOrNull(game.away_team_id ?? game.away_team?.id);
        if (!gameId) return game;
        return {
          ...game,
          home_team_pitcher_id: stringOrNull(game.home_team_pitcher_id)
            ?? (homeTeamId ? probableByGameAndTeam.get(`${gameId}|${homeTeamId}`) : null),
          away_team_pitcher_id: stringOrNull(game.away_team_pitcher_id)
            ?? (awayTeamId ? probableByGameAndTeam.get(`${gameId}|${awayTeamId}`) : null),
        };
      });
    } catch (e) {
      if (e instanceof BdlNotFoundError) return games;
      throw e;
    }
  }
}

function emptyBallDontLiePlayerPropCoverage(): BallDontLiePlayerPropCoverage {
  return {
    totalRawProps: 0,
    normalizedRawProps: 0,
    droppedRawProps: 0,
    normalizedRows: 0,
    marketTypeCounts: {},
    unmappedMarketTypes: [],
    vendorsFound: [],
  };
}

export function parseBallDontLiePlayerProps(
  payload: unknown,
  asOfTimestamp: string,
  gameMeta?: BallDontLieMlbGame,
  snapshotRole: "opening" | "current" = "current",
): PropOddsSnapshot[] {
  const props = rowsFromPayloadDeep(payload);
  const rows: PropOddsSnapshot[] = [];
  for (const prop of props) {
    const marketType = normalizeBdlMarketKey(stringOrNull(prop.prop_type));
    const marketKey = marketType ? BALLDONTLIE_MARKET_MAP[marketType] : null;
    if (!marketKey) continue;
    const definition = getMlbPropMarketDefinition(marketKey);
    const market = rawObj(prop.market);
    const marketKind = stringOrNull(market.type)?.toLowerCase();
    if (marketKind !== "over_under" && marketKind !== "milestone") continue;
    const line = numberOrNull(prop.line_value) ?? numberOrNull(market.line) ?? (marketKind === "milestone" ? 0.5 : null);
    const overOdds = numberOrNull(market.over_odds);
    const underOdds = numberOrNull(market.under_odds);
    const milestoneOdds = numberOrNull(market.odds) ?? numberOrNull(market.yes_odds) ?? numberOrNull(prop.odds);
    const gameId = stringOrNull(prop.game_id) ?? (gameMeta ? stringOrNull(gameMeta.id) : null);
    const playerId = stringOrNull(prop.player_id) ?? readPlayerId(prop);
    const sportsbook = normalizeBook(stringOrNull(prop.vendor) ?? "unknown");
    if (!gameId || !playerId || !Number.isFinite(line) || !sportsbook) continue;
    if (marketKind === "over_under" && !Number.isFinite(overOdds) && !Number.isFinite(underOdds)) continue;
    if (marketKind === "milestone" && !Number.isFinite(milestoneOdds)) continue;
    const playerName = readPlayerName(prop);
    const playerTeamId = firstStringDeep(prop, ["team_id", "player_team_id"]);
    const timestamp = snapshotRole === "opening"
      ? stringOrNull(prop.opened_at) ?? stringOrNull(prop.updated_at) ?? asOfTimestamp
      : stringOrNull(prop.updated_at) ?? asOfTimestamp;
    const baseRawPayload = {
      provider: "balldontlie",
      provider_prop_id: stringOrNull(prop.id),
      bdl_game_id: gameId,
      bdl_player_id: playerId,
      bdl_player_team_id: playerTeamId,
      vendor: stringOrNull(prop.vendor),
      updated_at: stringOrNull(prop.updated_at),
      market_type: marketType,
      market_kind: marketKind,
      normalized_market_key: marketKey,
      market_family: definition.family,
      model_family: definition.modelFamily,
      settlement_stat_key: definition.settlementStatKey,
      display_status: definition.defaultDisplayStatus,
      recommendation_eligibility: definition.recommendationEligibility,
      two_way_eligible: definition.twoWayEligible,
      milestone_odds: milestoneOdds,
      over_odds: overOdds,
      under_odds: underOdds,
      player_name: playerName,
      event_home_team: gameMeta ? bdlGameTeamName(gameMeta, "home") : null,
      event_away_team: gameMeta ? bdlGameTeamName(gameMeta, "away") : null,
      bdl_home_team_id: gameMeta ? stringOrNull(gameMeta.home_team_id ?? gameMeta.home_team?.id) : null,
      bdl_away_team_id: gameMeta ? stringOrNull(gameMeta.away_team_id ?? gameMeta.away_team?.id) : null,
      bdl_home_pitcher_id: gameMeta ? bdlGamePitcherId(gameMeta, "home") : null,
      bdl_away_pitcher_id: gameMeta ? bdlGamePitcherId(gameMeta, "away") : null,
      event_start_time: gameMeta ? bdlGameStartTime(gameMeta) : null,
      event_status: gameMeta ? stringOrNull(gameMeta.status) : null,
      is_main_line: true,
      is_alternate_line: false,
    };
    if (marketKind === "milestone" && Number.isFinite(milestoneOdds)) {
      rows.push(makeBdlOddsRow({
        marketKey,
        gameId,
        playerId,
        sportsbook,
        side: "over",
        line: line as number,
        americanOdds: milestoneOdds as number,
        timestamp,
        snapshotRole,
        rawPayload: {
          ...baseRawPayload,
          selection_type: "milestone",
          reason_codes: definition.missingFeatureReasons,
        },
      }));
      continue;
    }
    if (Number.isFinite(overOdds)) {
      rows.push(makeBdlOddsRow({
        marketKey,
        gameId,
        playerId,
        sportsbook,
        side: "over",
        line: line as number,
        americanOdds: overOdds as number,
        timestamp,
        snapshotRole,
        rawPayload: {
          ...baseRawPayload,
          selection_type: "over",
          reason_codes: Number.isFinite(underOdds) ? [] : ["MISSING_TWO_WAY_PAIR"],
        },
      }));
    }
    if (Number.isFinite(underOdds)) {
      rows.push(makeBdlOddsRow({
        marketKey,
        gameId,
        playerId,
        sportsbook,
        side: "under",
        line: line as number,
        americanOdds: underOdds as number,
        timestamp,
        snapshotRole,
        rawPayload: {
          ...baseRawPayload,
          selection_type: "under",
          reason_codes: Number.isFinite(overOdds) ? [] : ["MISSING_TWO_WAY_PAIR"],
        },
      }));
    }
  }
  return rows;
}

function makeBdlOddsRow(args: {
  marketKey: MlbPropMarketKey;
  gameId: string;
  playerId: string;
  sportsbook: string;
  side: "over" | "under";
  line: number;
  americanOdds: number;
  timestamp: string;
  snapshotRole: "opening" | "current";
  rawPayload: Record<string, unknown>;
}): PropOddsSnapshot {
  return {
    marketKey: args.marketKey,
    gameId: `balldontlie-game-${args.gameId}`,
    playerId: `balldontlie-player-${args.playerId}`,
    sportsbook: args.sportsbook,
    side: args.side,
    line: args.line,
    americanOdds: args.americanOdds,
    decimalOdds: american_to_decimal(args.americanOdds),
    impliedProbability: american_to_implied_probability(args.americanOdds),
    asOfTimestamp: args.timestamp,
    snapshotRole: args.snapshotRole,
    provider: "balldontlie",
    rawPayload: args.rawPayload,
  };
}

function bdlGameStartTime(game: BallDontLieMlbGame): string | null {
  return stringOrNull(game.game_date ?? game.date);
}

function bdlGameTeamName(game: BallDontLieMlbGame, side: "home" | "away"): string | null {
  const team = side === "home" ? game.home_team : game.away_team;
  if (isRecord(team)) {
    return firstString(team, ["full_name", "display_name", "name", "abbreviation"]);
  }
  return stringOrNull(side === "home" ? game.home_team_id : game.away_team_id);
}

function bdlGamePitcherId(game: BallDontLieMlbGame, side: "home" | "away"): string | null {
  const pitcher = side === "home" ? game.home_team_pitcher : game.away_team_pitcher;
  return stringOrNull(side === "home" ? game.home_team_pitcher_id : game.away_team_pitcher_id) ?? stringOrNull(pitcher?.id);
}

function normalizeBdlMarketKey(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]+/g, "");
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function rawObj(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function addOneCalendarDayUTC(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date: ${date}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function writeBallDontLieTrace(trace: BallDontLiePlayerPropTrace): Promise<void> {
  const outputDir = providerTraceDirectory();
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${trace.date}-balldontlie-player-props-trace.json`), JSON.stringify(trace, null, 2));
}

export class SharpApiPropsClient implements PropOddsProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = requireEnv("SHARPAPI_KEY"), baseUrl = process.env.ODDSPHERE_SHARPAPI_BASE_URL ?? "https://api.sharpapi.io/api/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getPropOdds(args: { date: string; asOfTimestamp?: string; maxPages?: number }): Promise<PropOddsSnapshot[]> {
    const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
    const maxPages = Math.max(1, Math.min(args.maxPages ?? 5, 20));
    const trace = newSharpApiTrace(args.date, asOfTimestamp, maxPages);
    const eventFetches = await this.fetchEventVariants(args.date, maxPages);
    trace.eventEndpoints = eventFetches.map(({ label, path: endpointPath, query, pages, rows, statuses }) => ({
      label,
      endpointPath,
      query,
      pagesFetched: pages.length,
      statusCodes: statuses,
      rawRows: rows.length,
    }));
    const allEvents = dedupeById(eventFetches.flatMap((entry) => entry.rows));
    const dateEvents = allEvents.filter((event) => sharpEventMatchesDate(event, args.date));
    const mlbEvents = dateEvents.filter(isLikelyMlbEvent);
    const usableEvents = mlbEvents
      .filter(hasEventId)
      .filter((event) => !isUnsupportedSharpEvent(event))
      .filter((event) => Boolean(eventTeamName(event, "home")) && Boolean(eventTeamName(event, "away")))
      .sort(compareSharpEventsForProps)
      .slice(0, 30);
    trace.eventCounts = {
      rawEventsReturned: allEvents.length,
      afterDateFilter: dateEvents.length,
      afterLeagueSportFilter: mlbEvents.length,
      afterUnsupportedEventFilter: mlbEvents.filter((event) => hasEventId(event) && !isUnsupportedSharpEvent(event)).length,
      afterTeamContextFilter: usableEvents.length,
    };
    trace.eventsSelected = usableEvents.map((event) => ({
      eventId: String(event.id ?? ""),
      scheduledStart: eventStartTime(event),
      etDate: eventEtDate(event),
      league: stringOrNull(event.league),
      sport: stringOrNull(event.sport),
      status: stringOrNull(event.status ?? event.state ?? event.event_status),
      homeTeam: eventTeamName(event, "home"),
      awayTeam: eventTeamName(event, "away"),
      marketsAdvertised: eventMarkets(event),
    }));

    const rows: PropOddsSnapshot[] = [];
    for (const event of usableEvents) {
      const eventId = String(event.id ?? "");
      const eventTrace = newSharpApiEventTrace(eventId, event);
      const rawRows: Record<string, unknown>[] = [];

      const unfiltered = await this.fetchPages(`/events/${encodeURIComponent(eventId)}/odds`, {}, maxPages);
      eventTrace.endpointCalls.push(pageTrace("event_odds_unfiltered", `/events/${eventId}/odds`, {}, unfiltered));
      rawRows.push(...unfiltered.rows);

      const unfilteredParsed = parseSharpApiProps(unfiltered.rows, asOfTimestamp, event);
      if (unfilteredParsed.length === 0) {
        const marketsPayload = await this.fetchPages(`/events/${encodeURIComponent(eventId)}/markets`, {}, maxPages);
        eventTrace.endpointCalls.push(pageTrace("event_markets", `/events/${eventId}/markets`, {}, marketsPayload));
        const discoveredMarkets = discoverSharpMarkets(marketsPayload.rows);
        eventTrace.discoveredMarkets = discoveredMarkets;
        const marketKeys = discoveredMarkets.length > 0 ? discoveredMarkets : SHARPAPI_SUPPORTED_MARKETS;
        for (const market of marketKeys.slice(0, 80)) {
          const marketPayload = await this.fetchPages(`/events/${encodeURIComponent(eventId)}/odds`, { market }, maxPages);
          eventTrace.endpointCalls.push(pageTrace("event_odds_market", `/events/${eventId}/odds`, { market }, marketPayload));
          rawRows.push(...marketPayload.rows);
        }
      }

      const dedupedRows = dedupeRawOddsRows(rawRows);
      const parsed = parseSharpApiProps(dedupedRows, asOfTimestamp, event);
      eventTrace.filterCounts = traceSharpApiFilters(dedupedRows, parsed);
      rows.push(...parsed);
      trace.events.push(eventTrace);
    }
    trace.outputRows = rows.length;
    trace.outputMarkets = [...new Set(rows.map((row) => row.marketKey))].sort();
    trace.outputBooks = [...new Set(rows.map((row) => row.sportsbook))].sort();
    trace.hardRockRows = rows.filter((row) => normalizeBook(row.sportsbook) === "hardrock").length;
    await writeSharpApiTrace(trace);
    return rows;
  }

  private async getJson(path: string, query: Record<string, string | number>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-API-Key": this.apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`SharpApiPropsClient ${path} failed ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async fetchEventVariants(date: string, maxPages: number): Promise<Array<SharpApiPagedRows & { label: string; path: string; query: Record<string, string> }>> {
    const variants: Array<{ label: string; path: string; query: Record<string, string> }> = [
      { label: "events_sport_mlb", path: "/events", query: { sport: "mlb" } },
      { label: "events_sport_baseball", path: "/events", query: { sport: "baseball" } },
      { label: "events_league_mlb", path: "/events", query: { league: "mlb" } },
      { label: "events_league_MLB", path: "/events", query: { league: "MLB" } },
      { label: "events_date", path: "/events", query: { date } },
      { label: "events_sport_baseball_league_mlb", path: "/events", query: { sport: "baseball", league: "mlb" } },
    ];
    const out: Array<SharpApiPagedRows & { label: string; path: string; query: Record<string, string> }> = [];
    for (const variant of variants) {
      out.push({ ...variant, ...(await this.fetchPages(variant.path, variant.query, maxPages)) });
    }
    return out;
  }

  private async fetchPages(endpointPath: string, query: Record<string, string>, maxPages: number): Promise<SharpApiPagedRows> {
    const rows: Record<string, unknown>[] = [];
    const pages: SharpApiPageTrace[] = [];
    const statuses: Record<string, number> = {};
    let cursor: string | null = null;
    for (let page = 1; page <= maxPages; page++) {
      const pageQuery = { ...query };
      if (cursor) pageQuery.cursor = cursor;
      const url = new URL(`${this.baseUrl}${endpointPath}`);
      for (const [key, value] of Object.entries(pageQuery)) url.searchParams.set(key, value);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
      });
      statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
      const text = await response.text();
      const payload = parseJson(text);
      const pageRows = rowsFromPayloadDeep(payload);
      const nextCursor = extractNextCursor(payload);
      pages.push({
        page,
        httpStatus: response.status,
        ok: response.ok,
        rows: pageRows.length,
        nextCursorSeen: Boolean(nextCursor),
      });
      if (!response.ok) break;
      rows.push(...pageRows);
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return { rows, pages, statuses };
  }
}

const SHARPAPI_MARKET_MAP: Record<string, MlbPropMarketKey> = {
  pitcher_strikeouts: "pitcher_strikeouts",
  pitching_strikeouts: "pitcher_strikeouts",
  player_strikeouts: "pitcher_strikeouts",
  player_pitching_strikeouts: "pitcher_strikeouts",
  pitcher_outs: "pitcher_outs",
  pitching_outs: "pitcher_outs",
  pitcher_outs_recorded: "pitcher_outs",
  outs_recorded: "pitcher_outs",
  player_outs: "pitcher_outs",
  player_pitching_outs: "pitcher_outs",
  pitcher_hits_allowed: "pitcher_hits_allowed",
  total_hits_allowed: "pitcher_hits_allowed",
  player_hits_allowed: "pitcher_hits_allowed",
  pitcher_earned_runs: "pitcher_earned_runs",
  player_earned_runs: "pitcher_earned_runs",
  player_walks: "batter_walks",
  player_batting_strikeouts: "batter_strikeouts",
  player_hits: "batter_hits",
  player_total_bases: "batter_total_bases",
  player_home_runs: "batter_home_runs",
  player_rbis: "batter_rbis",
  player_runs: "batter_runs_scored",
  "player_hits_+_runs_+_rbis": "batter_hits_runs_rbis",
  player_singles: "batter_singles",
  player_doubles: "batter_doubles",
  player_triples: "batter_triples",
  player_stolen_bases: "batter_stolen_bases",
};

const SHARPAPI_SUPPORTED_MARKETS = Object.keys(SHARPAPI_MARKET_MAP);

type SharpApiPageTrace = {
  page: number;
  httpStatus: number;
  ok: boolean;
  rows: number;
  nextCursorSeen: boolean;
};

type SharpApiPagedRows = {
  rows: Record<string, unknown>[];
  pages: SharpApiPageTrace[];
  statuses: Record<string, number>;
};

type SharpApiFilterCounts = {
  rawEventOddsRows: number;
  afterPaginationMerge: number;
  gameMarketRows: number;
  playerPropLikeRows: number;
  afterMarketNormalization: number;
  pitcherMarketRows: number;
  afterSportsbookNormalization: number;
  afterSideLineOddsValidation: number;
  parsedOutputRows: number;
  dropCounts: Record<string, number>;
};

type SharpApiFilterTrace = {
  provider: "sharpapi";
  date: string;
  generatedAt: string;
  maxPages: number;
  writesToSupabase: false;
  eventEndpoints: Array<{
    label: string;
    endpointPath: string;
    query: Record<string, string>;
    pagesFetched: number;
    statusCodes: Record<string, number>;
    rawRows: number;
  }>;
  eventCounts: {
    rawEventsReturned: number;
    afterDateFilter: number;
    afterLeagueSportFilter: number;
    afterUnsupportedEventFilter: number;
    afterTeamContextFilter: number;
  };
  eventsSelected: Array<{
    eventId: string;
    scheduledStart: string | null;
    etDate: string | null;
    league: string | null;
    sport: string | null;
    status: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    marketsAdvertised: string[];
  }>;
  events: Array<{
    eventId: string;
    scheduledStart: string | null;
    status: string | null;
    marketsAdvertised: string[];
    discoveredMarkets: string[];
    endpointCalls: Array<{
      label: string;
      endpointPath: string;
      query: Record<string, string>;
      pagesFetched: number;
      statusCodes: Record<string, number>;
      rowsPerPage: number[];
      totalRows: number;
      nextCursorSeen: boolean;
    }>;
    filterCounts: SharpApiFilterCounts;
  }>;
  outputRows: number;
  outputMarkets: string[];
  outputBooks: string[];
  hardRockRows: number;
};

function newSharpApiTrace(date: string, generatedAt: string, maxPages: number): SharpApiFilterTrace {
  return {
    provider: "sharpapi",
    date,
    generatedAt,
    maxPages,
    writesToSupabase: false,
    eventEndpoints: [],
    eventCounts: {
      rawEventsReturned: 0,
      afterDateFilter: 0,
      afterLeagueSportFilter: 0,
      afterUnsupportedEventFilter: 0,
      afterTeamContextFilter: 0,
    },
    eventsSelected: [],
    events: [],
    outputRows: 0,
    outputMarkets: [],
    outputBooks: [],
    hardRockRows: 0,
  };
}

function newSharpApiEventTrace(eventId: string, event: Record<string, unknown>): SharpApiFilterTrace["events"][number] {
  return {
    eventId,
    scheduledStart: eventStartTime(event),
    status: stringOrNull(event.status ?? event.state ?? event.event_status),
    marketsAdvertised: eventMarkets(event),
    discoveredMarkets: [],
    endpointCalls: [],
    filterCounts: traceSharpApiFilters([], []),
  };
}

function pageTrace(
  label: string,
  endpointPath: string,
  query: Record<string, string>,
  payload: SharpApiPagedRows,
): SharpApiFilterTrace["events"][number]["endpointCalls"][number] {
  return {
    label,
    endpointPath,
    query,
    pagesFetched: payload.pages.length,
    statusCodes: payload.statuses,
    rowsPerPage: payload.pages.map((page) => page.rows),
    totalRows: payload.rows.length,
    nextCursorSeen: payload.pages.some((page) => page.nextCursorSeen),
  };
}

async function writeSharpApiTrace(trace: SharpApiFilterTrace): Promise<void> {
  const outputDir = providerTraceDirectory();
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${trace.date}-sharpapi-filter-trace.json`), JSON.stringify(trace, null, 2));
}

export class MLBStatsAPIClient implements MlbScheduleGameProvider, MlbProbablePitcherProvider {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.ODDSPHERE_MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1") {
    this.baseUrl = baseUrl;
  }

  async getGames(args: { date: string }): Promise<MlbGameEntity[]> {
    const payload = await this.getSchedule(args.date);
    return parseMlbStatsGames(payload);
  }

  async getProbablePitchers(args: { date: string; asOfTimestamp?: string }): Promise<MlbProbablePitcher[]> {
    const payload = await this.getSchedule(args.date);
    return parseMlbStatsProbablePitchers(payload, args.asOfTimestamp ?? new Date().toISOString());
  }

  private async getSchedule(date: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/schedule`);
    url.searchParams.set("sportId", "1");
    url.searchParams.set("date", date);
    url.searchParams.set("hydrate", "probablePitcher");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MLBStatsAPIClient schedule failed ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}

export class MLBStatsGameLogClient implements MlbHistoricalStatProvider {
  async getPlayerGameLogs(args: { playerId: string; before: string; limit?: number }): Promise<MlbHistoricalStatRow[]> {
    const personId = parseMlbStatsPlayerId(args.playerId);
    const season = Number(args.before.slice(0, 4));
    if (personId === null || !Number.isInteger(season)) return [];
    const logs = await getPitcherGameLogs(personId, season, { quiet: true });
    if (logs === null) return [];
    return logs
      .filter((row) => row.is_start && row.game_date < args.before)
      .sort((a, b) => b.game_date.localeCompare(a.game_date))
      .slice(0, args.limit ?? 20)
      .map((row) => ({
        gameId: `mlbstats-game-${row.game_pk}`,
        playerId: `mlbstats-player-${row.mlb_person_id}`,
        teamId: `mlbstats-team-${row.team_id}`,
        opponentTeamId: `mlbstats-team-${row.opponent_team_id}`,
        gameDate: row.game_date,
        stats: {
          strikeouts: row.strikeouts,
          outs: row.outs,
          innings_pitched: row.innings_pitched,
          pitch_count: row.pitch_count,
          batters_faced: row.batters_faced,
          hits_allowed: row.hits_allowed,
          walks: row.walks,
          earned_runs: row.earned_runs,
          runs_allowed: row.runs_allowed,
          home_runs_allowed: row.home_runs_allowed,
          opponent_name: row.opponent_name,
          home_away: row.is_home === null ? null : row.is_home ? "home" : "away",
        },
        provider: "mlb_stats_api",
        asOfTimestamp: `${row.game_date}T23:59:59.999Z`,
      }));
  }

  async getHitterGameLogs(args: { playerId: string; before: string; limit?: number }): Promise<MlbHistoricalStatRow[]> {
    const personId = parseMlbStatsPlayerId(args.playerId);
    const season = Number(args.before.slice(0, 4));
    if (personId === null || !Number.isInteger(season)) return [];
    const logs = await fetchHitterGameLogs(personId, season, { quiet: true });
    if (logs === null) return [];
    return logs
      .filter((row) => row.game_date < args.before)
      .sort((a, b) => b.game_date.localeCompare(a.game_date))
      .slice(0, args.limit ?? 20)
      .map((row) => ({
        gameId: `mlbstats-game-${row.game_pk}`,
        playerId: `mlbstats-player-${row.mlb_person_id}`,
        teamId: `mlbstats-team-${row.team_id}`,
        opponentTeamId: `mlbstats-team-${row.opponent_team_id}`,
        gameDate: row.game_date,
        stats: {
          plate_appearances: row.plate_appearances,
          at_bats: row.at_bats,
          hits: row.hits,
          singles: row.singles,
          doubles: row.doubles,
          triples: row.triples,
          home_runs: row.home_runs,
          total_bases: row.total_bases,
          rbis: row.rbis,
          runs: row.runs,
          strikeouts: row.strikeouts,
          walks: row.walks,
          stolen_bases: row.stolen_bases,
          hits_runs_rbis: row.hits_runs_rbis,
          opponent_name: row.opponent_name,
          home_away: row.is_home === null ? null : row.is_home ? "home" : "away",
        },
        provider: "mlb_stats_api",
        asOfTimestamp: `${row.game_date}T23:59:59.999Z`,
      }));
  }
}

/** @deprecated Use MLBStatsGameLogClient. */
export class StatcastClient extends MLBStatsGameLogClient {}

function parseMlbStatsPlayerId(playerId: string): number | null {
  const match = /^(?:mlbstats-player-)?(\d+)$/.exec(playerId);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export class WeatherClient implements MlbWeatherProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = requireEnv("ODDSPHERE_WEATHER_API_KEY"), baseUrl = process.env.ODDSPHERE_WEATHER_API_BASE_URL ?? "") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getWeather(_args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]> {
    void this.apiKey;
    void this.baseUrl;
    throw new Error("WeatherClient.getWeather requires venue coordinates; use mock mode until weather mapping is configured.");
  }
}

export class MockMLBProvider implements MlbPropProviderBundle {
  constructor(private readonly fixture: MockFixture = buildDefaultMockFixture()) {}

  async getPropOdds(args: { date: string; asOfTimestamp?: string }): Promise<PropOddsSnapshot[]> {
    return this.fixture.odds.filter((row) => row.asOfTimestamp <= (args.asOfTimestamp ?? "9999-12-31"));
  }

  async getGames(args: { date: string }): Promise<MlbGameEntity[]> {
    return this.fixture.games.filter((game) => game.gameDate === args.date);
  }

  async getTeams(): Promise<MlbTeamEntity[]> {
    return this.fixture.teams;
  }

  async getPlayers(args?: { activeOnly?: boolean }): Promise<MlbPlayerEntity[]> {
    return args?.activeOnly ? this.fixture.players.filter((player) => player.active) : this.fixture.players;
  }

  async getProbablePitchers(args: { date: string; asOfTimestamp?: string }): Promise<MlbProbablePitcher[]> {
    const games = new Set((await this.getGames({ date: args.date })).map((game) => game.id));
    return this.fixture.probablePitchers.filter(
      (row) => games.has(row.gameId) && row.asOfTimestamp <= (args.asOfTimestamp ?? "9999-12-31"),
    );
  }

  async getLineups(args: { date: string; asOfTimestamp?: string }): Promise<MlbLineupSpot[]> {
    const games = new Set((await this.getGames({ date: args.date })).map((game) => game.id));
    return this.fixture.lineups.filter(
      (row) => games.has(row.gameId) && row.asOfTimestamp <= (args.asOfTimestamp ?? "9999-12-31"),
    );
  }

  async getInjuries(args: { date: string; asOfTimestamp?: string }): Promise<MlbInjury[]> {
    void args.date;
    return this.fixture.injuries.filter((row) => row.asOfTimestamp <= (args.asOfTimestamp ?? "9999-12-31"));
  }

  async getWeather(args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]> {
    const games = new Set((await this.getGames({ date: args.date })).map((game) => game.id));
    return this.fixture.weather.filter(
      (row) => games.has(row.gameId) && row.asOfTimestamp <= (args.asOfTimestamp ?? "9999-12-31"),
    );
  }

  async getPlayerGameLogs(args: { playerId: string; before: string; limit?: number }): Promise<MlbHistoricalStatRow[]> {
    return this.fixture.playerGameLogs
      .filter((row) => row.playerId === args.playerId && row.gameDate < args.before)
      .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
      .slice(0, args.limit ?? 20);
  }

  async getResults(args: { date: string }): Promise<PropSettlementResult[]> {
    const games = new Set((await this.getGames({ date: args.date })).map((game) => game.id));
    return this.fixture.results.filter((row) => games.has(row.gameId));
  }
}

export class MockOddsProvider implements PropOddsProvider {
  private readonly provider = new MockMLBProvider();

  getPropOdds(args: { date: string; asOfTimestamp?: string }): Promise<PropOddsSnapshot[]> {
    return this.provider.getPropOdds(args);
  }
}

function buildDefaultMockFixture(): MockFixture {
  const gameDate = "2026-07-07";
  const asOf = "2026-07-07T15:00:00.000Z";
  const gameId = "mock-game-1";
  const pitcherId = "mock-pitcher-1";
  const batterId = "mock-batter-1";
  const marketKey: MlbPropMarketKey = "pitcher_strikeouts";
  return {
    teams: [
      { id: "team-nym", providerIds: { mock: "NYM" }, abbreviation: "NYM", name: "New York Mets" },
      { id: "team-tor", providerIds: { mock: "TOR" }, abbreviation: "TOR", name: "Toronto Blue Jays" },
    ],
    players: [
      {
        id: pitcherId,
        providerIds: { mock: pitcherId },
        fullName: "Nolan McLean",
        normalizedName: "nolan mclean",
        teamId: "team-nym",
        throws: "R",
        primaryPosition: "P",
        active: true,
      },
      {
        id: batterId,
        providerIds: { mock: batterId },
        fullName: "Bo Bichette",
        normalizedName: "bo bichette",
        teamId: "team-tor",
        bats: "R",
        primaryPosition: "SS",
        active: true,
      },
    ],
    games: [
      {
        id: gameId,
        providerIds: { mock: gameId },
        season: 2026,
        gameDate,
        scheduledStart: "2026-07-07T23:07:00.000Z",
        homeTeamId: "team-tor",
        awayTeamId: "team-nym",
        venue: "Rogers Centre",
        roofStatus: "closed",
        gameStatus: "scheduled",
      },
    ],
    probablePitchers: [
      { gameId, teamId: "team-nym", playerId: pitcherId, status: "announced", asOfTimestamp: asOf, provider: "mock" },
    ],
    lineups: [
      { gameId, teamId: "team-tor", playerId: batterId, battingOrder: 2, position: "SS", lineupStatus: "projected", asOfTimestamp: asOf, provider: "mock" },
    ],
    injuries: [],
    weather: [
      { gameId, asOfTimestamp: asOf, temperatureF: 72, windSpeedMph: 0, windDirection: "roof_closed", humidityPct: 45, provider: "mock" },
    ],
    playerGameLogs: [
      { gameId: "hist-1", playerId: pitcherId, teamId: "team-nym", opponentTeamId: "team-tor", gameDate: "2026-07-01", stats: { strikeouts: 7, batters_faced: 24, outs: 18 }, provider: "mock" },
      { gameId: "hist-2", playerId: pitcherId, teamId: "team-nym", opponentTeamId: "team-tor", gameDate: "2026-06-25", stats: { strikeouts: 5, batters_faced: 22, outs: 16 }, provider: "mock" },
      { gameId: "future", playerId: pitcherId, teamId: "team-nym", opponentTeamId: "team-tor", gameDate: "2026-07-08", stats: { strikeouts: 14, batters_faced: 30, outs: 21 }, provider: "mock" },
    ],
    odds: [
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "over", 5.5, 125, "2026-07-07T12:00:00.000Z", "opening"),
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "under", 5.5, -145, "2026-07-07T12:00:00.000Z", "opening"),
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "over", 5.5, 115, asOf, "current"),
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "under", 5.5, -135, asOf, "current"),
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "over", 5.5, 105, "2026-07-07T22:30:00.000Z", "closing"),
      makeOdds(marketKey, gameId, pitcherId, "draftkings", "under", 5.5, -125, "2026-07-07T22:30:00.000Z", "closing"),
      makeOdds("pitcher_outs", gameId, pitcherId, "draftkings", "over", 17.5, -105, asOf, "current"),
      makeOdds("pitcher_outs", gameId, pitcherId, "draftkings", "under", 17.5, -115, asOf, "current"),
    ],
    results: [
      { marketKey, playerId: pitcherId, gameId, resultValue: 7, overWon: true, underWon: false, push: false, settlementStatus: "settled", provider: "mock" },
    ],
  };
}

function makeOdds(
  marketKey: MlbPropMarketKey,
  gameId: string,
  playerId: string,
  sportsbook: string,
  side: "over" | "under",
  line: number,
  americanOdds: number,
  asOfTimestamp: string,
  snapshotRole: PropOddsSnapshot["snapshotRole"] = "current",
): PropOddsSnapshot {
  return {
    marketKey,
    gameId,
    playerId,
    sportsbook,
    side,
    line,
    americanOdds,
    decimalOdds: american_to_decimal(americanOdds),
    impliedProbability: american_to_implied_probability(americanOdds),
    asOfTimestamp,
    snapshotRole,
    provider: "mock",
  };
}

export function parseSharpApiProps(payload: unknown, asOfTimestamp: string, eventMeta?: Record<string, unknown>): PropOddsSnapshot[] {
  const games = rowsFromPayloadDeep(payload);
  const rows: PropOddsSnapshot[] = [];
  for (const row of games) {
    if (!isPlayerPropLikeRow(row)) continue;
    const marketType = normalizeSharpMarketKey(readMarketKey(row));
    const marketKey = marketType ? SHARPAPI_MARKET_MAP[marketType] : null;
    if (!marketKey) continue;
    const sideRaw = String(readSelectionSide(row) ?? "").toLowerCase();
    const side = sideRaw.includes("under") ? "under" : sideRaw.includes("over") ? "over" : null;
    const price = readAmericanOdds(row);
    const line = readLine(row);
    const eventId = firstStringDeep(row, ["event_id", "eventId", "event", "game_id"]) ?? (eventMeta ? stringOrNull(eventMeta.id) : null);
    const playerName = readPlayerName(row) ?? playerNameFromSelection(row);
    const sportsbook = normalizeBook(readSportsbook(row) ?? "unknown");
    const timestamp = firstStringDeep(row, ["timestamp", "updated_at", "last_update", "as_of", "created_at"]) ?? asOfTimestamp;
    if (!side || !Number.isFinite(price) || !Number.isFinite(line) || !eventId || !playerName || !sportsbook) continue;
    const americanOdds = price as number;
    const propLine = line as number;
    rows.push({
      marketKey,
      gameId: `sharpapi-event-${eventId}`,
      playerId: `sharpapi-player-${normalizeName(playerName)}`,
      sportsbook,
      side,
      line: propLine,
      americanOdds,
      decimalOdds: Number.isFinite(Number(row.odds_decimal)) ? Number(row.odds_decimal) : american_to_decimal(americanOdds),
      impliedProbability: Number.isFinite(Number(row.odds_probability)) ? Number(row.odds_probability) : american_to_implied_probability(americanOdds),
      asOfTimestamp: timestamp,
      snapshotRole: row.is_stale_pregame_price === true ? "reference" : "current",
      provider: "sharpapi",
      rawPayload: {
        market_type: marketType,
        raw_market_type: readMarketKey(row),
        selection_type: sideRaw || null,
        player_name: playerName,
        stat_category: firstStringDeep(row, ["stat_category", "stat", "category", "type"]) ?? null,
        event_id: eventId,
        sharp_player_id: readPlayerId(row),
        is_main_line: firstBooleanDeep(row, ["is_main_line", "main_line", "isMainLine"]),
        is_alternate_line: firstBooleanDeep(row, ["is_alternate_line", "alternate", "isAlternateLine"]),
        event_home_team: eventMeta ? eventTeamName(eventMeta, "home") : firstStringDeep(row, ["event_home_team", "home_team"]),
        event_away_team: eventMeta ? eventTeamName(eventMeta, "away") : firstStringDeep(row, ["event_away_team", "away_team"]),
        event_start_time: eventMeta ? eventStartTime(eventMeta) : firstStringDeep(row, ["event_start_time", "start_time", "commence_time", "scheduled"]),
        event_neutral_site: eventMeta ? Boolean(eventMeta.neutral_site ?? eventMeta.neutral) : null,
      },
    });
  }
  return rows;
}

function traceSharpApiFilters(rawRows: Record<string, unknown>[], parsedRows: PropOddsSnapshot[]): SharpApiFilterCounts {
  const dropCounts: Record<string, number> = {};
  let gameMarketRows = 0;
  let playerPropLikeRows = 0;
  let afterMarketNormalization = 0;
  let pitcherMarketRows = 0;
  let afterSportsbookNormalization = 0;
  let afterSideLineOddsValidation = 0;
  for (const row of rawRows) {
    if (isLikelyGameMarketRow(row)) gameMarketRows++;
    const propLike = isPlayerPropLikeRow(row);
    if (!propLike) {
      incLocal(dropCounts, "NOT_PLAYER_PROP_SHAPE");
      continue;
    }
    playerPropLikeRows++;
    const marketType = normalizeSharpMarketKey(readMarketKey(row));
    const marketKey = marketType ? SHARPAPI_MARKET_MAP[marketType] : null;
    if (!marketKey) {
      incLocal(dropCounts, "UNMAPPED_MARKET");
      continue;
    }
    afterMarketNormalization++;
    if (marketKey.startsWith("pitcher_")) pitcherMarketRows++;
    const sportsbook = normalizeBook(readSportsbook(row) ?? "unknown");
    if (!sportsbook) {
      incLocal(dropCounts, "SPORTSBOOK_MISSING");
      continue;
    }
    afterSportsbookNormalization++;
    const sideRaw = String(readSelectionSide(row) ?? "").toLowerCase();
    const side = sideRaw.includes("under") ? "under" : sideRaw.includes("over") ? "over" : null;
    const price = readAmericanOdds(row);
    const line = readLine(row);
    const eventId = firstStringDeep(row, ["event_id", "eventId", "event", "game_id"]);
    const playerName = readPlayerName(row) ?? playerNameFromSelection(row);
    if (!side) incLocal(dropCounts, "SIDE_MISSING");
    if (!Number.isFinite(price)) incLocal(dropCounts, "PRICE_MISSING");
    if (!Number.isFinite(line)) incLocal(dropCounts, "LINE_MISSING");
    if (!eventId) incLocal(dropCounts, "EVENT_ID_MISSING");
    if (!playerName) incLocal(dropCounts, "PLAYER_NAME_MISSING");
    if (side && Number.isFinite(price) && Number.isFinite(line) && eventId && playerName) afterSideLineOddsValidation++;
  }
  return {
    rawEventOddsRows: rawRows.length,
    afterPaginationMerge: rawRows.length,
    gameMarketRows,
    playerPropLikeRows,
    afterMarketNormalization,
    pitcherMarketRows,
    afterSportsbookNormalization,
    afterSideLineOddsValidation,
    parsedOutputRows: parsedRows.length,
    dropCounts,
  };
}

function readMarketKey(row: Record<string, unknown>): string | null {
  const direct = firstString(row, ["market_type", "market_key", "marketKey", "stat_category", "stat"]);
  if (direct) return direct;
  for (const key of ["market", "market_ref", "marketRef", "category", "type"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (isRecord(raw)) {
      const nested = firstString(raw, ["key", "id", "slug", "name", "type"]);
      if (nested) return nested;
    }
  }
  return firstStringDeep(row, ["market_type", "market_key", "marketKey", "stat_category", "stat"]);
}

function normalizeSharpMarketKey(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_+]+/g, "");
  const aliases: Record<string, string> = {
    pitching_strikeouts: "player_pitching_strikeouts",
    pitcher_strikeouts: "player_pitching_strikeouts",
    strikeouts_pitching: "player_pitching_strikeouts",
    player_strikeouts: "player_strikeouts",
    total_strikeouts: "player_pitching_strikeouts",
    pitching_outs: "player_pitching_outs",
    pitcher_outs: "player_pitching_outs",
    pitcher_outs_recorded: "player_pitching_outs",
    outs_recorded: "player_pitching_outs",
    player_outs: "player_pitching_outs",
    total_outs: "player_pitching_outs",
    total_hits_allowed: "player_hits_allowed",
    pitcher_hits_allowed: "player_hits_allowed",
    pitching_hits_allowed: "player_hits_allowed",
    pitcher_earned_runs: "player_earned_runs",
    pitching_earned_runs: "player_earned_runs",
  };
  return aliases[normalized] ?? normalized;
}

function isPlayerPropLikeRow(row: Record<string, unknown>): boolean {
  if (readPlayerName(row) || readPlayerId(row)) return true;
  const marketKey = readMarketKey(row);
  const market = `${marketKey ?? ""} ${firstStringDeep(row, ["stat_category", "selection_type", "selection", "description", "name"]) ?? ""}`.toLowerCase();
  if (/player|pitcher|pitching|batter|batting|strikeout|outs_recorded|hits_allowed|earned_runs|total_bases|home_runs|rbis|stolen_bases/.test(market)) return true;
  const side = String(readSelectionSide(row) ?? "").toLowerCase();
  return !isKnownGameMarket(marketKey) && /over|under/.test(side) && Number.isFinite(readLine(row)) && Boolean(playerNameFromSelection(row));
}

function isLikelyGameMarketRow(row: Record<string, unknown>): boolean {
  const market = normalizeSharpMarketKey(readMarketKey(row)) ?? "";
  return isKnownGameMarket(market);
}

function isKnownGameMarket(value: string | null): boolean {
  const market = normalizeSharpMarketKey(value) ?? "";
  return /moneyline|spread|run_line|total_runs|team_total|binary|game|match/.test(market);
}

function playerNameFromSelection(row: Record<string, unknown>): string | null {
  const selection = firstStringDeep(row, ["selection", "selection_name", "description", "name"]);
  if (!selection) return null;
  const cleaned = selection.replace(/\b(over|under)\b.*$/i, "").replace(/\d+(\.\d+)?/g, "").trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function readSelectionSide(row: Record<string, unknown>): string | null {
  const direct = firstString(row, ["selection_type", "side", "outcome"]);
  if (direct) return direct;
  for (const key of ["selection", "outcome", "option"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (isRecord(raw)) {
      const nested = firstString(raw, ["type", "side", "name", "label", "description"]);
      if (nested) return nested;
    }
  }
  return firstStringDeep(row, ["selection_type", "side", "outcome", "label", "description"]);
}

function readAmericanOdds(row: Record<string, unknown>): number | null {
  const direct = firstNumber(row, ["odds_american", "american_odds", "american", "price", "oddsAmerican"]);
  if (direct !== null) return direct;
  for (const key of ["selection", "outcome", "price", "odds"]) {
    const raw = row[key];
    if (isRecord(raw)) {
      const nested = firstNumber(raw, ["odds_american", "american_odds", "american", "price", "odds", "oddsAmerican"]);
      if (nested !== null) return nested;
    }
  }
  return firstNumberDeep(row, ["odds_american", "american_odds", "american", "price", "oddsAmerican"]);
}

function readLine(row: Record<string, unknown>): number | null {
  const direct = firstNumber(row, ["line", "point", "handicap", "total", "value"]);
  if (direct !== null) return direct;
  for (const key of ["selection", "outcome", "line", "points"]) {
    const raw = row[key];
    if (isRecord(raw)) {
      const nested = firstNumber(raw, ["line", "point", "handicap", "total", "value"]);
      if (nested !== null) return nested;
    }
  }
  return firstNumberDeep(row, ["line", "point", "handicap", "total", "value"]);
}

function readPlayerName(row: Record<string, unknown>): string | null {
  const direct = firstString(row, ["player_name", "participant_name", "athlete_name", "competitor_name"]);
  if (direct) return direct;
  for (const key of ["player", "participant", "athlete", "competitor", "entity"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (isRecord(raw)) {
      const nested = firstString(raw, ["name", "full_name", "display_name", "label"]);
      if (nested) return nested;
    }
  }
  return null;
}

function readPlayerId(row: Record<string, unknown>): string | null {
  const direct = firstString(row, ["player_id", "participant_id", "athlete_id"]);
  if (direct) return direct;
  for (const key of ["player", "participant", "athlete", "competitor", "entity"]) {
    const raw = row[key];
    if (isRecord(raw)) {
      const nested = firstString(raw, ["id", "uuid", "key"]);
      if (nested) return nested;
    }
  }
  return null;
}

function readSportsbook(row: Record<string, unknown>): string | null {
  const direct = firstString(row, ["sportsbook", "book", "bookmaker", "sportsbook_id", "book_id"]);
  if (direct) return direct;
  for (const key of ["sportsbook", "book", "bookmaker"]) {
    const raw = row[key];
    if (isRecord(raw)) {
      const nested = firstString(raw, ["id", "key", "slug", "short_name", "display_name", "name"]);
      if (nested) return nested;
    }
  }
  return null;
}

function rowsFromPayloadDeep(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  const rows: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || rows.length > 5000) return;
    if (Array.isArray(value)) {
      if (value.some(isRecord)) rows.push(...value.filter(isRecord));
      for (const item of value.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const nested of Object.values(value)) visit(nested, depth + 1);
  };
  visit(payload);
  return dedupeRawOddsRows(rows);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractNextCursor(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const direct = stringOrNull(payload.next_cursor ?? payload.nextCursor);
  if (direct) return direct;
  if (isRecord(payload.pagination)) return stringOrNull(payload.pagination.next_cursor ?? payload.pagination.nextCursor ?? payload.pagination.cursor);
  if (isRecord(payload.meta)) return stringOrNull(payload.meta.next_cursor ?? payload.meta.nextCursor);
  return null;
}

function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = stringOrNull(row.id ?? row.event_id ?? row.eventId);
    if (!id || byId.has(id)) continue;
    byId.set(id, row);
  }
  return [...byId.values()];
}

function dedupeRawOddsRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = [
      firstStringDeep(row, ["id", "uuid"]) ?? "",
      firstStringDeep(row, ["event_id", "eventId", "event"]) ?? "",
      readMarketKey(row) ?? "",
      firstStringDeep(row, ["player_id", "participant_id", "player_name"]) ?? "",
      firstStringDeep(row, ["sportsbook", "book", "bookmaker", "sportsbook_id"]) ?? "",
      firstStringDeep(row, ["selection_type", "selection", "side", "name"]) ?? "",
      String(firstNumberDeep(row, ["line", "point", "handicap", "total", "value"]) ?? ""),
      String(firstNumberDeep(row, ["odds_american", "american_odds", "american", "price", "odds"]) ?? ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function discoverSharpMarkets(rows: Record<string, unknown>[]): string[] {
  const markets = new Set<string>();
  for (const row of rows) {
    const market = normalizeSharpMarketKey(readMarketKey(row));
    if (market) markets.add(market);
    for (const value of eventMarkets(row)) {
      const normalized = normalizeSharpMarketKey(value);
      if (normalized) markets.add(normalized);
    }
  }
  return [...markets].sort();
}

function hasEventId(event: Record<string, unknown>): boolean {
  return Boolean(stringOrNull(event.id ?? event.event_id ?? event.eventId));
}

function eventStartTime(event: Record<string, unknown>): string | null {
  return stringOrNull(event.start_time ?? event.commence_time ?? event.scheduled ?? event.event_start_time);
}

function sharpEventMatchesDate(event: Record<string, unknown>, date: string): boolean {
  const start = eventStartTime(event);
  if (!start) return String(event.date ?? event.game_date ?? "").slice(0, 10) === date;
  return start.slice(0, 10) === date || eventEtDate(event) === date;
}

function eventEtDate(event: Record<string, unknown>): string | null {
  const start = eventStartTime(event);
  if (!start) return null;
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isLikelyMlbEvent(event: Record<string, unknown>): boolean {
  const league = String(event.league ?? event.league_key ?? event.league_slug ?? "").toLowerCase();
  const sport = String(event.sport ?? event.sport_key ?? event.sport_slug ?? "").toLowerCase();
  const id = String(event.id ?? event.event_id ?? "").toLowerCase();
  if (league && /milb|minor|college/.test(league)) return false;
  if (league.includes("mlb")) return true;
  if (sport === "baseball" && id.includes("mlb")) return true;
  if (!league && !sport && id.includes("mlb")) return true;
  return false;
}

function isUnsupportedSharpEvent(event: Record<string, unknown>): boolean {
  const id = String(event.id ?? event.event_id ?? "").toLowerCase();
  const text = `${id} ${eventTeamName(event, "home") ?? ""} ${eventTeamName(event, "away") ?? ""}`.toLowerCase();
  return /price_boost|allstar|all_star|award|mvp|world_series|futures|derby|qual/.test(text);
}

function compareSharpEventsForProps(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const score = (event: Record<string, unknown>) => {
    let value = 0;
    const id = String(event.id ?? "").toLowerCase();
    const markets = eventMarkets(event);
    if (id.startsWith("mlb_")) value += 10;
    if (!id.includes("kalshi")) value += 5;
    if (!/first_?7|first seven|wins by over|kxmlbspread/.test(`${id} ${eventTeamName(event, "home") ?? ""}`.toLowerCase())) value += 5;
    if (markets.some((market) => isPlayerPropMarketName(market))) value += 4;
    if (markets.length === 0) value += 1;
    return value;
  };
  return score(b) - score(a);
}

function eventMarkets(event: Record<string, unknown>): string[] {
  const values: string[] = [];
  const raw = event.markets ?? event.market_types ?? event.available_markets;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") values.push(item);
      else if (isRecord(item)) {
        const key = stringOrNull(item.id ?? item.key ?? item.market ?? item.market_type ?? item.name);
        if (key) values.push(key);
      }
    }
  }
  return [...new Set(values.filter(Boolean))].sort();
}

function isPlayerPropMarketName(value: string): boolean {
  return /player|pitcher|pitching|batter|batting|strikeout|outs_recorded|hits_allowed|earned_runs|total_bases|home_runs|rbis|stolen_bases/i.test(value);
}

function firstStringDeep(row: Record<string, unknown>, keys: string[]): string | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  let found: string | null = null;
  const visit = (value: unknown, depth = 0) => {
    if (found || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) {
        found = stringOrNull(raw);
        if (found) return;
      }
      if (isRecord(raw) || Array.isArray(raw)) visit(raw, depth + 1);
      if (found) return;
    }
  };
  visit(row);
  return found;
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringOrNull(row[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = row[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function firstNumberDeep(row: Record<string, unknown>, keys: string[]): number | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  let found: number | null = null;
  const visit = (value: unknown, depth = 0) => {
    if (found !== null || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) {
        const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
        if (Number.isFinite(numeric)) {
          found = numeric;
          return;
        }
      }
      if (isRecord(raw) || Array.isArray(raw)) visit(raw, depth + 1);
      if (found !== null) return;
    }
  };
  visit(row);
  return found;
}

function firstBooleanDeep(row: Record<string, unknown>, keys: string[]): boolean | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  let found: boolean | null = null;
  const visit = (value: unknown, depth = 0) => {
    if (found !== null || depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) {
        if (typeof raw === "boolean") {
          found = raw;
          return;
        }
        if (typeof raw === "string" && /^(true|false)$/i.test(raw)) {
          found = raw.toLowerCase() === "true";
          return;
        }
      }
      if (isRecord(raw) || Array.isArray(raw)) visit(raw, depth + 1);
      if (found !== null) return;
    }
  };
  visit(row);
  return found;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBook(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function incLocal(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function providerTraceDirectory(): string {
  return process.env.VERCEL
    ? path.join(tmpdir(), "oddsphere", "mlb-props", "reports")
    : path.join(process.cwd(), "tmp/mlb-props/reports");
}

function eventTeamName(event: Record<string, unknown>, side: "home" | "away"): string | null {
  const direct = event[`${side}_team`] ?? event[`${side}Team`] ?? event[`${side}_team_name`];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = event[side];
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (typeof nested === "object" && nested !== null) {
    const obj = nested as Record<string, unknown>;
    const name = obj.name ?? obj.full_name ?? obj.display_name ?? obj.abbreviation;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const teams = event.teams;
  if (typeof teams === "object" && teams !== null) {
    const obj = teams as Record<string, unknown>;
    const team = obj[side];
    if (typeof team === "string" && team.trim()) return team.trim();
    if (typeof team === "object" && team !== null) {
      const teamObj = team as Record<string, unknown>;
      const name = teamObj.name ?? teamObj.full_name ?? teamObj.display_name ?? teamObj.abbreviation;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

export function parseMlbStatsGames(payload: unknown): MlbGameEntity[] {
  const dates = Array.isArray((payload as { dates?: unknown[] }).dates) ? (payload as { dates: Array<Record<string, unknown>> }).dates : [];
  return dates.flatMap((dateRow) => {
    const games = Array.isArray(dateRow.games) ? dateRow.games as Array<Record<string, unknown>> : [];
    return games.map((game) => {
      const teams = game.teams as Record<string, Record<string, unknown>> | undefined;
      const home = teams?.home?.team as Record<string, unknown> | undefined;
      const away = teams?.away?.team as Record<string, unknown> | undefined;
      return {
        id: `mlbstats-game-${String(game.gamePk ?? "")}`,
        providerIds: { mlbstats: game.gamePk as string | number | null },
        season: Number(String(game.season ?? dateRow.date ?? "").slice(0, 4)) || new Date().getUTCFullYear(),
        gameDate: String(dateRow.date ?? String(game.gameDate ?? "").slice(0, 10)),
        scheduledStart: String(game.gameDate ?? `${dateRow.date}T00:00:00.000Z`),
        homeTeamId: `mlbstats-team-${String(home?.id ?? "")}`,
        awayTeamId: `mlbstats-team-${String(away?.id ?? "")}`,
        venue: typeof (game.venue as Record<string, unknown> | undefined)?.name === "string" ? String((game.venue as Record<string, unknown>).name) : null,
        roofStatus: null,
        gameStatus: typeof (game.status as Record<string, unknown> | undefined)?.abstractGameState === "string" ? String((game.status as Record<string, unknown>).abstractGameState) : "scheduled",
      };
    });
  });
}

export function parseMlbStatsProbablePitchers(payload: unknown, asOfTimestamp: string): MlbProbablePitcher[] {
  const dates = Array.isArray((payload as { dates?: unknown[] }).dates) ? (payload as { dates: Array<Record<string, unknown>> }).dates : [];
  return dates.flatMap((dateRow) => {
    const games = Array.isArray(dateRow.games) ? dateRow.games as Array<Record<string, unknown>> : [];
    return games.flatMap((game) => {
      const teams = game.teams as Record<string, Record<string, unknown>> | undefined;
      return (["home", "away"] as const).map((side) => {
        const team = teams?.[side]?.team as Record<string, unknown> | undefined;
        const probable = teams?.[side]?.probablePitcher as Record<string, unknown> | undefined;
        return {
          gameId: `mlbstats-game-${String(game.gamePk ?? "")}`,
          teamId: `mlbstats-team-${String(team?.id ?? "")}`,
          playerId: probable?.id ? `mlbstats-player-${String(probable.id)}` : null,
          status: probable?.id ? "announced" : "unannounced",
          asOfTimestamp,
          provider: "mlbstats",
          rawPayload: teams?.[side] ?? {},
        } satisfies MlbProbablePitcher;
      });
    });
  });
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}
