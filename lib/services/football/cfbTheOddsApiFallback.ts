import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbForwardMarketHistoryEvidence, CfbForwardStoredEvidence } from "./cfbForwardEvidence";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "./cfbWeeklyWindow";

export const CFB_THE_ODDS_API_FALLBACK_RELEASE =
  "cfb_the_odds_api_fcs_fallback_2026_10_08_r2_multi_book_gap_fill" as const;
export const CFB_THE_ODDS_API_SPORT_KEY = "americanfootball_ncaaf_fcs" as const;
export const CFB_THE_ODDS_API_BOOKMAKERS =
  "fanduel,draftkings,rebet,betmgm,betrivers,williamhill_us,fanatics,espnbet,betonlineag,ballybet" as const;
export const CFB_THE_ODDS_API_CREDITS_PER_PULL = 3 as const;
export const CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL = 30 as const;
export const CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT = 176 as const;
export const CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT = 192 as const;
export const CFB_THE_ODDS_API_CREDIT_RESERVE = 5_000 as const;
export const CFB_THE_ODDS_API_FAR_REFRESH_MINUTES = 60 as const;
export const CFB_THE_ODDS_API_NEAR_REFRESH_MINUTES = 60 as const;
export const CFB_THE_ODDS_API_TIMEOUT_MS = 8_000 as const;
export const CFB_THE_ODDS_API_MAX_RESPONSE_BYTES = 4_000_000 as const;
export const CFB_THE_ODDS_API_R38_OPENING_SNAPSHOT_DATES = [
  "2026-10-07T12:00:00.000Z",
  "2026-10-07T18:45:00.000Z",
] as const;

type JsonRecord = Record<string, unknown>;
export type CfbTheOddsApiFallbackResult = {
  release: typeof CFB_THE_ODDS_API_FALLBACK_RELEASE;
  requests: 1;
  creditsUsed: number;
  creditsRemaining: number | null;
  attemptedGames: number;
  matchedGames: number;
  booksByGame: Record<string, NcaafBookOdds[]>;
  failuresByGame: Record<string, string>;
};

export type CfbTheOddsApiHistoricalOpeningResult = {
  release: typeof CFB_THE_ODDS_API_FALLBACK_RELEASE;
  requests: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  attemptedGames: number;
  matchedGames: number;
  booksByGame: Record<string, NcaafBookOdds[]>;
  failuresByGame: Record<string, string>;
};

/**
 * Recover the earliest real same-book quote retained by The Odds API for the
 * r38 transition slate. Dates must be ordered from oldest to newest. A later
 * snapshot is consulted only for games that did not exist at an earlier
 * snapshot (for example, a rescheduled event with a replacement provider ID).
 */
