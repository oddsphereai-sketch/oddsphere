import type { SupabaseClient } from "@supabase/supabase-js";
import { PlaybookClient } from "../../providers/playbook/playbookClient";
import type { PlaybookSplitGame } from "../../providers/playbook/types";
import { SharpApiClient, SharpApiNotFoundError } from "../../providers/real_api/_sharpApiClient";
import { normalizeMlbTeamName } from "../../providers/real_api/_teamNameNormalizer";
import { normalizeTeamAbbr, type NormalizerSport } from "../../providers/playbook/playbookTeamNormalizer";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import type { Sport } from "../../types/domain/Sport";
import type {
  CanonicalObservationRejection,
  MarketIntelligenceMarketType,
  MarketIntelligenceSelectionSide,
  MarketPriceObservationV2,
  MarketSplitObservationV2,
} from "../../types/domain/MarketIntelligenceV2";
import {
  buildPlaybookSplitObservationsV2,
  buildSharpApiPriceObservationV2,
  buildSharpApiSplitObservationsV2,
  type RawSharpApiSplitRowV2,
} from "./canonicalAdapters";

type GameRef = {
  id: number;
  externalId: number;
  gameDate: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeName: string;
  awayName: string;
};

type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  fetched_at: string | null;
};

type SharpSplitRowWithTeams = RawSharpApiSplitRowV2 & {
  home_team?: string | null;
  away_team?: string | null;
};

export type MarketIntelligenceV2ShadowSyncResult = {
  apply: boolean;
  sport: Sport;
  slateDate: string;
  gamesLoaded: number;
  playbookSplitRowsFetched: number;
  sharpapiSplitRowsFetched: number;
  splitObservationsBuilt: number;
  priceObservationsBuilt: number;
  splitObservationsWritten: number;
  priceObservationsWritten: number;
  rejected: CanonicalObservationRejection[];
  skippedTableMissing: boolean;
  errors: string[];
  details: Record<string, unknown>;
};

const MARKET_TYPES: readonly MarketIntelligenceMarketType[] = ["moneyline", "spread", "total"];
const SHARP_BOOKS = new Set(["pinnacle", "bookmaker", "circa"]);

function externalMarketId(game: GameRef, market: MarketIntelligenceMarketType): string {
  return `${game.externalId}:${market}`;
}

function externalSelectionKey(
  game: GameRef,
  market: MarketIntelligenceMarketType,
  side: MarketIntelligenceSelectionSide,
): string {
  return `${game.externalId}:${market}:${side}`;
}

function minutesToStart(gameDate: string | null, now: Date): number | null {
  if (!gameDate) return null;
  const t = Date.parse(gameDate);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 60000);
}

export function marketIntelligenceGameKey(
  sport: Sport | string,
  away: unknown,
  home: unknown,
): string | null {
  if (sport === "mlb") {
    const a = normalizeMlbTeamName(String(away ?? ""));
    const h = normalizeMlbTeamName(String(home ?? ""));
    return a && h ? `${a}@${h}` : null;
  }
  const a = normalizeTeamAbbr(sport as NormalizerSport, away);
  const h = normalizeTeamAbbr(sport as NormalizerSport, home);
  return a && h ? `${a}@${h}` : null;
}

function extractEventIdDate(eventId: string | number | null | undefined): string | null {
  if (eventId === null || eventId === undefined) return null;
  const m = String(eventId).replace(/_b\d+$/, "").match(/_(\d{4}-\d{2}-\d{2})$/);
  return m?.[1] ?? null;
}

function isTableMissing(message: string): boolean {
  return /relation .* does not exist|Could not find the table|schema cache/i.test(message);
}

