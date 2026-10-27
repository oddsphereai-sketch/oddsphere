import { createHash } from "node:crypto";
import {
  SharpApiClient,
  type SharpApiRequestOptions,
} from "@/lib/providers/real_api/_sharpApiClient";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";

export const NFL_SHARP_API_SPLITS_RELEASE =
  "nfl_sharpapi_splits_2026_10_09_r2_provider_team_prefix_identity" as const;
export const NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE =
  "nfl_sharpapi_split_capture_manifest_2026_10_27_r1_pagination_metadata_closed" as const;

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

export const NFL_SHARP_API_SPLIT_BOOKS = ["circa", "draftkings", "betmgm"] as const;
const SOURCE_BOOK_PRIORITY = NFL_SHARP_API_SPLIT_BOOKS;
export type NflSharpApiSplitBook = typeof NFL_SHARP_API_SPLIT_BOOKS[number];
export type NflSharpApiSplitSourceStatus = "observed" | "incomplete" | "duplicate" | "unavailable";
export type NflSharpApiSplitSource = {
  sportsbook: NflSharpApiSplitBook;
  status: NflSharpApiSplitSourceStatus;
  matchedRows: number;
  /** Every exact-identity row survives, including incomplete and duplicate rows. */
  observations: NflRegularSharpSplitSet[];
};

type SharpApiNflSplitMarket = {
  bets_pct?: Record<string, number | string | null> | null;
  handle_pct?: Record<string, number | string | null> | null;
};

type DatedRows = { date: string; rows: SharpApiNflSplitRow[] };
type SharpClient = {
  fetchAll<T>(opts: SharpApiRequestOptions & { maxPages?: number }): Promise<T[]>;
  fetch?<T>(opts: SharpApiRequestOptions): Promise<{
    data: T;
    pagination?: { total?: number; count?: number; offset?: number; has_more?: boolean } | null;
  }>;
};

export type NflSharpApiSplitCaptureManifest = {
  release: typeof NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE;
  responseReceivedAt: string;
  rawResponseSha256: string | null;
  status: "observed" | "failed";
  failureReason: string | null;
  returnedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  rows: Array<{
    rowIndex: number;
    rawRowSha256: string;
    disposition: "matched" | "unmatched" | "ambiguous";
    providerGameId: string | null;
  }>;
};

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
  client?: SharpClient;
  clock?: () => string;
  /** Research-only lossless receipt. Default false preserves the incumbent request and matching path. */
  captureResearchManifest?: boolean;
}): Promise<{
  release: typeof NFL_SHARP_API_SPLITS_RELEASE;
  /** Backward-compatible preferred complete set used by the incumbent reader. */
  splitsByGame: Record<string, NflRegularSharpSplitSet>;
  /** Lossless source manifest for shadow research; never used by the incumbent reader. */
  sourcesByGame?: Record<string, NflSharpApiSplitSource[]>;
  requests: number;
  rows: number;
  dates: string[];
  captureManifest?: NflSharpApiSplitCaptureManifest;
}> {
  const client = args.client ?? new SharpApiClient(args.apiKey);
  const dates = Array.from(new Set(args.games.map((game) => nflLocalDate(game.scheduledStart)))).sort();
  // SharpAPI classifies NFL rows with league=nfl and sport=football. A sport=nfl
  // filter returns an empty payload. Fetch once for the whole weekly card, then
  // apply our own strict league, event-date, and team-identity guards.
  const request = {
    path: "/splits",
    query: { league: "nfl", sportsbook: "circa,draftkings,betmgm", limit: 200 },
  } satisfies SharpApiRequestOptions;
  if (!args.captureResearchManifest) {
    const rows = await client.fetchAll<SharpApiNflSplitRow>({ ...request, maxPages: 1 });
    const datedRows = dates.map((date) => ({ date, rows }));
    return {
      release: NFL_SHARP_API_SPLITS_RELEASE,
      splitsByGame: matchSharpApiNflSplitRows(args.games, datedRows, args.capturedAt),
      requests: 1,
      rows: rows.length,
      dates,
    };
  }
  const page = client.fetch ? await client.fetch<SharpApiNflSplitRow[]>(request) : null;
  const rows = page ? (Array.isArray(page.data) ? page.data : [])
    : await client.fetchAll<SharpApiNflSplitRow>({ ...request, maxPages: 1 });
  const pagination = page?.pagination;
  const explicitlyComplete = pagination !== undefined && pagination !== null &&
    pagination.has_more === false &&
    typeof pagination.total === "number" &&
    pagination.total <= (pagination.offset ?? 0) + (pagination.count ?? rows.length);
  const explicitlyIncomplete = pagination?.has_more === true ||
    (typeof pagination?.total === "number" &&
      pagination.total > (pagination.offset ?? 0) + (pagination.count ?? rows.length));
  if (explicitlyIncomplete || (rows.length >= 200 && !explicitlyComplete)) {
    throw new Error("SharpAPI NFL split response reached its bounded page size; completeness is unproved.");
  }
  const receivedCandidate = args.clock?.() ?? new Date().toISOString();
  const responseReceivedAt = Date.parse(receivedCandidate) >= Date.parse(args.capturedAt)
    ? new Date(Date.parse(receivedCandidate)).toISOString() : new Date(Date.parse(args.capturedAt)).toISOString();
  const datedRows = dates.map((date) => ({ date, rows }));
  const sourcesByGame = matchAllSharpApiNflSplitRows(args.games, datedRows, responseReceivedAt);
  const captureManifest = buildSplitCaptureManifest(args.games, rows, responseReceivedAt);
  return {
    release: NFL_SHARP_API_SPLITS_RELEASE,
    // Receipt time is research chronology only. The incumbent DTO retains its
    // exact pre-Market-Brain capture-time fallback semantics.
    splitsByGame: matchSharpApiNflSplitRows(args.games, datedRows, args.capturedAt),
    sourcesByGame,
    requests: 1,
    rows: rows.length,
    dates,
    captureManifest,
  };
}

