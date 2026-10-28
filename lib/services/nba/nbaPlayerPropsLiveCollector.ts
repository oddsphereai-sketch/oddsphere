import {
  normalizeBallDontLieNbaPlayerProps,
  normalizeOwlsNbaPlayerProps,
  normalizeTheOddsApiNbaPlayerProps,
} from "./nbaPlayerPropsProviders";
import { OwlsInsightClient } from "../../providers/owls/owlsInsightClient";
import type {
  NbaPlayerPropGameIdentity,
  NbaPlayerPropPriceObservation,
} from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE =
  "nba_player_props_live_collector_2026_10_28_r5_owls_prices" as const;
const BDL_BASE = "https://api.balldontlie.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_SPORT = "basketball_nba";
const ODDS_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
  "player_rebounds_assists",
] as const;
const ODDS_BOOKMAKERS = "fanduel,pinnacle,bet365,betmgm,draftkings,williamhill_us";
const MAX_OWLS_EVENTS = 32;
const MAX_OWLS_BOOKS_PER_EVENT = 20;
const MAX_OWLS_PROPS_PER_BOOK = 5_000;
const MAX_OWLS_QUOTE_AGE_MS = 6 * 60 * 60_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 60_000;

export type NbaPlayerPropsLiveCollection = Readonly<{
  release: typeof NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE;
  games: readonly NbaPlayerPropGameIdentity[];
  teamIdsByGame: Readonly<Record<string, Readonly<{ home: number; away: number }>>>;
  observations: readonly NbaPlayerPropPriceObservation[];
  providerRequests: Readonly<{ balldontlie: number; theOddsApi: number; owls: number }>;
  theOddsApiCreditsUsed: number;
  theOddsApiCreditsRemaining: number | null;
  findings: readonly string[];
}>;