async function loadGames(
  supabase: SupabaseClient,
  sport: Sport,
  slateDate: string,
): Promise<GameRef[]> {
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, abbreviation, name")
    .eq("sport", sport);
  if (teamsErr) throw new Error(`teams fetch failed: ${teamsErr.message}`);
  const abbr = new Map<number, string>();
  const name = new Map<number, string>();
  for (const t of teams ?? []) {
    abbr.set(t.id as number, String(t.abbreviation ?? ""));
    name.set(t.id as number, String(t.name ?? ""));
  }

  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (gamesErr) throw new Error(`games fetch failed: ${gamesErr.message}`);

  return (games ?? [])
    .filter((g) => typeof g.external_id === "number")
    .map((g) => {
      const homeTeamId = g.home_team_id as number;
      const awayTeamId = g.away_team_id as number;
      return {
        id: g.id as number,
        externalId: g.external_id as number,
        gameDate: (g.game_date as string | null) ?? null,
        homeTeamId,
        awayTeamId,
        homeAbbr: abbr.get(homeTeamId) ?? "",
        awayAbbr: abbr.get(awayTeamId) ?? "",
        homeName: name.get(homeTeamId) ?? "",
        awayName: name.get(awayTeamId) ?? "",
      };
    });
}

async function loadPriceObservations(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  games: readonly GameRef[];
  now: Date;
}): Promise<MarketPriceObservationV2[]> {
  if (opts.games.length === 0) return [];
  const gameById = new Map(opts.games.map((g) => [g.id, g]));
  const { data, error } = await opts.supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, odds_decimal, implied_probability, fetched_at")
    .in("game_id", opts.games.map((g) => g.id))
    .in("market_type", [...MARKET_TYPES])
    .is("player_id", null);
  if (error) throw new Error(`lines fetch failed: ${error.message}`);

  const out: MarketPriceObservationV2[] = [];
  for (const r of (data ?? []) as LineRow[]) {
    const game = gameById.get(r.game_id);
    if (!game) continue;
    const market = r.market_type as MarketIntelligenceMarketType;
    if (!MARKET_TYPES.includes(market)) continue;
    const side = r.side as MarketIntelligenceSelectionSide | null;
    if (side !== "home" && side !== "away" && side !== "over" && side !== "under") continue;
    out.push(buildSharpApiPriceObservationV2({
      canonicalEventId: String(game.externalId),
      canonicalMarketId: externalMarketId(game, market),
      league: opts.sport,
      sportsbook: r.sportsbook,
      sharpBook: SHARP_BOOKS.has(r.sportsbook.toLowerCase()),
      marketType: market,
      selectionKey: externalSelectionKey(game, market, side),
      line: r.line_value,
      americanPrice: r.odds_american,
      decimalPrice: r.odds_decimal,
      noVigProbability: r.implied_probability,
      providerTimestamp: r.fetched_at,
      fetchedAt: new Date().toISOString(),
      minutesToStart: minutesToStart(game.gameDate, opts.now),
    }));
  }
  return out;
}

async function collectPlaybookSplits(opts: {
  sport: Sport;
  slateDate: string;
  todayUtc: string;
  games: readonly GameRef[];
  apiKey: string | undefined;
  now: Date;
}): Promise<{
  fetchedRows: number;
  observations: MarketSplitObservationV2[];
  rejected: CanonicalObservationRejection[];
  errors: string[];
}> {
  if (!opts.apiKey) {
    return { fetchedRows: 0, observations: [], rejected: [], errors: ["PLAYBOOK_API_KEY missing; skipped Playbook v2 shadow splits"] };
  }
  const client = new PlaybookClient(opts.apiKey);
  const res = opts.slateDate === opts.todayUtc
    ? await client.splits(opts.sport)
    : await client.splitsHistory(opts.sport, opts.slateDate);
  const rows = (((res.body as { data?: unknown[] }).data) ?? []) as PlaybookSplitGame[];
  const gameByKey = new Map<string, GameRef>();
  for (const game of opts.games) {
    const key = opts.sport === "mlb"
      ? `${game.awayAbbr}@${game.homeAbbr}`
      : marketIntelligenceGameKey(opts.sport, game.awayName, game.homeName);
    if (key) gameByKey.set(key, game);
  }

  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  for (const row of rows) {
    const key = marketIntelligenceGameKey(opts.sport, row.awayTeamName, row.homeTeamName);
    const game = key ? gameByKey.get(key) : undefined;
    if (!game) {
      rejected.push({
        provider: "playbook",
        provider_event_id: row.gameId ?? null,
        market_type: null,
        selection_key: null,
        reason: `unmatched Playbook game ${row.awayTeamName ?? "?"}@${row.homeTeamName ?? "?"}`,
      });
      continue;
    }
    const built = buildPlaybookSplitObservationsV2({
      row,
      canonicalEventId: String(game.externalId),
      league: opts.sport,
      fetchedAt: opts.now.toISOString(),
      minutesToStart: minutesToStart(game.gameDate, opts.now),
      canonicalMarketId: (m) => externalMarketId(game, m),
      selectionKey: (m, s) => externalSelectionKey(game, m, s),
    });
    observations.push(...built.observations);
    rejected.push(...built.rejected);
  }
  return { fetchedRows: rows.length, observations, rejected, errors: [] };
}

