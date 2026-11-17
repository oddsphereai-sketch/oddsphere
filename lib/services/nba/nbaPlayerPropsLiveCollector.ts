import {validatedNbaScheduleRecords,validatedNbaQuoteRecords,validatedNbaPlayerRecords,validatedNbaReferenceEvents,assertNbaReferenceResponse,assertNbaCurrentQuotePrices} from './nbaPlayerPropsCurrentIdentityContract';
import {resolveNbaPlayerAliases} from './nbaPlayerPropsPlayerIdentity';
import {quoteBook} from '../../playerPropsAi/executionQuotes';
import {sameNbaSourceActorName} from '../../playerPropsAi/nbaSourceIdentity';
import {canonicalNbaPropsTeam as canonicalTeam} from "./nbaPlayerPropsTeamIdentity";
import {
  normalizeBallDontLieNbaPlayerProps,
  normalizeOwlsNbaPlayerProps,
  normalizeTheOddsApiNbaPlayerProps,
} from "./nbaPlayerPropsProviders";
import { OwlsInsightClient } from "../../providers/owls/owlsInsightClient";
import { assertCompleteBdlPropsResponse, assertCompleteOwlsPropsResponse, assertNoDeclaredContinuation } from "../../providers/playerPropsResponseCompleteness";
import type {
  NbaPlayerPropGameIdentity,
  NbaPlayerPropPriceObservation,
} from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_LIVE_COLLECTOR_RELEASE =
  "nba_player_props_live_collector_2026_11_17_r9_reference_identity_receipts" as const;
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
  /** Full captured alias ownership, including ambiguity excluded from the map. */
  canonicalPlayerIdentityEntries?:readonly (readonly [string,string])[];
  knownPlayerIdentitiesById?: Readonly<Record<string, Readonly<{ playerName: string | null; playerTeam: string | null }>>>;
  fetchImpl?: typeof fetch;
}): Promise<NbaPlayerPropsLiveCollection> {
  const fetchedAt = new Date().toISOString();
  const fetchImpl = args.fetchImpl ?? fetch;
  const gameEnvelopes = await Promise.all((["regular", "ist"] as const).map((seasonType) => requestJson({
    url: `${BDL_BASE}/v1/games?dates[]=${encodeURIComponent(args.slateDate)}&season_type=${seasonType}&per_page=100`,
    headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" }, fetchImpl,
  })));
  for (const envelope of gameEnvelopes) assertNoDeclaredContinuation(envelope.body, "NBA games");
  const rawGames = [...new Map(validatedNbaScheduleRecords(gameEnvelopes.map(envelope=>envelope.body))
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
  const rawPlayerIdentityEntries:(readonly[string,string])[]=[];
  let bdlRequests = gameEnvelopes.length;
  const findings: string[] = [];
  // Invocation-local only. An identity receipt cannot refresh a quote or survive
  // into another collection as new roster authority.
  const currentProfiles = new Map<string, {player: Record<string, unknown>; availableAt: string}>();
  const attemptedIdentityIds=new Set<string>();
  for (const game of games) {
    const current = await requestJson({
      url: `${BDL_BASE}/v2/odds/player_props?game_id=${encodeURIComponent(game.providerGameId)}`,
      headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
      fetchImpl,
    });
    bdlRequests += 1;
    assertCompleteBdlPropsResponse(current.body, "NBA current player props");
    const currentCapture=validatedNbaQuoteRecords(current.body,game.providerGameId);
    rawPlayerIdentityEntries.push(...currentCapture.aliases);
    const playerMap = canonicalPlayerMap(currentCapture.rows);
    const currentReceivedAt = new Date().toISOString();
    const currentQuotes=currentCapture.rows.flatMap(value=>normalizeBallDontLieNbaPlayerProps({
      values:[value], fetchedAt, events:eventMap, canonicalPlayers:playerMap,
    }).rows).map(row=>({...row,receivedAt:currentReceivedAt}));
    assertNbaCurrentQuotePrices(currentQuotes);observations.push(...currentQuotes);
    if (args.includeOpenings) {
      const opening = await requestJson({
        url: `${BDL_BASE}/nba/v2/odds/player_props/opening?game_id=${encodeURIComponent(game.providerGameId)}`,
        headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
        fetchImpl,
      });
      bdlRequests += 1;
      assertCompleteBdlPropsResponse(opening.body, "NBA opening player props");
      const openingCapture=validatedNbaQuoteRecords(opening.body,game.providerGameId,true);
      rawPlayerIdentityEntries.push(...openingCapture.aliases);
      const openingRows=openingCapture.rows;
      const openingPlayerMap={...canonicalPlayerMap(openingRows),...playerMap};
      const openingReceivedAt = new Date().toISOString();
      observations.push(...openingRows.flatMap(value=>normalizeBallDontLieNbaPlayerProps({
        values: [value],
        fetchedAt,
        opening: true,
        events: eventMap,
        canonicalPlayers: openingPlayerMap,
      }).rows).map(row => ({ ...row, receivedAt: openingReceivedAt })));
    }
  }

  // Preserve raw quote label ownership before current-player metadata can
  // replace a display name. Both reference joins must see every captured owner.
  const capturedPlayerIdentityEntries=[...(args.canonicalPlayerIdentityEntries??[]),...rawPlayerIdentityEntries,...observations.flatMap(row=>row.playerName&&row.canonicalPlayerId?[[row.playerName,row.canonicalPlayerId] as const]:[])];
  if (args.knownPlayerIdentitiesById) {
    observations = observations.map((row) => {
      if (row.provider !== "balldontlie" || !row.providerPlayerId) return row;
      const identity = args.knownPlayerIdentitiesById?.[row.providerPlayerId];
      return identity ? {
        ...row,
        playerName: row.playerName ?? identity.playerName,
        // A last-played cache association is not current roster authority.
        // Leave a missing team for the existing bounded current-player lookup.
        playerTeam: row.playerTeam,
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
    for(const id of ids)attemptedIdentityIds.add(id);
    const url = new URL(`${BDL_BASE}/v1/players`);
    url.searchParams.set("per_page", "100");
    for (const id of ids) url.searchParams.append("player_ids[]", id);
    bdlRequests += 1;
    try {
      const response = await requestJson({
        url: url.toString(),
        headers: { Authorization: args.ballDontLieApiKey, Accept: "application/json" },
        fetchImpl,
      });
      assertNoDeclaredContinuation(response.body,"NBA current player identity");
      const identities=validatedNbaPlayerRecords(response.body,ids);
      const availableAt=new Date().toISOString();
      for(const player of identities)currentProfiles.set(String(player.id),{player,availableAt});
      observations = applyResolvedPlayerIdentities(observations, identities,availableAt);
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
      assertCompleteOwlsPropsResponse(response.body, "NBA Owls player props");
      validateOwlsCapacity(array(object(response.body)?.data));
      const owlsEvents=validatedNbaReferenceEvents(response.body,'owls');
      const owlsReceivedAt = new Date().toISOString();
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
      const canonicalPlayers=canonicalNames(observations,args.canonicalPlayersByName,capturedPlayerIdentityEntries);
      const normalizedRows:NbaPlayerPropPriceObservation[]=[],unknownMarkets=new Map<string,number>();let inputRows=0;
      for(const event of owlsEvents)for(const bookValue of array(event.books)){
        const book=object(bookValue)!;
        for(const prop of array(book.props)){
          const part=normalizeOwlsNbaPlayerProps({events:[{...event,books:[{...book,props:[prop]}]}],fetchedAt,canonicalGames,canonicalPlayers});
          normalizedRows.push(...part.rows);inputRows+=part.inputRows;
          for(const [market,count] of Object.entries(part.unknownMarkets))unknownMarkets.set(market,(unknownMarkets.get(market)??0)+count);
        }
      }
      const normalized={rows:normalizedRows,inputRows,unknownMarkets:Object.fromEntries(unknownMarkets)};
      const freshRows = normalized.rows.map(row => ({ ...row, receivedAt: owlsReceivedAt })).filter((row) => {
        const observedAt = Date.parse(row.observedAt);
        const fetched = Date.parse(fetchedAt);
        return observedAt <= fetched + MAX_PROVIDER_CLOCK_SKEW_MS
          && fetched - observedAt <= MAX_OWLS_QUOTE_AGE_MS;
      });
      assertNbaCurrentQuotePrices(freshRows);
      observations.push(...freshRows.filter((row) => row.canonicalGameId !== null));
      if (freshRows.length < normalized.rows.length) findings.push("owls_stale_or_future_prop_rows_rejected");
      if (normalized.rows.some((row) => row.canonicalGameId === null)) findings.push("owls_prop_event_identity_unmatched");
      if (Object.keys(normalized.unknownMarkets).length > 0) findings.push("owls_unknown_prop_markets_present");
      if(freshRows.length===0)findings.push(normalized.inputRows>0?"owls_no_admissible_prop_rows_for_slate":"owls_player_props_empty_for_slate");
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
      const book=quoteBook(row.sportsbook);
      if(!book)continue;
      const key = `${row.canonicalPlayerId ?? row.providerPlayerId}|${row.market}|${row.line}`;
      booksByScope.set(key, new Set([...(booksByScope.get(key) ?? []), book]));
    }
    return ![...booksByScope.values()].some((books) => books.size >= 2);
  }).map((game) => game.canonicalGameId));
  const requestedGapIds = args.useTheOddsApiForGameIds ?? inferredGapIds;
  const gapGames = games.filter((game) => requestedGapIds.has(game.canonicalGameId));
  if (gapGames.length > 0 && args.theOddsApiKey) {
    const oddsRows:NbaPlayerPropPriceObservation[]=[];
    try{
    theOddsApiRequests += 1;
    const eventsResponse = await requestJson({
      url: `${ODDS_BASE}/sports/${ODDS_SPORT}/events?apiKey=${encodeURIComponent(args.theOddsApiKey)}`,
      headers: { Accept: "application/json" }, fetchImpl,
    });
    creditsUsed += headerInteger(eventsResponse.headers, "x-requests-last") ?? 0;
    creditsRemaining = headerInteger(eventsResponse.headers, "x-requests-remaining");
    const oddsEvents=validatedNbaReferenceEvents(eventsResponse.body,'odds');
    for (const game of gapGames) {
      const matches=oddsEvents.filter(row=>eventMatches(row,game));
      const unique=new Map(matches.map(row=>[String(row.id),row]));
      if(unique.size>1)throw new Error("Ambiguous current Odds fixture");
      const event=[...unique.values()][0];
      const eventId = text(event?.id);
      if (!eventId) { findings.push(`the_odds_api_event_unmatched:${game.canonicalGameId}`); continue; }
      const url = new URL(`${ODDS_BASE}/sports/${ODDS_SPORT}/events/${eventId}/odds`);
      url.searchParams.set("apiKey", args.theOddsApiKey);
      url.searchParams.set("markets", ODDS_MARKETS.join(","));
      url.searchParams.set("bookmakers", ODDS_BOOKMAKERS);
      url.searchParams.set("oddsFormat", "american");
      theOddsApiRequests += 1;
      const response = await requestJson({ url: url.toString(), headers: { Accept: "application/json" }, fetchImpl });
      const oddsReceivedAt = new Date().toISOString();
      creditsUsed += headerInteger(response.headers, "x-requests-last") ?? ODDS_MARKETS.length;
      creditsRemaining = headerInteger(response.headers, "x-requests-remaining") ?? creditsRemaining;
      const exactResponse=assertNbaReferenceResponse(response.body,eventId,game);
      const canonicalGames={ [eventId]: game.canonicalGameId };
      const canonicalPlayers=canonicalNames(observations,args.canonicalPlayersByName,capturedPlayerIdentityEntries);
      // Preserve every outcome until the shared economic-contract census. The
      // original full-response normalizer dedupes before callers can see a
      // conflicting alias; one-outcome granules cannot erase another price.
      for(const bookValue of array(exactResponse.bookmakers)){
        const book=object(bookValue)!;
        for(const marketValue of array(book.markets)){
          const market=object(marketValue)!;
          for(const outcome of array(market.outcomes))oddsRows.push(...normalizeTheOddsApiNbaPlayerProps({
            events:[{...exactResponse,bookmakers:[{...book,markets:[{...market,outcomes:[outcome]}]}]}],
            fetchedAt,canonicalGames,canonicalPlayers,
          }).rows.map(row=>({...row,receivedAt:oddsReceivedAt})));
        }
      }
    }
    assertNbaCurrentQuotePrices(oddsRows);observations.push(...oddsRows);
    }catch{findings.push("the_odds_api_player_props_capture_failed");}
  } else if (gapGames.length > 0) findings.push("the_odds_api_gap_fetch_skipped_missing_key");

  // Reference-only actors are discovered after the primary lookup. Reuse that
  // invocation's actual responses, then complete only missing current identity
  // through the existing endpoint and 100-ID batch boundary. Never use a
  // last-played team, omit an unresolved actor or turn this into a price clock.
  const primaryIdentities=new Set(observations.filter(q=>q.provider==='balldontlie'&&!q.isOpening&&!q.isLive
    &&q.canonicalGameId&&q.canonicalPlayerId&&q.playerName&&q.playerTeam&&playerTeamMatchesGame(q,teamIdsByGame))
    .map(q=>JSON.stringify([q.canonicalGameId,q.canonicalPlayerId])));
  const referenceIds=[...new Set(observations.flatMap(row=>{
    if(row.provider==='balldontlie'||row.isOpening||row.isLive||!row.canonicalPlayerId)return[];
    const id=row.canonicalPlayerId.match(/^nba-bdl-player:(\d+)$/)?.[1];
    if(!id||row.playerTeam&&referenceTeamMatchesGame(row,teamIdsByGame,games))return[];
    return primaryIdentities.has(JSON.stringify([row.canonicalGameId,row.canonicalPlayerId]))?[]:[id];
  }))];
  const missingReferenceIds=referenceIds.filter(id=>!currentProfiles.has(id)&&!attemptedIdentityIds.has(id));
  for(let offset=0;offset<missingReferenceIds.length;offset+=100){
    const ids=missingReferenceIds.slice(offset,offset+100),url=new URL(`${BDL_BASE}/v1/players`);
    for(const id of ids)attemptedIdentityIds.add(id);
    url.searchParams.set('per_page','100');for(const id of ids)url.searchParams.append('player_ids[]',id);
    bdlRequests+=1;
    try{
      const response=await requestJson({url:url.toString(),headers:{Authorization:args.ballDontLieApiKey,Accept:'application/json'},fetchImpl});
      assertNoDeclaredContinuation(response.body,'NBA reference current player identity');
      const players=validatedNbaPlayerRecords(response.body,ids),availableAt=new Date().toISOString();
      for(const player of players)currentProfiles.set(String(player.id),{player,availableAt});
    }catch{findings.push(`balldontlie_reference_identity_lookup_failed:${ids.length}`);}
  }
  observations=applyResolvedReferenceIdentities(observations,currentProfiles,teamIdsByGame,games);

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

function referenceTeamMatchesGame(row:NbaPlayerPropPriceObservation,teams:NbaPlayerPropsLiveCollection['teamIdsByGame'],games:readonly NbaPlayerPropGameIdentity[]){
  if(playerTeamMatchesGame(row,teams))return true;
  const game=games.find(g=>g.canonicalGameId===row.canonicalGameId);
  return Boolean(game&&row.playerTeam&&[canonicalTeam(game.homeTeam),canonicalTeam(game.awayTeam)].includes(canonicalTeam(row.playerTeam)));
}

export function applyResolvedReferenceIdentities(
  rows:readonly NbaPlayerPropPriceObservation[],
  profiles:ReadonlyMap<string,{player:Record<string,unknown>;availableAt:string}>,
  teams:NbaPlayerPropsLiveCollection['teamIdsByGame'],
  games:readonly NbaPlayerPropGameIdentity[],
):NbaPlayerPropPriceObservation[]{
  const teamNames=new Map<string,string>();for(const game of games){const ids=teams[game.canonicalGameId];if(ids){teamNames.set(String(ids.home),canonicalTeam(game.homeTeam));teamNames.set(String(ids.away),canonicalTeam(game.awayTeam));}}
  return rows.map(row=>{
    if(row.provider==='balldontlie'||row.isOpening||row.isLive)return row;
    const id=row.canonicalPlayerId?.match(/^nba-bdl-player:(\d+)$/)?.[1],capture=id?profiles.get(id):undefined;
    if(!id||!capture)return row;
    const player=capture.player,teamId=scalarId(object(player.team)?.id)??scalarId(player.team_id),name=[text(player.first_name),text(player.last_name)].filter(Boolean).join(' ');
    if(!teamId||!name)return row;
    const game=games.find(game=>game.canonicalGameId===row.canonicalGameId),fixtureIds=game?teams[game.canonicalGameId]:undefined;
    if(!game||!fixtureIds)return row;
    const expectedTeam=teamNames.get(teamId)??canonicalTeam(teamId),declaredTeam=row.playerTeam?(teamNames.get(row.playerTeam)??canonicalTeam(row.playerTeam)):null;
    const conflict=!row.playerName||!sameNbaSourceActorName(row.playerName,name)||(declaredTeam!==null&&declaredTeam!==expectedTeam)
      ||![String(fixtureIds.home),String(fixtureIds.away)].includes(teamId);
    return{...row,playerName:conflict?row.playerName:name,playerTeam:conflict?'unknown':row.playerTeam??expectedTeam,
      playerIdentityAvailableAt:capture.availableAt,playerIdentityEvidence:{release:'nba_player_identity_2026_11_17_r1_current_profile',provider:'balldontlie',endpoint:'/v1/players',providerPlayerId:id,playerName:name,teamId,
        fixture:{gameId:game.canonicalGameId,homeTeamId:String(fixtureIds.home),awayTeamId:String(fixtureIds.away),homeTeam:game.homeTeam,awayTeam:game.awayTeam,start:game.scheduledStart},
        availableAt:capture.availableAt,originalPlayerName:row.playerName,originalPlayerTeam:row.playerTeam,status:conflict?'conflicting_reference':'verified'}};
  });
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
  identityAvailableAt?: string,
): NbaPlayerPropPriceObservation[] {
  const identityById=new Map<string,{teamId:string|null;playerName:string|null}|null>();
  for(const player of players){
    const playerId=scalarId(player.id),teamId=scalarId(object(player.team)?.id)??scalarId(player.team_id),playerName=[text(player.first_name),text(player.last_name)].filter(Boolean).join(' ')||null;
    if(!playerId||!(teamId||playerName))continue;
    const identity={teamId,playerName},old=identityById.get(playerId);
    identityById.set(playerId,identityById.has(playerId)&&(old===null||old?.teamId!==teamId||old?.playerName!==playerName)?null:identity);
  }
  return rows.map((row) => {
    if (row.provider !== "balldontlie" || !row.providerPlayerId) return row;
    const identity = identityById.get(row.providerPlayerId);
    if(identityById.has(row.providerPlayerId)&&identity===null)return{...row,playerTeam:null,...(identityAvailableAt?{playerIdentityAvailableAt:identityAvailableAt}:{})};
    if (!identity) return row;
    return {
      ...row,
      playerName: identity.playerName ?? row.playerName,
      playerTeam: identity.teamId ?? row.playerTeam,
      ...(identityAvailableAt?{playerIdentityAvailableAt:identityAvailableAt}:{}),
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

function canonicalNames(rows:readonly NbaPlayerPropPriceObservation[],known:Readonly<Record<string,string>>={},captured:readonly (readonly [string,string])[]=[]):Record<string,string>{
 // Union source ownership BEFORE resolving. An ambiguous current name cannot
 // fall through to a stale map or be restored by a later provider overlay.
 return resolveNbaPlayerAliases([...Object.entries(known),...captured,...rows.flatMap(row=>row.playerName&&row.canonicalPlayerId?[[row.playerName,row.canonicalPlayerId] as const]:[])]);
}

function eventMatches(event: Record<string, unknown>, game: NbaPlayerPropGameIdentity): boolean {
  return canonicalTeam(text(event.home_team) ?? "") === canonicalTeam(game.homeTeam)
    && canonicalTeam(text(event.away_team) ?? "") === canonicalTeam(game.awayTeam)
    && Math.abs(Date.parse(text(event.commence_time)??"")-Date.parse(game.scheduledStart))<=30*60000;
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

function dedupe(rows: readonly NbaPlayerPropPriceObservation[]): NbaPlayerPropPriceObservation[] {
  return [...new Map(rows.map((row) => [[
    row.provider, row.providerObservationId, row.canonicalGameId, row.canonicalPlayerId, row.sportsbook, row.market,row.offerType,row.line,row.americanPrice,row.side, row.observedAt, row.isOpening ? "opening" : "current",
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
function headerInteger(headers: Headers, name: string): number | null {
  const value = Number(headers.get(name));
  return Number.isInteger(value) && value >= 0 ? value : null;
}