function buildSplitCaptureManifest(
  games: NflPreviewGame[],
  rows: SharpApiNflSplitRow[],
  responseReceivedAt: string,
): NflSharpApiSplitCaptureManifest {
  const ledger = rows.map((row, rowIndex) => {
    const candidates = games.filter((game) => {
      const date = nflLocalDate(game.scheduledStart);
      return nflRow(row) && researchRowDateMatches(row, date) &&
        sameNflTeam(row.home_team, game.home.abbreviation, game.home.name) &&
        sameNflTeam(row.away_team, game.away.abbreviation, game.away.name);
    });
    return {
      rowIndex,
      rawRowSha256: digest(row),
      disposition: candidates.length === 1 ? "matched" as const
        : candidates.length > 1 ? "ambiguous" as const : "unmatched" as const,
      providerGameId: candidates.length === 1 ? candidates[0]!.providerGameId : null,
    };
  });
  return {
    release: NFL_SHARP_API_SPLIT_CAPTURE_MANIFEST_RELEASE,
    responseReceivedAt,
    rawResponseSha256: digest(rows),
    status: "observed",
    failureReason: null,
    returnedRows: rows.length,
    matchedRows: ledger.filter((row) => row.disposition === "matched").length,
    unmatchedRows: ledger.filter((row) => row.disposition === "unmatched").length,
    ambiguousRows: ledger.filter((row) => row.disposition === "ambiguous").length,
    rows: ledger,
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
    const selected = SOURCE_BOOK_PRIORITY.flatMap((sportsbook) => {
      const rows = candidates.filter((row) => normalize(row.sportsbook ?? "") === sportsbook);
      if (rows.length !== 1) return [];
      const normalized = normalizeSharpApiNflSplit(game.providerGameId, capturedAt, rows[0]!);
      return completeSharpApiNflSplitSet(normalized) ? [normalized] : [];
    })[0] ?? null;
    if (selected !== null) matched[game.providerGameId] = selected;
  }
  return matched;
}

export function matchAllSharpApiNflSplitRows(
  games: NflPreviewGame[],
  datedRows: DatedRows[],
  capturedAt: string,
): Record<string, NflSharpApiSplitSource[]> {
  const rowsByDate = new Map(datedRows.map((value) => [value.date, value.rows]));
  const matched: Record<string, NflSharpApiSplitSource[]> = {};
  for (const game of games) {
    const date = nflLocalDate(game.scheduledStart);
    const candidates = (rowsByDate.get(date) ?? []).filter((row) =>
      nflRow(row) &&
      sameNflTeam(row.home_team, game.home.abbreviation, game.home.name) &&
      sameNflTeam(row.away_team, game.away.abbreviation, game.away.name) &&
      researchRowDateMatches(row, date)
    );
    matched[game.providerGameId] = NFL_SHARP_API_SPLIT_BOOKS.map((sportsbook) => {
      const rows = candidates.filter((row) => normalize(row.sportsbook ?? "") === sportsbook);
      const observations = rows.map((row) => normalizeSharpApiNflSplit(game.providerGameId, capturedAt, row));
      const status: NflSharpApiSplitSourceStatus = rows.length === 0 ? "unavailable"
        : rows.length > 1 ? "duplicate"
        : completeSharpApiNflSplitSet(observations[0]) ? "observed"
        : "incomplete";
      return { sportsbook, status, matchedRows: rows.length, observations };
    });
  }
  return matched;
}

export function unavailableNflSharpApiSplitSources(): NflSharpApiSplitSource[] {
  return NFL_SHARP_API_SPLIT_BOOKS.map((sportsbook) => ({
    sportsbook,
    status: "unavailable",
    matchedRows: 0,
    observations: [],
  }));
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
  const teamAliases = TEAM_ALIASES[abbreviation.toUpperCase()] ?? [];
  const providerPrefixAliases = [abbreviation, ...teamCodeAliases(abbreviation)];
  const aliases = [
    abbreviation,
    displayName,
    ...teamAliases,
    ...providerPrefixAliases.flatMap((prefix) => teamAliases.map((alias) => `${prefix} ${alias}`)),
  ];
  return aliases.some((alias) => normalize(alias) === observed);
}

function teamCodeAliases(abbreviation: string): string[] {
  switch (abbreviation.toUpperCase()) {
    case "LAR": return ["LA"];
    case "WSH": return ["WAS"];
    default: return [];
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rowDateMatches(row: SharpApiNflSplitRow, expectedDate: string): boolean {
  const eventStart = validTimestamp(row.event_start_time);
  if (eventStart !== null) return nflLocalDate(eventStart) === expectedDate;
  const eventIdDate = text(row.event_id)?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  return eventIdDate === null || eventIdDate === expectedDate;
}

function researchRowDateMatches(row: SharpApiNflSplitRow, expectedDate: string): boolean {
  const eventStart = validTimestamp(row.event_start_time);
  if (eventStart !== null) return nflLocalDate(eventStart) === expectedDate;
  const eventIdDate = text(row.event_id)?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  return eventIdDate !== null && eventIdDate === expectedDate;
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
