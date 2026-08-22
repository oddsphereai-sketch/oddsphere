import { SharpApiClient } from "@/lib/providers/real_api/_sharpApiClient";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";

export type NflRegularSharpMarket = "moneyline" | "spread" | "total";

export type NflRegularSharpSplit = {
  provider: "sharpapi";
  providerGameId: string;
  sourceEventId: string | null;
  sourceSportsbook: string | null;
  capturedAt: string;
  providerFetchedAt: string | null;
  homeMoneyPct: number | null;
  awayMoneyPct: number | null;
  homeBetsPct: number | null;
  awayBetsPct: number | null;
  overMoneyPct: number | null;
  underMoneyPct: number | null;
  overBetsPct: number | null;
  underBetsPct: number | null;
};

export type NflRegularSharpSplitSet = Record<NflRegularSharpMarket, NflRegularSharpSplit>;

export type SharpApiNflSplitRow = {
  event_id?: string | null;
  event_start_time?: string | null;
  sport?: string | null;
  league?: string | null;
  away_team?: string | null;
  home_team?: string | null;
  sportsbook?: string | null;
  moneyline?: SharpApiNflSplitMarket | null;
  spread?: SharpApiNflSplitMarket | null;
  total?: SharpApiNflSplitMarket | null;
  fetched_at?: string | null;
};

type SharpApiNflSplitMarket = {
  bets_pct?: Record<string, number | string | null> | null;
  handle_pct?: Record<string, number | string | null> | null;
};

type DatedRows = { date: string; rows: SharpApiNflSplitRow[] };

const TEAM_ALIASES: Record<string, string[]> = {
  ARI: ["arizona cardinals", "cardinals"], ATL: ["atlanta falcons", "falcons"],
  BAL: ["baltimore ravens", "ravens"], BUF: ["buffalo bills", "bills"],
  CAR: ["carolina panthers", "panthers"], CHI: ["chicago bears", "bears"],
  CIN: ["cincinnati bengals", "bengals"], CLE: ["cleveland browns", "browns"],
  DAL: ["dallas cowboys", "cowboys"], DEN: ["denver broncos", "broncos"],
  DET: ["detroit lions", "lions"], GB: ["green bay packers", "packers"],
  HOU: ["houston texans", "texans"], IND: ["indianapolis colts", "colts"],
  JAX: ["jacksonville jaguars", "jaguars"], KC: ["kansas city chiefs", "chiefs"],
  LAC: ["los angeles chargers", "la chargers", "chargers"],
  LAR: ["los angeles rams", "la rams", "rams"], LA: ["los angeles rams", "la rams", "rams"],
  LV: ["las vegas raiders", "raiders"], MIA: ["miami dolphins", "dolphins"],
  MIN: ["minnesota vikings", "vikings"], NE: ["new england patriots", "patriots"],
  NO: ["new orleans saints", "saints"], NYG: ["new york giants", "ny giants", "giants"],
  NYJ: ["new york jets", "ny jets", "jets"], PHI: ["philadelphia eagles", "eagles"],
  PIT: ["pittsburgh steelers", "steelers"], SEA: ["seattle seahawks", "seahawks"],
  SF: ["san francisco 49ers", "49ers"], TB: ["tampa bay buccaneers", "buccaneers", "bucs"],
  TEN: ["tennessee titans", "titans"], WAS: ["washington commanders", "commanders"],
  WSH: ["washington commanders", "commanders"],
};

export async function fetchSharpApiNflSplits(args: {
  apiKey: string;
  games: NflPreviewGame[];
  capturedAt: string;
}): Promise<{
  splitsByGame: Record<string, NflRegularSharpSplitSet>;
  requests: number;
  rows: number;
  dates: string[];
}> {
  const client = new SharpApiClient(args.apiKey);
  const dates = Array.from(new Set(args.games.map((game) => nflLocalDate(game.scheduledStart)))).sort();
  // Live probing showed the endpoint currently ignores its date parameter
  // for the football-family response. Fetch once for the entire Week 1 card,
  // then apply our own strict NFL league, event-date, and team-identity guards.
  // This prevents four duplicate calls for the Thursday/Sunday/Monday dates.
  const rows = await client.fetchAll<SharpApiNflSplitRow>({
    path: "/splits",
    query: { sport: "nfl", limit: 200 },
    // One 200-row page safely exceeds a complete football-family slate and
    // keeps the provider budget deterministic.
    maxPages: 1,
  });
  const datedRows = dates.map((date) => ({ date, rows }));
  return {
    splitsByGame: matchSharpApiNflSplitRows(args.games, datedRows, args.capturedAt),
    requests: 1,
    rows: rows.length,
    dates,
  };
}

