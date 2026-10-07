import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import { espnCfbTeamId } from "./cfbEspnReferenceLine";

export const CFB_ESPN_CURRENT_ODDS_RELEASE =
  "cfb_espn_current_odds_2026_10_07_r1_strict_draftkings_fbs_fallback" as const;
export const CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN = 32 as const;
export const CFB_ESPN_CURRENT_ODDS_MAX_DATES_PER_RUN = 7 as const;
export const CFB_ESPN_CURRENT_ODDS_TIMEOUT_MS = 6_000 as const;

type JsonRecord = Record<string, unknown>;

export type CfbEspnCurrentOddsResult = {
  release: typeof CFB_ESPN_CURRENT_ODDS_RELEASE;
  requests: number;
  attemptedGames: number;
  matchedGames: number;
  booksByGame: Record<string, NcaafBookOdds[]>;
  failuresByGame: Record<string, string>;
};

export async function fetchCfbEspnCurrentOdds(args: {
  games: NcaafGame[];
  capturedAt: string;
  fetchImpl?: typeof fetch;
  maximumGames?: number;
}): Promise<CfbEspnCurrentOddsResult> {
  const capturedAt = new Date(args.capturedAt).toISOString();
  const maximumGames = args.maximumGames ?? CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN;
  if (!Number.isInteger(maximumGames) || maximumGames < 0 || maximumGames > CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN) {
    throw new Error(`CFB ESPN current-odds maximum must be between 0 and ${CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN}.`);
  }
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .filter((game) => game.away.fbs || game.home.fbs)
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.providerGameId.localeCompare(second.providerGameId))
    .slice(0, maximumGames);
  if (games.length === 0) return emptyResult();

  const dates = [...new Set(games.flatMap(scoreboardDates))].sort();
  if (dates.length > CFB_ESPN_CURRENT_ODDS_MAX_DATES_PER_RUN) {
    throw new Error(`CFB ESPN current-odds collection exceeds its ${CFB_ESPN_CURRENT_ODDS_MAX_DATES_PER_RUN}-date bound.`);
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const payloads = await Promise.all(dates.map((date) => fetchJson(
    fetchImpl,
    `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&limit=400&groups=80`,
  )));
  const eventEntries = payloads.flatMap((payload) => array(payload.events)).flatMap((value) => {
    const event = record(value);
    const id = text(event.id);
    return id ? [[id, event] as const] : [];
  });
  const events = [...new Map(eventEntries).values()];
  const failuresByGame: Record<string, string> = {};
  const booksByGame: Record<string, NcaafBookOdds[]> = {};
  for (const game of games) {
    const matches = events.filter((event) => strictEventMatch(game, event));
    if (matches.length !== 1) {
      failuresByGame[game.providerGameId] = matches.length === 0 ? "strict_event_not_found" : "strict_event_ambiguous";
      continue;
    }
    const book = normalizeCfbEspnCurrentOdds(matches[0]!, game.providerGameId, capturedAt);
    if (!book) {
      failuresByGame[game.providerGameId] = "complete_current_draftkings_quote_unavailable";
      continue;
    }
    booksByGame[game.providerGameId] = [book];
  }
  return {
    release: CFB_ESPN_CURRENT_ODDS_RELEASE,
    requests: dates.length,
    attemptedGames: games.length,
    matchedGames: Object.keys(booksByGame).length,
    booksByGame,
    failuresByGame,
  };
}