async function collectSharpApiSplits(opts: {
  sport: Sport;
  slateDate: string;
  games: readonly GameRef[];
  apiKey: string | undefined;
  now: Date;
}): Promise<{
  fetchedRows: number;
  observations: MarketSplitObservationV2[];
  rejected: CanonicalObservationRejection[];
  errors: string[];
}> {
  if (opts.sport !== "mlb") {
    return { fetchedRows: 0, observations: [], rejected: [], errors: [`SharpAPI v2 source-specific splits currently MLB-only; skipped ${opts.sport}`] };
  }
  if (!opts.apiKey) {
    return { fetchedRows: 0, observations: [], rejected: [], errors: ["SHARPAPI_KEY missing; skipped SharpAPI v2 shadow splits"] };
  }
  const client = new SharpApiClient(opts.apiKey);
  let rows: SharpSplitRowWithTeams[];
  try {
    rows = await client.fetchAll<SharpSplitRowWithTeams>({
      path: "/splits",
      query: { sport: "mlb" },
      maxPages: 2,
    });
  } catch (e) {
    if (e instanceof SharpApiNotFoundError) rows = [];
    else throw e;
  }

  const gameByKey = new Map(opts.games.map((g) => [`${g.awayAbbr}@${g.homeAbbr}`, g]));
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  for (const row of rows) {
    const rowDate = extractEventIdDate(row.event_id);
    if (rowDate !== null && rowDate !== opts.slateDate) continue;
    const key = marketIntelligenceGameKey(opts.sport, row.away_team, row.home_team);
    const game = key ? gameByKey.get(key) : undefined;
    if (!game) {
      rejected.push({
        provider: "sharpapi",
        provider_event_id: row.event_id === undefined || row.event_id === null ? null : String(row.event_id),
        market_type: null,
        selection_key: null,
        reason: `unmatched SharpAPI split game ${row.away_team ?? "?"}@${row.home_team ?? "?"}`,
      });
      continue;
    }
    const built = buildSharpApiSplitObservationsV2({
      row,
      canonicalEventId: String(game.externalId),
      league: opts.sport,
      fetchedAt: opts.now.toISOString(),
      minutesToStart: minutesToStart(game.gameDate, opts.now),
      canonicalMarketId: (m) => externalMarketId(game, m),
      selectionKey: (m, s) => externalSelectionKey(game, m, s),
    });
    observations.push(...built.observations);
    rejected.push(...built.rejected);
  }
  return { fetchedRows: rows.length, observations, rejected, errors: [] };
}