export function matchSharpApiNflSplitRows(
  games: NflPreviewGame[],
  datedRows: DatedRows[],
  capturedAt: string,
): Record<string, NflRegularSharpSplitSet> {
  const rowsByDate = new Map(datedRows.map((value) => [value.date, value.rows]));
  const matched: Record<string, NflRegularSharpSplitSet> = {};
  for (const game of games) {
    const date = nflLocalDate(game.scheduledStart);
    const candidates = (rowsByDate.get(date) ?? []).filter((row) =>
      nflRow(row) &&
      sameNflTeam(row.home_team, game.home.abbreviation, game.home.name) &&
      sameNflTeam(row.away_team, game.away.abbreviation, game.away.name) &&
      rowDateMatches(row, date)
    );
    const consensus = candidates.filter((row) => normalize(row.sportsbook ?? "") === "consensus");
    const selected = consensus.length === 1 ? consensus[0] : candidates.length === 1 ? candidates[0] : null;
    if (selected === null) continue;
    matched[game.providerGameId] = normalizeSharpApiNflSplit(game.providerGameId, capturedAt, selected);
  }
  return matched;
}

export function normalizeSharpApiNflSplit(
  providerGameId: string,
  capturedAt: string,
  row: SharpApiNflSplitRow,
): NflRegularSharpSplitSet {
  const base = {
    provider: "sharpapi" as const,
    providerGameId,
    sourceEventId: text(row.event_id),
    sourceSportsbook: text(row.sportsbook),
    capturedAt,
    providerFetchedAt: validTimestamp(row.fetched_at),
  };
  return {
    moneyline: {
      ...base,
      homeMoneyPct: percent(row.moneyline?.handle_pct?.home),
      awayMoneyPct: percent(row.moneyline?.handle_pct?.away),
      homeBetsPct: percent(row.moneyline?.bets_pct?.home),
      awayBetsPct: percent(row.moneyline?.bets_pct?.away),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    spread: {
      ...base,
      homeMoneyPct: percent(row.spread?.handle_pct?.home),
      awayMoneyPct: percent(row.spread?.handle_pct?.away),
      homeBetsPct: percent(row.spread?.bets_pct?.home),
      awayBetsPct: percent(row.spread?.bets_pct?.away),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    total: {
      ...base,
      homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
      overMoneyPct: percent(row.total?.handle_pct?.over),
      underMoneyPct: percent(row.total?.handle_pct?.under),
      overBetsPct: percent(row.total?.bets_pct?.over),
      underBetsPct: percent(row.total?.bets_pct?.under),
    },
  };
}

export function completeSharpApiNflSplitSet(value: NflRegularSharpSplitSet | undefined): boolean {
  if (!value) return false;
  return complementary(value.moneyline.homeMoneyPct, value.moneyline.awayMoneyPct) &&
    complementary(value.moneyline.homeBetsPct, value.moneyline.awayBetsPct) &&
    complementary(value.spread.homeMoneyPct, value.spread.awayMoneyPct) &&
    complementary(value.spread.homeBetsPct, value.spread.awayBetsPct) &&
    complementary(value.total.overMoneyPct, value.total.underMoneyPct) &&
    complementary(value.total.overBetsPct, value.total.underBetsPct);
}

function nflRow(row: SharpApiNflSplitRow): boolean {
  const league = normalize(row.league ?? "");
  if (league !== "") return league === "nfl";
  const sport = normalize(row.sport ?? "");
  const eventId = normalize(row.event_id ?? "");
  return sport === "nfl" && eventId.startsWith("nfl");
}

function sameNflTeam(value: unknown, abbreviation: string, displayName: string): boolean {
  if (typeof value !== "string") return false;
  const observed = normalize(value);
  const aliases = [abbreviation, displayName, ...(TEAM_ALIASES[abbreviation.toUpperCase()] ?? [])];
  return aliases.some((alias) => normalize(alias) === observed);
}

function rowDateMatches(row: SharpApiNflSplitRow, expectedDate: string): boolean {
  const eventStart = validTimestamp(row.event_start_time);
  if (eventStart !== null) return nflLocalDate(eventStart) === expectedDate;
  const eventIdDate = text(row.event_id)?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  return eventIdDate === null || eventIdDate === expectedDate;
}

function nflLocalDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid NFL timestamp: ${value}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function percent(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return normalized <= 100 ? normalized : null;
}

function complementary(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