export function normalizeCfbEspnCurrentOdds(
  event: JsonRecord,
  providerGameId: string,
  capturedAt: string,
): NcaafBookOdds | null {
  const competition = record(array(event.competitions)[0]);
  const odds = array(competition.odds).map(record).find((row) => normalize(text(record(row.provider).name) ?? "") === "draftkings");
  if (!odds) return null;
  const moneyline = record(odds.moneyline);
  const pointSpread = record(odds.pointSpread);
  const total = record(odds.total);
  const awayMoneyline = american(record(record(moneyline.away).close).odds);
  const homeMoneyline = american(record(record(moneyline.home).close).odds);
  const awaySpread = line(record(record(pointSpread.away).close).line, false);
  const homeSpread = line(record(record(pointSpread.home).close).line, false);
  const awaySpreadPrice = american(record(record(pointSpread.away).close).odds);
  const homeSpreadPrice = american(record(record(pointSpread.home).close).odds);
  const overLine = line(record(record(total.over).close).line, true);
  const underLine = line(record(record(total.under).close).line, true);
  const overPrice = american(record(record(total.over).close).odds);
  const underPrice = american(record(record(total.under).close).odds);
  const coherentMoneyline = awayMoneyline !== null && homeMoneyline !== null
    ? { awayPrice: awayMoneyline, homePrice: homeMoneyline }
    : null;
  const coherentSpread = awaySpread !== null && homeSpread !== null && awaySpreadPrice !== null && homeSpreadPrice !== null && Math.abs(awaySpread + homeSpread) < 1e-9
    ? { awayLine: awaySpread, awayPrice: awaySpreadPrice, homeLine: homeSpread, homePrice: homeSpreadPrice }
    : null;
  const coherentTotal = overLine !== null && underLine !== null && overPrice !== null && underPrice !== null && Math.abs(overLine - underLine) < 1e-9
    ? { line: overLine, overPrice, underPrice }
    : null;
  if (!coherentMoneyline && !coherentSpread && !coherentTotal) return null;
  const observedAt = new Date(capturedAt).toISOString();
  const eventId = text(event.id);
  if (!eventId) return null;
  const marketSelection: NcaafBookOdds["marketSelection"] = {
    ...(coherentMoneyline ? { moneyline: "main_line" as const } : {}),
    ...(coherentSpread ? { spread: "main_line" as const } : {}),
    ...(coherentTotal ? { total: "main_line" as const } : {}),
  };
  const marketObservedAt: NcaafBookOdds["marketObservedAt"] = {
    ...(coherentMoneyline ? { moneyline: observedAt } : {}),
    ...(coherentSpread ? { spread: observedAt } : {}),
    ...(coherentTotal ? { total: observedAt } : {}),
  };
  const marketQuotes: NonNullable<NcaafBookOdds["marketQuotes"]> = [];
  if (coherentMoneyline) marketQuotes.push(
    { market: "moneyline", side: "away", line: null, price: coherentMoneyline.awayPrice, observedAt, marketSelection: "main_line" },
    { market: "moneyline", side: "home", line: null, price: coherentMoneyline.homePrice, observedAt, marketSelection: "main_line" },
  );
  if (coherentSpread) marketQuotes.push(
    { market: "spread", side: "away", line: coherentSpread.awayLine, price: coherentSpread.awayPrice, observedAt, marketSelection: "main_line" },
    { market: "spread", side: "home", line: coherentSpread.homeLine, price: coherentSpread.homePrice, observedAt, marketSelection: "main_line" },
  );
  if (coherentTotal) marketQuotes.push(
    { market: "total", side: "over", line: coherentTotal.line, price: coherentTotal.overPrice, observedAt, marketSelection: "main_line" },
    { market: "total", side: "under", line: coherentTotal.line, price: coherentTotal.underPrice, observedAt, marketSelection: "main_line" },
  );
  return {
    providerGameId,
    sportsbook: "DraftKings",
    observedAt,
    provider: "espn",
    providerEventId: eventId,
    targetEligible: true,
    marketSelection,
    marketObservedAt,
    marketQuotes,
    moneyline: coherentMoneyline,
    spread: coherentSpread,
    total: coherentTotal,
  };
}

function strictEventMatch(game: NcaafGame, event: JsonRecord): boolean {
  const competitors = array(record(array(event.competitions)[0]).competitors).map(record);
  const awayId = text(record(competitors.find((row) => row.homeAway === "away")?.team).id);
  const homeId = text(record(competitors.find((row) => row.homeAway === "home")?.team).id);
  const eventAt = Date.parse(text(event.date) ?? "");
  return awayId !== null && homeId !== null && awayId === espnCfbTeamId(game.away.abbreviation) && homeId === espnCfbTeamId(game.home.abbreviation) &&
    Number.isFinite(eventAt) && Math.abs(eventAt - Date.parse(game.scheduledStart)) <= 90 * 60_000;
}

function scoreboardDates(game: NcaafGame): string[] {
  const instant = new Date(game.scheduledStart);
  if (!Number.isFinite(instant.getTime())) throw new Error(`CFB ESPN current-odds game ${game.providerGameId} has an invalid kickoff.`);
  const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => eastern.find((value) => value.type === type)?.value;
  return [...new Set([game.scheduledStart.slice(0, 10).replaceAll("-", ""), `${part("year")}${part("month")}${part("day")}`])];
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<JsonRecord> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(CFB_ESPN_CURRENT_ODDS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`ESPN CFB current-odds request failed (${response.status}).`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ESPN CFB current-odds response is invalid.");
  return payload as JsonRecord;
}

function line(value: unknown, stripPrefix: boolean): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(String(value).trim().replace(/^PK$/i, "0").replace(stripPrefix ? /^[ou]/i : /$^/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function american(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function emptyResult(): CfbEspnCurrentOddsResult { return { release: CFB_ESPN_CURRENT_ODDS_RELEASE, requests: 0, attemptedGames: 0, matchedGames: 0, booksByGame: {}, failuresByGame: {} }; }
