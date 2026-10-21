import {
  normalizeBallDontLieNbaPlayerProps,
  normalizeTheOddsApiNbaPlayerProps,
} from "./nbaPlayerPropsProviders";
import type {
  NbaPlayerPropGameIdentity,
  NbaPlayerPropPriceObservation,
} from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE =
  "nba_player_props_live_collector_2026_10_21_r2_ist_and_identity_fallback" as const;
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

export type NbaPlayerPropsLiveCollection = Readonly<{
  release: typeof NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE;
  games: readonly NbaPlayerPropGameIdentity[];
  teamIdsByGame: Readonly<Record<string, Readonly<{ home: number; away: number }>>>;
  observations: readonly NbaPlayerPropPriceObservation[];
  providerRequests: Readonly<{ balldontlie: number; theOddsApi: number }>;
  theOddsApiCreditsUsed: number;
  theOddsApiCreditsRemaining: number | null;
  findings: readonly string[];
}>;

export async function collectNbaPlayerPropsLiveMarket(args: {
  slateDate: string;
  ballDontLieApiKey: string;
  theOddsApiKey?: string | null;
  includeOpenings: boolean;
  useTheOddsApiForGameIds?: ReadonlySet<string>;
  canonicalPlayersByName?: Readonly<Record<string, string>>;
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
  const observations: NbaPlayerPropPriceObservation[] = [];
  let bdlRequests = gameEnvelopes.length;
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
      observations.push(...normalizeBallDontLieNbaPlayerProps({
        values: data(opening.body), fetchedAt, opening: true, events: eventMap, canonicalPlayers: playerMap,
      }).rows);
    }
  }

  let theOddsApiRequests = 0;
  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  const findings: string[] = [];
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
    providerRequests: { balldontlie: bdlRequests, theOddsApi: theOddsApiRequests },
    theOddsApiCreditsUsed: creditsUsed,
    theOddsApiCreditsRemaining: creditsRemaining,
    findings,
  };
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
  return [...new Map(rows.map((row) => [[row.provider, row.providerObservationId, row.side].join("|"), row])).values()];
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
