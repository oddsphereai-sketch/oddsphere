import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { normalizeMlbTeamName } from "@/lib/providers/real_api/_teamNameNormalizer";
import { SharpApiClient } from "@/lib/providers/real_api/_sharpApiClient";
import { cfbTeamIdentity } from "@/lib/services/football/cfbTeamIdentity";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { Sport } from "@/lib/types/domain/Sport";
import { unstable_cache } from "next/cache";

const CURRENT_SPLITS_RELEASE = "sharpapi_current_splits_2026_09_20_r1_durable_overlay" as const;
const CURRENT_SPLITS_TTL_MS = 5 * 60 * 1000;
const CURRENT_SPLITS_STALE_MS = 10 * 24 * 60 * 60 * 1000;
const CURRENT_SPLITS_TIMEOUT_MS = 4_000;

type Json = Record<string, unknown>;
type SupportedSport = Exclude<Sport, "soccer" | "ucl">;
type SplitMarket = "moneyline" | "spread" | "total";
type NamedBook = "circa" | "draftkings" | "betmgm";

type SharpApiCurrentSplitFeed = {
  source: "sharpapi_current_splits";
  release: typeof CURRENT_SPLITS_RELEASE;
  sport: SupportedSport;
  fetchedAt: string;
  rows: Json[];
};

export type SharpApiCurrentSplitOverlayResult = {
  matchedGames: number;
  populatedMarkets: number;
};

const LEAGUE_BY_SPORT: Record<SupportedSport, string> = {
  mlb: "mlb",
  nfl: "nfl",
  cfb: "ncaaf",
  nba: "nba",
  cbb: "ncaab",
  nhl: "nhl",
  wnba: "wnba",
};

const BOOK_PRIORITY: readonly NamedBook[] = ["circa", "draftkings", "betmgm"];

const BOOK_LABEL: Record<NamedBook, MarketSplitDisplaySection["label"]> = {
  circa: "Sharp Book Splits",
  draftkings: "DraftKings Splits",
  betmgm: "BetMGM Splits",
};

const NFL_ALIASES: Record<string, readonly string[]> = {
  ARI: ["arizona cardinals", "cardinals"], ATL: ["atlanta falcons", "falcons"],
  BAL: ["baltimore ravens", "ravens"], BUF: ["buffalo bills", "bills"],
  CAR: ["carolina panthers", "panthers"], CHI: ["chicago bears", "bears"],
  CIN: ["cincinnati bengals", "bengals"], CLE: ["cleveland browns", "browns"],
  DAL: ["dallas cowboys", "cowboys"], DEN: ["denver broncos", "broncos"],
  DET: ["detroit lions", "lions"], GB: ["green bay packers", "packers"],
  HOU: ["houston texans", "texans"], IND: ["indianapolis colts", "colts"],
  JAX: ["jacksonville jaguars", "jaguars"], KC: ["kansas city chiefs", "chiefs"],
  LAC: ["los angeles chargers", "la chargers", "chargers"],
  LAR: ["los angeles rams", "la rams", "rams"],
  LV: ["las vegas raiders", "raiders"], MIA: ["miami dolphins", "dolphins"],
  MIN: ["minnesota vikings", "vikings"], NE: ["new england patriots", "patriots"],
  NO: ["new orleans saints", "saints"], NYG: ["new york giants", "ny giants", "giants"],
  NYJ: ["new york jets", "ny jets", "jets"], PHI: ["philadelphia eagles", "eagles"],
  PIT: ["pittsburgh steelers", "steelers"], SEA: ["seattle seahawks", "seahawks"],
  SF: ["san francisco 49ers", "49ers"], TB: ["tampa bay buccaneers", "buccaneers", "bucs"],
  TEN: ["tennessee titans", "titans"],
  WAS: ["washington commanders", "commanders"],
  WSH: ["washington commanders", "commanders"],
};

function snapshotKey(sport: SupportedSport): string {
  return `daily-edge::sharpapi-current-splits::${sport}::${CURRENT_SPLITS_RELEASE}`;
}

function supportedSport(sport: Sport): sport is SupportedSport {
  return sport !== "soccer" && sport !== "ucl";
}

