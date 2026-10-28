import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  buildNflPlayerPropsObservationSnapshot,
  type NflPlayerPropGameIdentity,
  type NflPlayerPropPhase,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsObservationSnapshot,
} from "./nflPlayerPropsContract";
import {
  normalizeBalldontlieNflPlayerProps,
  normalizeOwlsNflPlayerProps,
} from "./nflPlayerPropsProviders";

const BDL_BASE_URL = "https://api.balldontlie.io/nfl/v1";
const MAX_GAMES = 18;
const OWLS_REFERENCE_RESEARCH_BOOKS = new Set(["pinnacle", "novig"]);
const MAX_OWLS_EVENTS = 18;
const MAX_OWLS_BOOKS_PER_EVENT = 16;
const MAX_OWLS_PROPS_PER_BOOK = 1_000;
const MAX_OWLS_QUOTE_AGE_HOURS = 6;
const BDL_CONCURRENCY = 3;
const MAX_PLAYER_IDENTITIES = 768;
const MAX_PLAYER_IDENTITIES_PER_GAME = 64;
const PLAYER_IDENTITY_BATCH_SIZE = 100;

type Json = Record<string, unknown>;
type Envelope = { data?: unknown; meta?: { next_cursor?: unknown } | null };

export type NflPlayerPropsCollectionResult = {
  snapshot: NflPlayerPropsObservationSnapshot;
  /** Separate target-book-excluded evidence for explicitly qualified market readers. */
  referenceResearchObservations: readonly NflPlayerPropPriceObservation[];
  normalization: {
    balldontlie: ReturnType<typeof normalizeBalldontlieNflPlayerProps>;
    balldontlieOpenings: ReturnType<typeof normalizeBalldontlieNflPlayerProps>;
    owls: ReturnType<typeof normalizeOwlsNflPlayerProps>;
  };
};