async function writeRows(opts: {
  supabase: SupabaseClient;
  splitObservations: readonly MarketSplitObservationV2[];
  priceObservations: readonly MarketPriceObservationV2[];
}): Promise<{ splitWritten: number; priceWritten: number; tableMissing: boolean; errors: string[] }> {
  const errors: string[] = [];
  let tableMissing = false;
  let splitWritten = 0;
  let priceWritten = 0;

  if (opts.splitObservations.length > 0) {
    const { error } = await opts.supabase
      .from("market_split_observations_v2")
      .upsert(opts.splitObservations, {
        onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash",
        ignoreDuplicates: true,
      });
    if (error) {
      if (isTableMissing(error.message)) tableMissing = true;
      else errors.push(`split upsert: ${error.message}`);
    } else {
      splitWritten = opts.splitObservations.length;
    }
  }

  if (opts.priceObservations.length > 0) {
    const { error } = await opts.supabase
      .from("market_price_observations_v2")
      .upsert(opts.priceObservations, {
        onConflict: "canonical_market_id,sportsbook,selection_key,line,american_price,provider_timestamp",
        ignoreDuplicates: true,
      });
    if (error) {
      if (isTableMissing(error.message)) tableMissing = true;
      else errors.push(`price upsert: ${error.message}`);
    } else {
      priceWritten = opts.priceObservations.length;
    }
  }

  return { splitWritten, priceWritten, tableMissing, errors };
}

export async function syncMarketIntelligenceV2Shadow(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
  apply: boolean;
  todayUtc: string;
  now?: Date;
  playbookApiKey?: string;
  sharpApiKey?: string;
  logger?: (message: string) => void;
}): Promise<MarketIntelligenceV2ShadowSyncResult> {
  const now = opts.now ?? new Date();
  const logger = opts.logger ?? (() => {});
  const result: MarketIntelligenceV2ShadowSyncResult = {
    apply: opts.apply,
    sport: opts.sport,
    slateDate: opts.slateDate,
    gamesLoaded: 0,
    playbookSplitRowsFetched: 0,
    sharpapiSplitRowsFetched: 0,
    splitObservationsBuilt: 0,
    priceObservationsBuilt: 0,
    splitObservationsWritten: 0,
    priceObservationsWritten: 0,
    rejected: [],
    skippedTableMissing: false,
    errors: [],
    details: {},
  };

  const games = await loadGames(opts.supabase, opts.sport, opts.slateDate);
  result.gamesLoaded = games.length;
  if (games.length === 0) {
    result.details.empty_slate = true;
    return result;
  }

  const [playbook, sharpapi, prices] = await Promise.all([
    collectPlaybookSplits({
      sport: opts.sport,
      slateDate: opts.slateDate,
      todayUtc: opts.todayUtc,
      games,
      apiKey: opts.playbookApiKey ?? process.env.PLAYBOOK_API_KEY,
      now,
    }),
    collectSharpApiSplits({
      sport: opts.sport,
      slateDate: opts.slateDate,
      games,
      apiKey: opts.sharpApiKey ?? process.env.SHARPAPI_KEY,
      now,
    }),
    loadPriceObservations({ supabase: opts.supabase, sport: opts.sport, games, now }),
  ]);

  const splitObservations = [...playbook.observations, ...sharpapi.observations];
  result.playbookSplitRowsFetched = playbook.fetchedRows;
  result.sharpapiSplitRowsFetched = sharpapi.fetchedRows;
  result.splitObservationsBuilt = splitObservations.length;
  result.priceObservationsBuilt = prices.length;
  result.rejected.push(...playbook.rejected, ...sharpapi.rejected);
  result.errors.push(...playbook.errors, ...sharpapi.errors);
  result.details.providers = {
    playbook_observations: playbook.observations.length,
    sharpapi_observations: sharpapi.observations.length,
    price_observations: prices.length,
  };

  logger(
    `built split=${result.splitObservationsBuilt} price=${result.priceObservationsBuilt} rejected=${result.rejected.length}`,
  );

  if (!opts.apply) return result;
  const config = readMarketIntelligenceV2Config();
  if (!config.enabled) {
    result.errors.push("MARKET_INTELLIGENCE_V2_ENABLED must be true for v2 shadow writes");
    return result;
  }

  const write = await writeRows({
    supabase: opts.supabase,
    splitObservations,
    priceObservations: prices,
  });
  result.splitObservationsWritten = write.splitWritten;
  result.priceObservationsWritten = write.priceWritten;
  result.skippedTableMissing = write.tableMissing;
  result.errors.push(...write.errors);
  return result;
}