const readCachedCurrentSplits = unstable_cache(
  async (sport: SupportedSport) => readDurableCurrentSplits(sport),
  ["sharpapi-current-splits-durable-overlay-v1"],
  { revalidate: 5 * 60, tags: ["sharpapi-current-splits"] },
);

async function readDurableCurrentSplits(sport: SupportedSport): Promise<SharpApiCurrentSplitFeed | null> {
  const { readLabResponseSnapshot, readLatestLabResponseSnapshot, upsertLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
  const key = snapshotKey(sport);
  const fresh = await readLabResponseSnapshot<Record<string, unknown>>(key, "fresh");
  const validatedFresh = validateSharpApiCurrentSplitFeed(fresh?.payload, sport);
  if (validatedFresh) return validatedFresh;

  const apiKey = process.env.SHARPAPI_KEY;
  if (apiKey) {
    try {
      const rows = await new SharpApiClient(apiKey).fetchAll<Json>({
        path: "/splits",
        query: {
          league: LEAGUE_BY_SPORT[sport],
          sportsbook: "circa,draftkings,betmgm",
          limit: 200,
        },
        maxPages: 2,
        retryRateLimitInternally: false,
        signal: AbortSignal.timeout(CURRENT_SPLITS_TIMEOUT_MS),
      });
      if (rows.length > 0) {
        const feed: SharpApiCurrentSplitFeed = {
          source: "sharpapi_current_splits",
          release: CURRENT_SPLITS_RELEASE,
          sport,
          fetchedAt: newestTimestamp(rows) ?? new Date().toISOString(),
          rows,
        };
        await upsertLabResponseSnapshot({
          snapshotKey: key,
          kind: "daily_edge",
          payload: feed as unknown as Record<string, unknown>,
          ttlMs: CURRENT_SPLITS_TTL_MS,
          staleMs: CURRENT_SPLITS_STALE_MS,
          sport,
          source: "sharpapi_current_splits",
          payloadVersion: CURRENT_SPLITS_RELEASE,
        });
        return feed;
      }
    } catch (error) {
      console.warn(`SharpAPI current split overlay fetch failed for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(key);
  return validateSharpApiCurrentSplitFeed(stored?.payload, sport);
}

export function validateSharpApiCurrentSplitFeed(
  value: unknown,
  sport: SupportedSport,
): SharpApiCurrentSplitFeed | null {
  if (!isRecord(value)) return null;
  const fetchedAt = timestamp(value.fetchedAt);
  if (
    value.source !== "sharpapi_current_splits" ||
    value.release !== CURRENT_SPLITS_RELEASE ||
    value.sport !== sport ||
    fetchedAt === null ||
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    !value.rows.every(isRecord)
  ) return null;
  return value as SharpApiCurrentSplitFeed;
}

export async function populateDailyEdgeSharpApiCurrentSplits(
  response: DailyEdgeResponse,
  sport: Sport,
): Promise<SharpApiCurrentSplitOverlayResult> {
  if (!supportedSport(sport)) return { matchedGames: 0, populatedMarkets: 0 };
  try {
    return applySharpApiCurrentSplitOverlay(response, await readCachedCurrentSplits(sport));
  } catch (error) {
    console.warn(`SharpAPI current split overlay skipped for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
    return { matchedGames: 0, populatedMarkets: 0 };
  }
}

export function applySharpApiCurrentSplitOverlay(
  response: DailyEdgeResponse,
  feed: SharpApiCurrentSplitFeed | null,
  nowMs = Date.now(),
): SharpApiCurrentSplitOverlayResult {
  if (!feed || response.sport !== feed.sport) return { matchedGames: 0, populatedMarkets: 0 };
  let matchedGames = 0;
  let populatedMarkets = 0;
  for (const game of response.games) {
    const candidates = feed.rows.filter((row) => rowMatchesGame(row, game, response.date, feed.sport));
    if (candidates.length === 0) continue;
    matchedGames += 1;
    populatedMarkets += attachBestMarket(game, "moneyline", "moneyline", candidates, nowMs);
    populatedMarkets += attachBestMarket(game, "total", "total", candidates, nowMs);
    if (feed.sport !== "mlb") {
      populatedMarkets += attachBestMarket(game, "first_inning", "spread", candidates, nowMs);
    }
  }
  return { matchedGames, populatedMarkets };
}

function attachBestMarket(
  game: DailyEdgeGameDto,
  slot: keyof DailyEdgeGameDto["markets"],
  sourceMarket: SplitMarket,
  candidates: Json[],
  nowMs: number,
): 0 | 1 {
  const market = game.markets[slot];
  if (!market) return 0;
  const sections = BOOK_PRIORITY.flatMap((book) => {
    const rows = dedupeBookRows(candidates.filter((row) => normalize(text(row.sportsbook) ?? "") === book));
    if (rows.length !== 1) return [];
    const section = sectionFromRow(game, sourceMarket, book, rows[0]!);
    return section ? [section] : [];
  });
  // Freshness still controls internal source selection, but it does not
  // create a member-facing stale state. A current lower-priority fallback can
  // therefore remain until the preferred book publishes a current update.
  const current = sections.filter((section) => sectionIsFreshAt(section, nowMs));
  const selected = current[0] ?? sections.sort((a, b) => Date.parse(b.lastUpdated ?? "") - Date.parse(a.lastUpdated ?? ""))[0];
  if (!selected) return 0;

  const existing = market.sportsbookSplits;
  if (existing && !shouldReplace(existing, selected)) return 0;
  market.sportsbookSplits = selected;
  return 1;
}

function dedupeBookRows(rows: Json[]): Json[] {
  const newestByEvent = new Map<string, Json>();
  for (const row of rows) {
    const eventId = text(row.event_id);
    if (!eventId) continue;
    const existing = newestByEvent.get(eventId);
    if (!existing || Date.parse(timestamp(row.fetched_at) ?? "") > Date.parse(timestamp(existing.fetched_at) ?? "")) {
      newestByEvent.set(eventId, row);
    }
  }
  return [...newestByEvent.values()];
}

function sectionFromRow(
  game: DailyEdgeGameDto,
  market: SplitMarket,
  book: NamedBook,
  row: Json,
): MarketSplitDisplaySection | null {
  const fetchedAt = timestamp(row.fetched_at);
  const source = record(row[market]);
  if (!fetchedAt) return null;
  const firstKey = market === "total" ? "over" : "away";
  const secondKey = market === "total" ? "under" : "home";
  const bets = record(source.bets_pct);
  const handle = record(source.handle_pct);
  const firstMoney = percentage(handle[firstKey]);
  const secondMoney = percentage(handle[secondKey]);
  const firstBets = percentage(bets[firstKey]);
  const secondBets = percentage(bets[secondKey]);
  if (
    firstMoney === null || secondMoney === null || firstBets === null || secondBets === null ||
    !complementary(firstMoney, secondMoney) || !complementary(firstBets, secondBets)
  ) return null;
  return {
    label: BOOK_LABEL[book],
    rows: [
      {
        side: market === "total" ? "over" : "away",
        label: market === "total" ? "Over" : game.awayTeam,
        moneyPct: firstMoney,
        betsPct: firstBets,
        observedAt: null,
        freshnessCheckedAt: fetchedAt,
        // The exact-game fallback remains until a verified update replaces it.
        // Do not introduce a member-facing stale state, copy, badge, or label.
        isStale: false,
      },
      {
        side: market === "total" ? "under" : "home",
        label: market === "total" ? "Under" : game.homeTeam,
        moneyPct: secondMoney,
        betsPct: secondBets,
        observedAt: null,
        freshnessCheckedAt: fetchedAt,
        isStale: false,
      },
    ],
    signal: null,
    lastUpdated: null,
  };
}

function shouldReplace(existing: MarketSplitDisplaySection, incoming: MarketSplitDisplaySection): boolean {
  const existingCurrent = sectionIsCurrent(existing);
  const incomingCurrent = sectionIsCurrent(incoming);
  if (existingCurrent !== incomingCurrent) return incomingCurrent;
  const priority = (label: MarketSplitDisplaySection["label"]) => {
    if (label === "Sharp Book Splits") return 0;
    if (label === "DraftKings Splits") return 1;
    if (label === "BetMGM Splits") return 2;
    return 3;
  };
  const priorityDelta = priority(incoming.label) - priority(existing.label);
  if (priorityDelta !== 0) return priorityDelta < 0;
  return sectionSourceTimestamp(incoming) > sectionSourceTimestamp(existing);
}

function sectionIsCurrent(section: MarketSplitDisplaySection): boolean {
  return sectionIsFreshAt(section, Date.now());
}

function sectionIsFreshAt(section: MarketSplitDisplaySection, nowMs: number): boolean {
  const observedAt = sectionSourceTimestamp(section);
  return Number.isFinite(observedAt) &&
    nowMs - observedAt <= 15 * 60 * 1000;
}

function sectionSourceTimestamp(section: MarketSplitDisplaySection): number {
  const rowTimestamps = section.rows
    .map((row) => Date.parse(row.freshnessCheckedAt ?? row.observedAt ?? ""))
    .filter(Number.isFinite);
  return rowTimestamps.length > 0
    ? Math.max(...rowTimestamps)
    : Date.parse(section.lastUpdated ?? "");
}

function rowMatchesGame(row: Json, game: DailyEdgeGameDto, slateDate: string, sport: SupportedSport): boolean {
  if (normalize(text(row.league) ?? "") !== normalize(LEAGUE_BY_SPORT[sport])) return false;
  const dates = acceptedDates(game.gameStartAt, slateDate);
  const startAt = timestamp(row.event_start_time);
  const eventDate = text(row.event_id)?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  if (startAt ? !dates.has(easternDate(startAt)) : !eventDate || !dates.has(eventDate)) return false;
  return teamMatches(sport, row.away_team, game.awayTeam, game.awayTeamDisplayName) &&
    teamMatches(sport, row.home_team, game.homeTeam, game.homeTeamDisplayName);
}

function acceptedDates(gameStartAt: string | null | undefined, slateDate: string): Set<string> {
  const dates = new Set([slateDate]);
  if (gameStartAt && Number.isFinite(Date.parse(gameStartAt))) {
    dates.add(gameStartAt.slice(0, 10));
    dates.add(easternDate(gameStartAt));
  }
  return dates;
}

function easternDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function teamMatches(sport: SupportedSport, raw: unknown, abbreviation: string, displayName?: string | null): boolean {
  if (typeof raw !== "string") return false;
  if (sport === "mlb") {
    const observed = normalizeMlbTeamName(raw);
    const expected = normalizeMlbTeamName(abbreviation) ?? normalizeMlbTeamName(displayName ?? "");
    return observed !== null && expected !== null && observed === expected;
  }
  const observed = normalizeTeam(raw);
  const identityName = sport === "cfb" ? cfbTeamIdentity(abbreviation)?.displayName ?? "" : "";
  const aliases = [abbreviation, displayName ?? "", identityName];
  if (sport === "nfl") aliases.push(...(NFL_ALIASES[abbreviation.toUpperCase()] ?? []));
  return aliases.some((alias) => {
    const expected = normalizeTeam(alias);
    return expected.length > 0 && (
      observed === expected ||
      (sport === "cfb" && Math.min(observed.length, expected.length) >= 5 &&
        (observed.startsWith(expected) || expected.startsWith(observed)))
    );
  });
}

function newestTimestamp(rows: Json[]): string | null {
  return rows.map((row) => timestamp(row.fetched_at)).filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

function percentage(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return normalized <= 100 ? Math.round(normalized * 1_000_000) / 1_000_000 : null;
}

function complementary(first: number, second: number): boolean {
  return Math.abs(first + second - 100) <= 1;
}

function timestamp(value: unknown): string | null {
  const valueText = text(value);
  return valueText && Number.isFinite(Date.parse(valueText)) ? new Date(valueText).toISOString() : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTeam(value: string): string {
  return value.replace(/^\s*\(\d+\)\s*/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const __TEST__ = { rowMatchesGame, sectionFromRow, teamMatches, shouldReplace };