export async function collectNbaPlayerPropsLiveMarket(args: {
  slateDate: string;
  ballDontLieApiKey: string;
  theOddsApiKey?: string | null;
  owlsInsightApiKey?: string | null;
  includeOpenings: boolean;
  useTheOddsApiForGameIds?: ReadonlySet<string>;
  canonicalPlayersByName?: Readonly<Record<string, string>>;
  knownPlayerIdentitiesById?: Readonly<Record<string, Readonly<{ playerName: string | null; playerTeam: string | null }>>>;
  fetchImpl?: typeof fetch;
}): Promise<NbaPlayerPropsLiveCollection> {
  const fetchedAt = new Date().toISOString();
  const fetchImpl = args.fetchImpl ?? fetch;
  const gameEnvelopes = await Promise.all((["regular", "ist"] as const).map((seasonType) => requestJson({
    url: `${BDL_BASE}/v1/games?dates[]=${encodeURIComponent(args.slateDate)}&season_type=${seasonType}&per_page=100`,
    headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" }, fetchImpl,
  })));
  const rawGames = [...new Map(gameEnvelopes.flatMap((envelope) => data(envelope.body))
    .map((game) => [String(game.id), game])).values()];
  const games = rawGames.map(gameIdentity)
    .filter((game): game is NbaPlayerPropGameIdentity => game !== null);
  const teamIdsByGame = Object.fromEntries(rawGames.flatMap((game) => {
    const id = scalarId(game.id);
    const home = Number(object(game.home_team)?.id);
    const away = Number(object(game.visitor_team)?.id);
    return id && Number.isInteger(home) && Number.isInteger(away)
      ? [[`nba-bdl:${id}`, { home, away }] as const]
      : [];
  }));
  const eventMap = Object.fromEntries(games.map((game) => [game.providerGameId, {
    canonicalGameId: game.canonicalGameId,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    scheduledStart: game.scheduledStart,
  }]));
  let observations: NbaPlayerPropPriceObservation[] = [];
  let bdlRequests = gameEnvelopes.length;
  const findings: string[] = [];
  for (const game of games) {
    const current = await requestJson({
      url: `${BDL_BASE}/v2/odds/player_props?game_id=${encodeURIComponent(game.providerGameId)}`,
      headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
      fetchImpl,
    });
    bdlRequests += 1;
    const playerMap = canonicalPlayerMap(data(current.body));
    observations.push(...normalizeBallDontLieNbaPlayerProps({
      values: data(current.body), fetchedAt, events: eventMap, canonicalPlayers: playerMap,
    }).rows);
    if (args.includeOpenings) {
      const opening = await requestJson({
        url: `${BDL_BASE}/nba/v2/odds/player_props/opening?game_id=${encodeURIComponent(game.providerGameId)}`,
        headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
        fetchImpl,
      });
      bdlRequests += 1;
      const openingRows = data(opening.body);
      observations.push(...normalizeBallDontLieNbaPlayerProps({
        values: openingRows,
        fetchedAt,
        opening: true,
        events: eventMap,
        canonicalPlayers: { ...canonicalPlayerMap(openingRows), ...playerMap },
      }).rows);
    }
  }

  if (args.knownPlayerIdentitiesById) {
    observations = observations.map((row) => {
      if (row.provider !== "balldontlie" || !row.providerPlayerId) return row;
      const identity = args.knownPlayerIdentitiesById?.[row.providerPlayerId];
      return identity ? {
        ...row,
        playerName: row.playerName ?? identity.playerName,
        playerTeam: row.playerTeam ?? identity.playerTeam,
      } : row;
    });
  }
  const unresolvedPlayerIds = [...new Set(observations.flatMap((row) =>
    row.provider === "balldontlie" && row.providerPlayerId && (
      !row.playerName || !row.playerTeam || !playerTeamMatchesGame(row, teamIdsByGame)
    )
      ? [row.providerPlayerId]
      : []))];
  for (let offset = 0; offset < unresolvedPlayerIds.length; offset += 100) {
    const ids = unresolvedPlayerIds.slice(offset, offset + 100);
    const url = new URL(`${BDL_BASE}/v1/players`);
    url.searchParams.set("per_page", "100");
    for (const id of ids) url.searchParams.append("player_ids[]", id);
    try {
      const response = await requestJson({
        url: url.toString(),
        headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
        fetchImpl,
      });
      bdlRequests += 1;
      observations = applyResolvedPlayerIdentities(observations, data(response.body));
    } catch {
      findings.push(`balldontlie_player_identity_lookup_failed:${ids.length}`);
    }
  }

  let owlsRequests = 0;
  if (args.owlsInsightApiKey) {
    owlsRequests = 1;
    try {
      const response = await new OwlsInsightClient(args.owlsInsightApiKey, { fetchImpl, timeoutMs: 20_000 })
        .props<{ data?: unknown }>("nba");
      const owlsEvents = array(object(response.body)?.data);
      validateOwlsCapacity(owlsEvents);
      const canonicalGames: Record<string, string> = {};
      for (const eventValue of owlsEvents) {
        const event = object(eventValue);
        if (!event) continue;
        const eventId = scalarId(event?.gameId);
        if (!eventId) continue;
        const matches = games.filter((game) => owlsEventMatches(event, game));
        if (matches.length === 1) canonicalGames[eventId] = matches[0]!.canonicalGameId;
        else if (matches.length > 1) findings.push(`owls_event_ambiguous:${eventId}`);
      }
      const normalized = normalizeOwlsNbaPlayerProps({
        events: owlsEvents,
        fetchedAt,
        canonicalGames,
        canonicalPlayers: args.canonicalPlayersByName,
      });
      const freshRows = normalized.rows.filter((row) => {
        const observedAt = Date.parse(row.observedAt);
        const fetched = Date.parse(fetchedAt);
        return observedAt <= fetched + MAX_PROVIDER_CLOCK_SKEW_MS
          && fetched - observedAt <= MAX_OWLS_QUOTE_AGE_MS;
      });
      observations.push(...freshRows.filter((row) => row.canonicalGameId !== null));
      if (freshRows.length < normalized.rows.length) findings.push("owls_stale_or_future_prop_rows_rejected");
      if (normalized.rows.some((row) => row.canonicalGameId === null)) findings.push("owls_prop_event_identity_unmatched");
      if (Object.keys(normalized.unknownMarkets).length > 0) findings.push("owls_unknown_prop_markets_present");
      if (freshRows.length === 0) findings.push("owls_player_props_empty_for_slate");
    } catch {
      findings.push("owls_player_props_capture_failed");
    }
  } else {
    findings.push("owls_insight_api_key_missing");
  }

  // Owl is the first bounded gap-fill and sharp-reference lane. The Odds API
  // is charged only for games that still lack corroborated prop books after
  // Ball Don't Lie and Owl have both been considered.
  let theOddsApiRequests = 0;
  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  const inferredGapIds = new Set(games.filter((game) => {
    const gameRows = observations.filter((row) => row.canonicalGameId === game.canonicalGameId
      && (row.side === "over" || row.side === "under"));
    const booksByScope = new Map<string, Set<string>>();
    for (const row of gameRows) {
      const key = `${row.canonicalPlayerId ?? row.providerPlayerId}|${row.market}|${row.line}`;
      booksByScope.set(key, new Set([...(booksByScope.get(key) ?? []), row.sportsbook]));
    }
    return ![...booksByScope.values()].some((books) => books.size >= 2);
  }).map((game) => game.canonicalGameId));
  const requestedGapIds = args.useTheOddsApiForGameIds ?? inferredGapIds;
  const gapGames = games.filter((game) => requestedGapIds.has(game.canonicalGameId));
  if (gapGames.length > 0 && args.theOddsApiKey) {
    const eventsResponse = await requestJson({
      url: `${ODDS_BASE}/sports/${ODDS_SPORT}/events?apiKey=${encodeURIComponent(args.theOddsApiKey)}`,
      headers: { Accept: "application/json" }, fetchImpl,
    });
    theOddsApiRequests += 1;
    creditsUsed += headerInteger(eventsResponse.headers, "x-requests-last") ?? 0;
    creditsRemaining = headerInteger(eventsResponse.headers, "x-requests-remaining");
    const oddsEvents = array(eventsResponse.body);
    for (const game of gapGames) {
      const event = oddsEvents.map(object).find((row) => row && eventMatches(row, game));
      const eventId = text(event?.id);
      if (!eventId) { findings.push(`the_odds_api_event_unmatched:${game.canonicalGameId}`); continue; }
      const url = new URL(`${ODDS_BASE}/sports/${ODDS_SPORT}/events/${eventId}/odds`);
      url.searchParams.set("apiKey", args.theOddsApiKey);
      url.searchParams.set("markets", ODDS_MARKETS.join(","));
      url.searchParams.set("bookmakers", ODDS_BOOKMAKERS);
      url.searchParams.set("oddsFormat", "american");
      const response = await requestJson({ url: url.toString(), headers: { Accept: "application/json" }, fetchImpl });
      theOddsApiRequests += 1;
      creditsUsed += headerInteger(response.headers, "x-requests-last") ?? ODDS_MARKETS.length;
      creditsRemaining = headerInteger(response.headers, "x-requests-remaining") ?? creditsRemaining;
      observations.push(...normalizeTheOddsApiNbaPlayerProps({
        events: [response.body], fetchedAt,
        canonicalGames: { [eventId]: game.canonicalGameId },
        canonicalPlayers: {
          ...args.canonicalPlayersByName,
          ...Object.fromEntries([...canonicalNames(observations).entries()]),
        },
      }).rows);
    }
  } else if (gapGames.length > 0) findings.push("the_odds_api_gap_fetch_skipped_missing_key");

  return {
    release: NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE,
    games,
    teamIdsByGame,
    observations: dedupe(observations),
    providerRequests: { balldontlie: bdlRequests, theOddsApi: theOddsApiRequests, owls: owlsRequests },
    theOddsApiCreditsUsed: creditsUsed,
    theOddsApiCreditsRemaining: creditsRemaining,
    findings,
  };
}