export async function collectNflPlayerPropsObservations(args: {
  season: number;
  week: number;
  phase: NflPlayerPropPhase;
  includeOpenings?: boolean;
  ballDontLieApiKey?: string;
  owlsInsightApiKey?: string;
  includeReferenceResearch?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<NflPlayerPropsCollectionResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const bdlKey = args.ballDontLieApiKey ?? process.env.BALLDONTLIE_API_KEY;
  const owlsKey = args.owlsInsightApiKey ?? process.env.OWLS_INSIGHT_API_KEY;
  if (!bdlKey) throw new Error("BALLDONTLIE_API_KEY is required to identify the NFL props slate.");
  validateRequest(args.season, args.week, args.phase);
  const fetchedAt = new Date().toISOString();
  const providerWeek = args.phase === "preseason" ? args.week + 1 : args.week;
  const seasonType = args.phase === "preseason" ? 1 : args.phase === "regular" ? 2 : 3;
  let bdlRequests = 0;
  let owlsRequests = 0;
  const healthFindings: string[] = [
    "PLAYBOOK_CONTEXT_ONLY_NO_DOCUMENTED_PLAYER_PROP_PRICE_ENDPOINT",
  ];

  const gamesEnvelope = await bdlFetch({
    path: "/games",
    query: {
      "seasons[]": [args.season],
      "weeks[]": [providerWeek],
      "season_type[]": [seasonType],
      per_page: 100,
    },
    apiKey: bdlKey,
    fetchImpl,
  });
  bdlRequests += 1;
  if (nextCursor(gamesEnvelope) !== null) throw new Error("NFL props schedule exceeded its one-page safety budget.");
  const games = data(gamesEnvelope).map((value) => normalizeGame(value, args.phase))
    .filter((game): game is NflPlayerPropGameIdentity => game !== null)
    .sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
  if (games.length === 0) throw new Error("BALLDONTLIE returned no games for the requested NFL props slate.");
  if (games.length > MAX_GAMES) throw new Error(`NFL props slate circuit breaker opened at ${games.length} games.`);

  const currentPayloads = await inBatches(games, BDL_CONCURRENCY, async (game) => {
    const envelope = await bdlFetch({
      path: "/odds/player_props",
      query: { game_id: game.providerGameId },
      apiKey: bdlKey,
      fetchImpl,
      optionalEmpty: true,
    });
    bdlRequests += 1;
    return data(envelope);
  });
  let bdlCurrent = normalizeBalldontlieNflPlayerProps({
    values: currentPayloads.flat(),
    fetchedAt,
  });

  let bdlOpenings = normalizeBalldontlieNflPlayerProps({ values: [], fetchedAt, opening: true });
  if (args.includeOpenings === true) {
    const openingPayloads = await inBatches(games, BDL_CONCURRENCY, async (game) => {
      const envelope = await bdlFetch({
        path: "/odds/player_props/opening",
        query: { game_id: game.providerGameId },
        apiKey: bdlKey,
        fetchImpl,
        optionalEmpty: true,
      });
      bdlRequests += 1;
      return data(envelope);
    });
    bdlOpenings = normalizeBalldontlieNflPlayerProps({
      values: openingPayloads.flat(),
      fetchedAt,
      opening: true,
    });
  }

  const bdlPlayerIds = collectBoundedPlayerIdentities([...bdlCurrent.rows, ...bdlOpenings.rows]);
  const identities = new Map<string, { name: string; team: string | null }>();
  for (let index = 0; index < bdlPlayerIds.length; index += PLAYER_IDENTITY_BATCH_SIZE) {
    const playerEnvelope = await bdlFetch({
      path: "/players",
      query: { "player_ids[]": bdlPlayerIds.slice(index, index + PLAYER_IDENTITY_BATCH_SIZE), per_page: 100 },
      apiKey: bdlKey,
      fetchImpl,
    });
    bdlRequests += 1;
    for (const value of data(playerEnvelope)) {
      const identity = normalizePlayerIdentity(value);
      if (identity) identities.set(identity.id, { name: identity.name, team: identity.team });
    }
  }
  bdlCurrent = { ...bdlCurrent, rows: enrichPlayerIdentities(bdlCurrent.rows, identities) };
  bdlOpenings = { ...bdlOpenings, rows: enrichPlayerIdentities(bdlOpenings.rows, identities) };
  // BALLDONTLIE can return a next_cursor even when an explicit <=100-ID batch
  // already contains every requested identity. Completeness is the invariant;
  // the cursor alone is not a health failure for this bounded lookup.
  if (bdlPlayerIds.some((id) => !identities.has(id))) healthFindings.push("BALLDONTLIE_PLAYER_IDENTITY_INCOMPLETE");

  let owlsRaw: unknown[] = [];
  let owlsComplete = false;
  if (owlsKey) {
    owlsRequests = 1;
    try {
      const result = await new OwlsInsightClient(owlsKey, { fetchImpl, timeoutMs: 20_000 })
        .props<{ data?: unknown }>("nfl");
      owlsRaw = owlsEvents(result.body);
      validateOwlsCapacity(owlsRaw);
      owlsComplete = true;
    } catch {
      healthFindings.push("OWLS_PLAYER_PROPS_CAPTURE_FAILED");
    }
  } else {
    healthFindings.push("OWLS_INSIGHT_API_KEY_MISSING");
  }
  const owlsAll = normalizeOwlsNflPlayerProps({ values: owlsRaw, fetchedAt });
  const owlsFreshRows = owlsAll.rows.filter((row) => freshAtFetch(row.observedAt, fetchedAt));
  if (owlsFreshRows.length < owlsAll.rows.length) healthFindings.push("OWLS_STALE_OR_FUTURE_PROP_ROWS_REJECTED");
  const owlsRowsInWindow = owlsFreshRows.filter((row) => inSlateWindow(row.scheduledStart, games));
  const owlsReconciliation = reconcileProviderRowsToSlate(owlsRowsInWindow, games);
  if (owlsReconciliation.unmatchedRows > 0) healthFindings.push("OWLS_PROP_EVENT_IDENTITY_UNMATCHED");
  const owlsNormalization = {
    ...owlsAll,
    rows: owlsReconciliation.rows,
    rejectedRows: owlsAll.rejectedRows + owlsAll.rows.length - owlsRowsInWindow.length + owlsReconciliation.unmatchedRows,
  };
  const owlsReferenceRows = args.includeReferenceResearch === true
    ? owlsReconciliation.rows.filter((row) => OWLS_REFERENCE_RESEARCH_BOOKS.has(row.sportsbook))
    : [];

  if (bdlCurrent.rows.length === 0) healthFindings.push("BALLDONTLIE_PLAYER_PROPS_EMPTY");
  if (owlsKey && owlsReconciliation.rows.length === 0) healthFindings.push("OWLS_PLAYER_PROPS_EMPTY_FOR_SLATE");
  if (Object.keys(bdlCurrent.unknownMarkets).length > 0) healthFindings.push("BALLDONTLIE_UNKNOWN_PROP_MARKETS_PRESENT");
  if (Object.keys(owlsAll.unknownMarkets).length > 0) healthFindings.push("OWLS_UNKNOWN_PROP_MARKETS_PRESENT");
  if (args.includeReferenceResearch === true && owlsReferenceRows.length === 0) {
    healthFindings.push("OWLS_PROPS_REFERENCE_EMPTY");
  }

  const snapshot = buildNflPlayerPropsObservationSnapshot({
    fetchedAt,
    season: args.season,
    week: args.week,
    phase: args.phase,
    games,
    observations: [...bdlCurrent.rows, ...bdlOpenings.rows, ...owlsReconciliation.rows],
    providerRequests: {
      balldontlie: bdlRequests,
      ...(owlsKey ? { owls: owlsRequests } : {}),
    },
    providerComplete: {
      balldontlie: true,
      ...(owlsKey ? { owls: owlsComplete } : {}),
    },
    healthFindings,
  });
  return {
    snapshot,
    referenceResearchObservations: dedupeObservations(owlsReferenceRows),
    normalization: {
      balldontlie: bdlCurrent,
      balldontlieOpenings: bdlOpenings,
      owls: owlsNormalization,
    },
  };
}

function owlsEvents(value: unknown): unknown[] {
  const body = object(value);
  if (!Array.isArray(body.data)) throw new Error("Owls NFL props returned malformed data.");
  return body.data;
}

function validateOwlsCapacity(events: unknown[]): void {
  if (events.length > MAX_OWLS_EVENTS) throw new Error(`Owls NFL props exceeded ${MAX_OWLS_EVENTS} events.`);
  for (const eventValue of events) {
    const event = object(eventValue);
    const books = Array.isArray(event.books) ? event.books : [];
    if (books.length > MAX_OWLS_BOOKS_PER_EVENT) throw new Error("Owls NFL props exceeded the per-event book limit.");
    for (const bookValue of books) {
      const props = object(bookValue).props;
      if (Array.isArray(props) && props.length > MAX_OWLS_PROPS_PER_BOOK) {
        throw new Error("Owls NFL props exceeded the per-book prop limit.");
      }
    }
  }
}

function freshAtFetch(observedAt: string, fetchedAt: string): boolean {
  const observed = Date.parse(observedAt);
  const fetched = Date.parse(fetchedAt);
  const age = fetched - observed;
  return Number.isFinite(age) && age >= -60_000 && age <= MAX_OWLS_QUOTE_AGE_HOURS * 3_600_000;
}

function validateRequest(season: number, week: number, phase: NflPlayerPropPhase): void {
  if (!Number.isInteger(season) || season < 2002) throw new Error("NFL props season is invalid.");
  const maxWeek = phase === "preseason" ? 3 : phase === "regular" ? 18 : 22;
  if (!Number.isInteger(week) || week < 1 || week > maxWeek) throw new Error(`NFL ${phase} week must be 1 through ${maxWeek}.`);
}

async function bdlFetch(args: {
  path: string;
  query: Record<string, string | number | Array<string | number>>;
  apiKey: string;
  fetchImpl: typeof fetch;
  optionalEmpty?: boolean;
}): Promise<Envelope> {
  const url = new URL(`${BDL_BASE_URL}${args.path}`);
  for (const [key, value] of Object.entries(args.query)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
    else url.searchParams.set(key, String(value));
  }
  const response = await args.fetchImpl(url, {
    headers: { Authorization: args.apiKey, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (args.optionalEmpty && (response.status === 404 || response.status === 422)) return { data: [], meta: null };
  if (!response.ok) throw new Error(`BALLDONTLIE ${args.path} failed with HTTP ${response.status}.`);
  const body = await response.json() as Envelope;
  if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${args.path} returned malformed data.`);
  return body;
}

function normalizeGame(value: unknown, phase: NflPlayerPropPhase): NflPlayerPropGameIdentity | null {
  const row = object(value);
  const providerGameId = textOrNumber(row.id);
  const season = integer(row.season);
  const providerWeek = integer(row.week);
  const week = providerWeek === null ? null : phase === "preseason" ? providerWeek - 1 : providerWeek;
  const scheduledStart = iso(row.date);
  const home = object(row.home_team);
  const away = object(row.visitor_team);
  const homeTeam = text(home.abbreviation)?.toUpperCase();
  const awayTeam = text(away.abbreviation)?.toUpperCase();
  const homeTeamName = text(home.full_name) ?? homeTeam;
  const awayTeamName = text(away.full_name) ?? awayTeam;
  return !providerGameId || season === null || week === null || !scheduledStart || !homeTeam || !awayTeam || !homeTeamName || !awayTeamName
    ? null
    : { season, week, phase, providerGameId, scheduledStart, homeTeam, awayTeam, homeTeamName, awayTeamName };
}

function reconcileProviderRowsToSlate(
  rows: NflPlayerPropPriceObservation[],
  games: NflPlayerPropGameIdentity[],
): { rows: NflPlayerPropPriceObservation[]; unmatchedRows: number } {
  const matched: NflPlayerPropPriceObservation[] = [];
  let unmatchedRows = 0;
  for (const row of rows) {
    const start = row.scheduledStart ? Date.parse(row.scheduledStart) : NaN;
    const candidates = games.filter((game) => (
      Number.isFinite(start)
      && Math.abs(start - Date.parse(game.scheduledStart)) <= 15 * 60 * 1000
      && teamMatches(row.homeTeam, game.homeTeamName, game.homeTeam)
      && teamMatches(row.awayTeam, game.awayTeamName, game.awayTeam)
    ));
    if (candidates.length !== 1) {
      unmatchedRows += 1;
      continue;
    }
    matched.push({ ...row, canonicalGameId: candidates[0]!.providerGameId });
  }
  return { rows: matched, unmatchedRows };
}

function teamMatches(value: string | null, fullName: string, abbreviation: string): boolean {
  if (!value) return false;
  const normalized = normalizeTeamText(value);
  return normalized === normalizeTeamText(fullName) || normalized === normalizeTeamText(abbreviation);
}

function normalizeTeamText(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function normalizePlayerIdentity(value: unknown): { id: string; name: string; team: string | null } | null {
  const row = object(value);
  const id = textOrNumber(row.id);
  const firstName = text(row.first_name);
  const lastName = text(row.last_name);
  const name = [firstName, lastName].filter((part): part is string => part !== null).join(" ");
  const team = text(object(row.team).abbreviation)?.toUpperCase() ?? null;
  return id && name ? { id, name, team } : null;
}

function enrichPlayerIdentities(
  rows: NflPlayerPropPriceObservation[],
  identities: ReadonlyMap<string, { name: string; team: string | null }>,
): NflPlayerPropPriceObservation[] {
  return rows.map((row) => {
    const identity = row.providerPlayerId ? identities.get(row.providerPlayerId) : null;
    return identity ? { ...row, playerName: identity.name, playerTeam: identity.team } : row;
  });
}

function inSlateWindow(value: string | null, games: NflPlayerPropGameIdentity[]): boolean {
  if (!value || games.length === 0) return false;
  const time = Date.parse(value);
  const starts = games.map((game) => Date.parse(game.scheduledStart));
  return Number.isFinite(time) && time >= Math.min(...starts) - 6 * 60 * 60 * 1000 && time <= Math.max(...starts) + 6 * 60 * 60 * 1000;
}

async function inBatches<T, R>(values: T[], size: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(...await Promise.all(values.slice(index, index + size).map(task)));
  }
  return output;
}

function data(envelope: Envelope): unknown[] {
  return Array.isArray(envelope.data) ? envelope.data : [];
}

function nextCursor(envelope: Envelope): string | null {
  const value = envelope.meta?.next_cursor;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function collectBoundedPlayerIdentities(
  rows: ReadonlyArray<Pick<NflPlayerPropPriceObservation, "providerEventId" | "providerPlayerId">>,
): string[] {
  const playerIds = new Set<string>();
  const playerIdsByGame = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.providerPlayerId === null) continue;
    playerIds.add(row.providerPlayerId);
    const gameIds = playerIdsByGame.get(row.providerEventId) ?? new Set<string>();
    gameIds.add(row.providerPlayerId);
    playerIdsByGame.set(row.providerEventId, gameIds);
  }
  for (const [gameId, gameIds] of playerIdsByGame) {
    if (gameIds.size > MAX_PLAYER_IDENTITIES_PER_GAME) {
      throw new Error(
        `NFL props player-identity circuit breaker opened for game ${gameId} at ${gameIds.size} players.`,
      );
    }
  }
  if (playerIds.size > MAX_PLAYER_IDENTITIES) {
    throw new Error(`NFL props player-identity circuit breaker opened at ${playerIds.size} players.`);
  }
  return [...playerIds];
}

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textOrNumber(value: unknown): string | null {
  return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export const NFL_PLAYER_PROPS_COLLECTION_LIMITS = {
  maxGames: MAX_GAMES,
  maxOwlsEvents: MAX_OWLS_EVENTS,
  maxOwlsBooksPerEvent: MAX_OWLS_BOOKS_PER_EVENT,
  maxOwlsPropsPerBook: MAX_OWLS_PROPS_PER_BOOK,
  maxOwlsQuoteAgeHours: MAX_OWLS_QUOTE_AGE_HOURS,
  owlsReferenceResearchBooks: [...OWLS_REFERENCE_RESEARCH_BOOKS],
  bdlConcurrency: BDL_CONCURRENCY,
  maxPlayerIdentities: MAX_PLAYER_IDENTITIES,
  maxPlayerIdentitiesPerGame: MAX_PLAYER_IDENTITIES_PER_GAME,
  playerIdentityBatchSize: PLAYER_IDENTITY_BATCH_SIZE,
} as const;

export const __NFL_PLAYER_PROPS_COLLECTOR_TEST__ = {
  inSlateWindow,
  normalizeGame,
  validateRequest,
  enrichPlayerIdentities,
  normalizePlayerIdentity,
  reconcileProviderRowsToSlate,
  collectBoundedPlayerIdentities,
  dedupeObservations,
  owlsEvents,
  validateOwlsCapacity,
  freshAtFetch,
};

function dedupeObservations(rows: readonly NflPlayerPropPriceObservation[]): NflPlayerPropPriceObservation[] {
  const unique = new Map<string, NflPlayerPropPriceObservation>();
  for (const row of rows) {
    const key = [row.provider, row.providerObservationId, row.side, row.line].join("|");
    const previous = unique.get(key);
    if (!previous || Date.parse(row.fetchedAt) > Date.parse(previous.fetchedAt)) unique.set(key, row);
  }
  return [...unique.values()];
}