export async function fetchCfbTheOddsApiHistoricalOpenings(args: {
  games: NcaafGame[];
  apiKey: string;
  snapshotDates?: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<CfbTheOddsApiHistoricalOpeningResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .filter((game) => !game.away.fbs && !game.home.fbs);
  if (games.length === 0) throw new Error("The Odds API historical opening recovery requires at least one FCS game.");
  const snapshotDates = [...(args.snapshotDates ?? CFB_THE_ODDS_API_R38_OPENING_SNAPSHOT_DATES)]
    .map((value) => iso(value))
    .filter((value): value is string => value !== null)
    .sort((first, second) => Date.parse(first) - Date.parse(second));
  if (snapshotDates.length === 0) throw new Error("The Odds API historical opening recovery requires a valid snapshot date.");

  const booksByGame: Record<string, NcaafBookOdds[]> = {};
  const failuresByGame: Record<string, string> = {};
  let requests = 0;
  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  for (const snapshotDate of snapshotDates) {
    const remainingGames = games.filter((game) => !booksByGame[game.providerGameId]);
    if (remainingGames.length === 0) break;
    const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/${CFB_THE_ODDS_API_SPORT_KEY}/odds`);
    url.searchParams.set("apiKey", args.apiKey);
    url.searchParams.set("bookmakers", CFB_THE_ODDS_API_BOOKMAKERS);
    url.searchParams.set("markets", "h2h,spreads,totals");
    url.searchParams.set("oddsFormat", "american");
    url.searchParams.set("dateFormat", "iso");
    url.searchParams.set("date", snapshotDate.replace(".000Z", "Z"));
    const response = await (args.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(CFB_THE_ODDS_API_TIMEOUT_MS),
    });
    requests += 1;
    creditsUsed += nonnegativeInteger(response.headers.get("x-requests-last")) ?? CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL;
    creditsRemaining = nonnegativeInteger(response.headers.get("x-requests-remaining")) ?? creditsRemaining;
    if (!response.ok) throw new Error(`The Odds API historical opening recovery failed (${response.status}).`);
    const body = await boundedResponseBody(response, "historical opening recovery");
    const wrapper = record(JSON.parse(body));
    const events = array(wrapper.data).map(record)
      .filter((event) => text(event.sport_key) === CFB_THE_ODDS_API_SPORT_KEY);
    const claimedEventIds = new Set<string>();
    for (const game of remainingGames) {
      const matches = events.filter((event) => strictEventMatch(game, event));
      if (matches.length !== 1) continue;
      const event = matches[0]!;
      const eventId = text(event.id);
      if (!eventId || claimedEventIds.has(eventId)) continue;
      const books = array(event.bookmakers).map(record)
        .flatMap((book) => normalizeBook({ game, eventId, book }))
        .filter((book) => {
          const observedMs = Date.parse(book.observedAt);
          return Number.isFinite(observedMs) &&
            observedMs <= Date.parse(snapshotDate) &&
            observedMs < Date.parse(game.scheduledStart);
        });
      if (books.length === 0) continue;
      claimedEventIds.add(eventId);
      booksByGame[game.providerGameId] = books;
    }
  }
  for (const game of games) {
    if (!booksByGame[game.providerGameId]) failuresByGame[game.providerGameId] = "historical_opening_not_found";
  }
  return {
    release: CFB_THE_ODDS_API_FALLBACK_RELEASE,
    requests,
    creditsUsed,
    creditsRemaining,
    attemptedGames: games.length,
    matchedGames: Object.keys(booksByGame).length,
    booksByGame,
    failuresByGame,
  };
}

export async function fetchCfbTheOddsApiFallback(args: {
  games: NcaafGame[];
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbTheOddsApiFallbackResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .filter((game) => !game.away.fbs && !game.home.fbs && Date.parse(game.scheduledStart) > Date.parse(args.capturedAt));
  if (games.length === 0) throw new Error("The Odds API FCS fallback requires at least one upcoming FCS game.");
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${CFB_THE_ODDS_API_SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", args.apiKey);
  url.searchParams.set("bookmakers", CFB_THE_ODDS_API_BOOKMAKERS);
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  const response = await (args.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(CFB_THE_ODDS_API_TIMEOUT_MS),
  });
  const creditsUsed = nonnegativeInteger(response.headers.get("x-requests-last")) ?? CFB_THE_ODDS_API_CREDITS_PER_PULL;
  const creditsRemaining = nonnegativeInteger(response.headers.get("x-requests-remaining"));
  if (!response.ok) throw new Error(`The Odds API FCS fallback failed (${response.status}).`);
  const body = await boundedResponseBody(response, "FCS fallback");
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("The Odds API FCS fallback response must be an array.");
  const events = parsed.map(record).filter((event) => text(event.sport_key) === CFB_THE_ODDS_API_SPORT_KEY);
  const booksByGame: Record<string, NcaafBookOdds[]> = {};
  const failuresByGame: Record<string, string> = {};
  const claimedEventIds = new Set<string>();
  for (const game of games) {
    const matches = events.filter((event) => strictEventMatch(game, event));
    if (matches.length !== 1) {
      failuresByGame[game.providerGameId] = matches.length === 0 ? "strict_event_not_found" : "strict_event_ambiguous";
      continue;
    }
    const event = matches[0]!;
    const eventId = text(event.id);
    if (!eventId || claimedEventIds.has(eventId)) {
      failuresByGame[game.providerGameId] = eventId ? "event_reused" : "event_id_unavailable";
      continue;
    }
    claimedEventIds.add(eventId);
    const books = array(event.bookmakers).map(record).flatMap((book) => normalizeBook({ game, eventId, book }));
    if (books.length === 0) {
      failuresByGame[game.providerGameId] = "complete_named_book_unavailable";
      continue;
    }
    booksByGame[game.providerGameId] = books;
  }
  return {
    release: CFB_THE_ODDS_API_FALLBACK_RELEASE,
    requests: 1,
    creditsUsed,
    creditsRemaining,
    attemptedGames: games.length,
    matchedGames: Object.keys(booksByGame).length,
    booksByGame,
    failuresByGame,
  };
}

export function shouldFetchCfbTheOddsApiFallback(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  attemptHistory?: CfbForwardMarketHistoryEvidence[];
  now: string;
  forceT60?: boolean;
  forceOpeningSeed?: boolean;
}): { fetch: boolean; reason: string; cadenceMinutes: number; weeklyPulls: number; lastRemainingCredits: number | null } {
  const nowMs = Date.parse(args.now);
  const upcoming = args.games.filter((game) => Date.parse(game.scheduledStart) > nowMs);
  const weeklyWindow = activeCfbWeeklyWindow(args.now);
  const attemptRows = args.attemptHistory ?? args.existing;
  const attempts = [...new Set(attemptRows
    .flatMap((row) => (row.payload.requestBudget?.theOddsApiCurrent ?? 0) > 0
      ? [row.payload.requestBudget?.theOddsApiCurrentAttemptedAt ?? row.capturedAt]
      : [])
    .filter((attemptedAt) => isGameInCfbWeeklyWindow({ scheduledStart: attemptedAt }, weeklyWindow)))]
    .map(Date.parse)
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const remainingRows = attemptRows
    .flatMap((row) => Number.isInteger(row.payload.requestBudget?.theOddsApiRemainingCredits)
      ? [{
          capturedAt: Date.parse(
            row.payload.requestBudget?.theOddsApiCurrentAttemptedAt ??
            row.payload.requestBudget?.theOddsApiHistoricalAttemptedAt ??
            row.capturedAt,
          ),
          remaining: row.payload.requestBudget!.theOddsApiRemainingCredits!,
        }]
      : [])
    .sort((a, b) => b.capturedAt - a.capturedAt);
  const lastRemainingCredits = remainingRows[0]?.remaining ?? null;
  const nearestMs = upcoming.reduce((value, game) => Math.min(value, Date.parse(game.scheduledStart) - nowMs), Infinity);
  const cadenceMinutes = nearestMs <= 48 * 60 * 60_000
    ? CFB_THE_ODDS_API_NEAR_REFRESH_MINUTES
    : CFB_THE_ODDS_API_FAR_REFRESH_MINUTES;
  if (upcoming.length === 0) return { fetch: false, reason: "no_upcoming_fcs_gaps", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  if (attempts.length >= CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT) return { fetch: false, reason: "weekly_pull_limit", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  if (!args.forceT60 && attempts.length >= CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT) {
    return { fetch: false, reason: "ordinary_pull_limit_lock_reserve", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  }
  if (lastRemainingCredits !== null && lastRemainingCredits < CFB_THE_ODDS_API_CREDIT_RESERVE + CFB_THE_ODDS_API_CREDITS_PER_PULL) {
    return { fetch: false, reason: "credit_reserve", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  }
  const latest = attempts[0] ?? 0;
  if (args.forceOpeningSeed) {
    return { fetch: true, reason: "new_gap_opening_seed", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  }
  if (args.forceT60) {
    return { fetch: true, reason: "t60_lock_refresh", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  }
  if (latest > 0 && nowMs - latest < cadenceMinutes * 60_000) {
    return { fetch: false, reason: "cadence_not_due", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
  }
  return { fetch: true, reason: latest === 0 ? "opening_gap_seed" : "gap_refresh_due", cadenceMinutes, weeklyPulls: attempts.length, lastRemainingCredits };
}

/** Historical recovery is a one-time bridge for the r38 transition slate.
 * A verified operational opening from any provider already satisfies the
 * product requirement, and a recorded historical attempt prevents an
 * unavailable archive row from burning another 30-60 credits every cycle. */
export function shouldFetchCfbTheOddsApiHistoricalOpening(args: {
  game: NcaafGame;
  existing: CfbForwardStoredEvidence[];
  attemptHistory?: CfbForwardMarketHistoryEvidence[];
  evidenceRelease: string;
}): boolean {
  const scheduledAt = Date.parse(args.game.scheduledStart);
  const belongsToR38TransitionSlate = scheduledAt >= Date.parse("2026-10-09T00:00:00.000Z") &&
    scheduledAt < Date.parse("2026-10-12T00:00:00.000Z");
  if (!belongsToR38TransitionSlate) return false;
  const currentReleaseRows = args.existing.filter((row) =>
    row.providerGameId === args.game.providerGameId &&
    row.payload.schemaRelease === args.evidenceRelease);
  if (currentReleaseRows.some((row) => row.payload.market.operationalOpening !== null)) return false;
  const attemptRows = args.attemptHistory ?? currentReleaseRows;
  return !attemptRows.some((row) =>
    row.providerGameId === args.game.providerGameId &&
    row.payload.schemaRelease === args.evidenceRelease &&
    (row.payload.requestBudget?.theOddsApiHistorical ?? 0) > 0);
}

function normalizeBook(args: { game: NcaafGame; eventId: string; book: JsonRecord }): NcaafBookOdds[] {
  const key = text(args.book.key)?.toLowerCase() ?? "";
  const identity = THE_ODDS_API_BOOK_IDENTITIES[key];
  if (!identity) return [];
  const markets = array(args.book.markets).map(record);
  const moneyline = normalizeMoneyline(args.game, markets);
  const spread = normalizeSpread(args.game, markets);
  const total = normalizeTotal(markets);
  if (!moneyline && !spread && !total) return [];
  const marketObservedAt = Object.fromEntries((["moneyline", "spread", "total"] as const).flatMap((market) => {
    const providerKey = market === "moneyline" ? "h2h" : market === "spread" ? "spreads" : "totals";
    const timestamp = iso(markets.find((row) => text(row.key) === providerKey)?.last_update) ?? iso(args.book.last_update);
    return timestamp ? [[market, timestamp] as const] : [];
  }));
  const observedAt = Object.values(marketObservedAt).sort().at(-1) ?? null;
  if (!observedAt) return [];
  return [{
    providerGameId: args.game.providerGameId,
    sportsbook: identity.sportsbook,
    observedAt,
    provider: "theoddsapi",
    providerEventId: args.eventId,
    targetEligible: identity.targetEligible,
    marketReadingEligible: identity.marketReadingEligible,
    marketSelection: {
      ...(moneyline ? { moneyline: "main_line" as const } : {}),
      ...(spread ? { spread: "main_line" as const } : {}),
      ...(total ? { total: "main_line" as const } : {}),
    },
    marketObservedAt,
    moneyline,
    spread,
    total,
  }];
}

const THE_ODDS_API_BOOK_IDENTITIES: Readonly<Record<string, {
  sportsbook: string;
  targetEligible: boolean;
  marketReadingEligible: boolean;
}>> = {
  fanduel: { sportsbook: "fanduel", targetEligible: true, marketReadingEligible: true },
  draftkings: { sportsbook: "draftkings", targetEligible: true, marketReadingEligible: true },
  rebet: { sportsbook: "rebet", targetEligible: true, marketReadingEligible: true },
  betmgm: { sportsbook: "betmgm", targetEligible: false, marketReadingEligible: false },
  betrivers: { sportsbook: "betrivers", targetEligible: false, marketReadingEligible: false },
  williamhill_us: { sportsbook: "caesars", targetEligible: false, marketReadingEligible: false },
  fanatics: { sportsbook: "fanatics", targetEligible: false, marketReadingEligible: false },
  espnbet: { sportsbook: "thescorebet", targetEligible: false, marketReadingEligible: false },
  betonlineag: { sportsbook: "betonline", targetEligible: false, marketReadingEligible: false },
  ballybet: { sportsbook: "ballybet", targetEligible: false, marketReadingEligible: false },
};

function normalizeMoneyline(game: NcaafGame, markets: JsonRecord[]): NcaafBookOdds["moneyline"] {
  const outcomes = marketOutcomes(markets, "h2h");
  const home = uniqueTeamOutcome(outcomes, game.home.name);
  const away = uniqueTeamOutcome(outcomes, game.away.name);
  const homePrice = american(home?.price);
  const awayPrice = american(away?.price);
  return homePrice !== null && awayPrice !== null ? { homePrice, awayPrice } : null;
}

function normalizeSpread(game: NcaafGame, markets: JsonRecord[]): NcaafBookOdds["spread"] {
  const outcomes = marketOutcomes(markets, "spreads");
  const home = uniqueTeamOutcome(outcomes, game.home.name);
  const away = uniqueTeamOutcome(outcomes, game.away.name);
  const homeLine = finite(home?.point);
  const awayLine = finite(away?.point);
  const homePrice = american(home?.price);
  const awayPrice = american(away?.price);
  return homeLine !== null && awayLine !== null && Math.abs(homeLine + awayLine) < 0.001 && homePrice !== null && awayPrice !== null
    ? { homeLine, awayLine, homePrice, awayPrice }
    : null;
}

function normalizeTotal(markets: JsonRecord[]): NcaafBookOdds["total"] {
  const outcomes = marketOutcomes(markets, "totals");
  const over = uniqueNamedOutcome(outcomes, "over");
  const under = uniqueNamedOutcome(outcomes, "under");
  const overLine = finite(over?.point);
  const underLine = finite(under?.point);
  const overPrice = american(over?.price);
  const underPrice = american(under?.price);
  return overLine !== null && underLine !== null && Math.abs(overLine - underLine) < 0.001 && overPrice !== null && underPrice !== null
    ? { line: overLine, overPrice, underPrice }
    : null;
}

function marketOutcomes(markets: JsonRecord[], key: string): JsonRecord[] {
  const matches = markets.filter((market) => text(market.key) === key);
  return matches.length === 1 ? array(matches[0]!.outcomes).map(record) : [];
}

function uniqueTeamOutcome(outcomes: JsonRecord[], team: string): JsonRecord | null {
  const matches = outcomes.filter((outcome) => teamMatches(team, text(outcome.name)));
  return matches.length === 1 ? matches[0]! : null;
}

function uniqueNamedOutcome(outcomes: JsonRecord[], side: string): JsonRecord | null {
  const matches = outcomes.filter((outcome) => text(outcome.name)?.toLowerCase() === side);
  return matches.length === 1 ? matches[0]! : null;
}

function strictEventMatch(game: NcaafGame, event: JsonRecord): boolean {
  const startAt = Date.parse(text(event.commence_time) ?? "");
  return Number.isFinite(startAt) && Math.abs(startAt - Date.parse(game.scheduledStart)) <= 3 * 60 * 60_000 &&
    teamMatches(game.home.name, text(event.home_team)) && teamMatches(game.away.name, text(event.away_team));
}

const TEAM_ALIASES = new Map<string, string>([
  ["longislanduniversitysharks", "liusharks"],
  ["youngstownstatepenguins", "youngstownstpenguins"],
  ["thecitadelbulldogs", "citadelbulldogs"],
  ["southernjaguars", "southernuniversityjaguars"],
  ["gramblingtigers", "gramblingstate tigers"],
  ["williamandmarytribe", "williammarytribe"],
].map(([name, canonical]) => [normalize(name), normalize(canonical)]));

function teamMatches(first: string, second: string | null): boolean {
  if (!second) return false;
  return canonicalTeam(first) === canonicalTeam(second);
}

function canonicalTeam(value: string): string {
  const normalized = normalize(value.replace(/&/g, " and "));
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function american(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed !== 0 ? parsed : null; }
function nonnegativeInteger(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null; }
function iso(value: unknown): string | null { const parsed = Date.parse(text(value) ?? ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function normalize(value: string): string { return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, ""); }

async function boundedResponseBody(response: Response, context: string): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CFB_THE_ODDS_API_MAX_RESPONSE_BYTES) {
    throw new Error(`The Odds API ${context} response exceeds the byte ceiling.`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > CFB_THE_ODDS_API_MAX_RESPONSE_BYTES) {
    throw new Error(`The Odds API ${context} response exceeds the byte ceiling.`);
  }
  return body;
}