function owlsEventMatches(event: Record<string, unknown>, game: NbaPlayerPropGameIdentity): boolean {
  if (canonicalTeam(text(event.homeTeam) ?? "") !== canonicalTeam(game.homeTeam)
    || canonicalTeam(text(event.awayTeam) ?? "") !== canonicalTeam(game.awayTeam)) return false;
  const eventStart = Date.parse(text(event.commenceTime) ?? "");
  const gameStart = Date.parse(game.scheduledStart);
  return Number.isFinite(eventStart) && Number.isFinite(gameStart)
    && Math.abs(eventStart - gameStart) <= 30 * 60_000;
}

function validateOwlsCapacity(events: readonly unknown[]): void {
  if (events.length > MAX_OWLS_EVENTS) throw new Error(`Owls NBA props exceeded ${MAX_OWLS_EVENTS} events.`);
  for (const eventValue of events) {
    const books = array(object(eventValue)?.books);
    if (books.length > MAX_OWLS_BOOKS_PER_EVENT) throw new Error("Owls NBA props exceeded the per-event book limit.");
    for (const bookValue of books) {
      if (array(object(bookValue)?.props).length > MAX_OWLS_PROPS_PER_BOOK) {
        throw new Error("Owls NBA props exceeded the per-book prop limit.");
      }
    }
  }
}

export function applyResolvedPlayerIdentities(
  rows: readonly NbaPlayerPropPriceObservation[],
  players: readonly Record<string, unknown>[],
): NbaPlayerPropPriceObservation[] {
  const identityById = new Map(players.flatMap((player) => {
    const playerId = scalarId(player.id);
    const teamId = scalarId(object(player.team)?.id) ?? scalarId(player.team_id);
    const playerName = [text(player.first_name), text(player.last_name)].filter(Boolean).join(" ") || null;
    return playerId && (teamId || playerName) ? [[playerId, { teamId, playerName }] as const] : [];
  }));
  return rows.map((row) => {
    if (row.provider !== "balldontlie" || !row.providerPlayerId) return row;
    const identity = identityById.get(row.providerPlayerId);
    if (!identity) return row;
    return {
      ...row,
      playerName: identity.playerName ?? row.playerName,
      playerTeam: identity.teamId ?? row.playerTeam,
    };
  });
}

function playerTeamMatchesGame(
  row: NbaPlayerPropPriceObservation,
  teamIdsByGame: Readonly<Record<string, Readonly<{ home: number; away: number }>>>,
): boolean {
  if (!row.canonicalGameId || !row.playerTeam) return false;
  const game = teamIdsByGame[row.canonicalGameId];
  const teamId = Number(row.playerTeam);
  return Boolean(game && (teamId === game.home || teamId === game.away));
}

function gameIdentity(value: Record<string, unknown>): NbaPlayerPropGameIdentity | null {
  const id = scalarId(value.id);
  const start = text(value.datetime) ?? text(value.date);
  const home = object(value.home_team);
  const away = object(value.visitor_team);
  const homeTeam = text(home?.abbreviation) ?? text(home?.full_name);
  const awayTeam = text(away?.abbreviation) ?? text(away?.full_name);
  if (!id || !start || !homeTeam || !awayTeam || !Number.isFinite(Date.parse(start))) return null;
  return {
    canonicalGameId: `nba-bdl:${id}`,
    provider: "balldontlie",
    providerGameId: id,
    scheduledStart: new Date(Date.parse(start)).toISOString(),
    homeTeam,
    awayTeam,
  };
}

function canonicalPlayerMap(rows: readonly Record<string, unknown>[]): Record<string, string> {
  const ids = rows.flatMap((row) => {
    const id = scalarId(row.player_id) ?? scalarId(object(row.player)?.id);
    return id ? [[id, `nba-bdl-player:${id}`] as const] : [];
  });
  return Object.fromEntries(ids);
}

function canonicalNames(rows: readonly NbaPlayerPropPriceObservation[]): Map<string, string> {
  return new Map(rows.flatMap((row) => row.playerName && row.canonicalPlayerId
    ? [[normalizeName(row.playerName), row.canonicalPlayerId] as const] : []));
}

function eventMatches(event: Record<string, unknown>, game: NbaPlayerPropGameIdentity): boolean {
  return canonicalTeam(text(event.home_team) ?? "") === canonicalTeam(game.homeTeam)
    && canonicalTeam(text(event.away_team) ?? "") === canonicalTeam(game.awayTeam);
}

async function requestJson(args: {
  url: string;
  headers: Record<string, string>;
  fetchImpl: typeof fetch;
}): Promise<{ body: unknown; headers: Headers }> {
  const response = await args.fetchImpl(args.url, {
    headers: args.headers,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`NBA props provider request failed with HTTP ${response.status}.`);
  try { return { body: JSON.parse(body) as unknown, headers: response.headers }; }
  catch { throw new Error("NBA props provider returned invalid JSON."); }
}

function data(value: unknown): Record<string, unknown>[] {
  const root = object(value);
  if (!Array.isArray(root?.data)) throw new Error("NBA props BALLDONTLIE response is missing data.");
  return root.data.map(object).filter((row): row is Record<string, unknown> => row !== null);
}
function dedupe(rows: readonly NbaPlayerPropPriceObservation[]): NbaPlayerPropPriceObservation[] {
  return [...new Map(rows.map((row) => [[
    row.provider, row.providerObservationId, row.side, row.observedAt, row.isOpening ? "opening" : "current",
  ].join("|"), row])).values()];
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function scalarId(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);
}
function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
const NBA_TEAM_ALIASES: Readonly<Record<string, string>> = {
  atlantahawks: "ATL", atl: "ATL", bostonceltics: "BOS", bos: "BOS", brooklynnets: "BKN", bkn: "BKN",
  charlottehornets: "CHA", cha: "CHA", chicagobulls: "CHI", chi: "CHI", clevelandcavaliers: "CLE", cle: "CLE",
  dallasmavericks: "DAL", dal: "DAL", denvernuggets: "DEN", den: "DEN", detroitpistons: "DET", det: "DET",
  goldenstatewarriors: "GSW", gsw: "GSW", houstonrockets: "HOU", hou: "HOU", indianapacers: "IND", ind: "IND",
  laclippers: "LAC", losangelesclippers: "LAC", lalakers: "LAL", losangeleslakers: "LAL", memphisgrizzlies: "MEM", mem: "MEM",
  miamiheat: "MIA", mia: "MIA", milwaukeebucks: "MIL", mil: "MIL", minnesotatimberwolves: "MIN", min: "MIN",
  neworleanspelicans: "NOP", nop: "NOP", newyorkknicks: "NYK", nyk: "NYK", oklahomacitythunder: "OKC", okc: "OKC",
  orlandomagic: "ORL", orl: "ORL", philadelphia76ers: "PHI", phi: "PHI", phoenixsuns: "PHX", phx: "PHX",
  portlandtrailblazers: "POR", por: "POR", sacramentokings: "SAC", sac: "SAC", sanantoniospurs: "SAS", sas: "SAS",
  torontoraptors: "TOR", tor: "TOR", utahjazz: "UTA", uta: "UTA", washingtonwizards: "WAS", was: "WAS",
};
function canonicalTeam(value: string): string { return NBA_TEAM_ALIASES[normalizeName(value)] ?? normalizeName(value).toUpperCase(); }
function headerInteger(headers: Headers, name: string): number | null {
  const value = Number(headers.get(name));
  return Number.isInteger(value) && value >= 0 ? value : null;
}
