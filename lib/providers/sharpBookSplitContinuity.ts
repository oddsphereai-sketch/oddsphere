import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { Sport } from "@/lib/types/domain/Sport";

const CONTINUITY_RELEASE = "sharp_book_split_continuity_2026_09_20_r1" as const;
const CONTINUITY_TTL_MS = 5 * 60 * 1000;
const CONTINUITY_STALE_MS = 10 * 24 * 60 * 60 * 1000;
const SOURCE_FAILOVER_GRACE_MS = 3 * 60 * 60 * 1000;
const MARKET_KEYS = ["moneyline", "total", "first_inning"] as const;

type MarketKey = typeof MARKET_KEYS[number];

type RetainedGame = {
  gameId: string;
  gameStartAt: string | null;
  awayTeam: string;
  homeTeam: string;
  markets: Partial<Record<MarketKey, MarketSplitDisplaySection>>;
};

type SharpBookSplitContinuityFeed = {
  release: typeof CONTINUITY_RELEASE;
  sport: Sport;
  slateDate: string;
  games: RetainedGame[];
};

export type SharpBookSplitContinuityResult = {
  matchedGames: number;
  populatedMarkets: number;
  feed: SharpBookSplitContinuityFeed | null;
};

function snapshotKey(sport: Sport, slateDate: string): string {
  return `daily-edge::sharp-book-split-continuity::${sport}::${slateDate}::${CONTINUITY_RELEASE}`;
}

export async function loadDailyEdgeSharpBookSplitContinuity(
  response: DailyEdgeResponse,
  sport: Sport,
): Promise<SharpBookSplitContinuityResult> {
  try {
    const { readLatestLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
    const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(snapshotKey(sport, response.date));
    const feed = validateFeed(stored?.payload, sport, response.date);
    const applied = applySharpBookSplitContinuity(response, feed);
    return { ...applied, feed };
  } catch (error) {
    console.warn(`Sharp-book split continuity read failed for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
    return { matchedGames: 0, populatedMarkets: 0, feed: null };
  }
}

export function applySharpBookSplitContinuity(
  response: DailyEdgeResponse,
  feed: SharpBookSplitContinuityFeed | null,
  nowMs = Date.now(),
): Omit<SharpBookSplitContinuityResult, "feed"> {
  if (!feed || feed.sport !== response.sport || feed.slateDate !== response.date) {
    return { matchedGames: 0, populatedMarkets: 0 };
  }
  let matchedGames = 0;
  let populatedMarkets = 0;
  for (const game of response.games) {
    const matches = feed.games.filter((candidate) => retainedGameMatches(candidate, game));
    if (matches.length !== 1) continue;
    matchedGames += 1;
    for (const marketKey of MARKET_KEYS) {
      const retained = matches[0]!.markets[marketKey];
      const market = game.markets[marketKey];
      if (!retained || !market || sectionQuality(retained) !== 2) continue;
      const existing = market.sportsbookSplits ?? null;
      const selected = existing && sectionQuality(existing) === 2
        ? preferredActiveSection(retained, existing, nowMs)
        : retained;
      market.sportsbookSplits = cloneRetainedSection(selected);
      populatedMarkets += 1;
    }
  }
  return { matchedGames, populatedMarkets };
}

/**
 * `sportsbookSplits` is the response-boundary display override. Keep it only
 * when it is the better verified section than the writer-captured sharp row.
 * The UI can then prefer that field without exposing source/freshness copy.
 */
export function reconcileDailyEdgeSharpBookSplitAuthority(
  response: DailyEdgeResponse,
  nowMs = Date.now(),
): number {
  let preferredFallbacks = 0;
  for (const game of response.games) {
    for (const marketKey of MARKET_KEYS) {
      const market = game.markets[marketKey];
      if (!market?.sportsbookSplits?.rows.length) continue;
      const writerSharp = market.recommendationDecision?.sharpBookSplits ?? null;
      if (!writerSharp?.rows.length) {
        preferredFallbacks += 1;
        continue;
      }
      if (preferredSection(writerSharp, market.sportsbookSplits, nowMs) === writerSharp) {
        market.sportsbookSplits = null;
      } else {
        preferredFallbacks += 1;
      }
    }
  }
  return preferredFallbacks;
}

export async function persistDailyEdgeSharpBookSplitContinuity(
  response: DailyEdgeResponse,
  sport: Sport,
  previous: SharpBookSplitContinuityFeed | null,
): Promise<boolean> {
  try {
    // Re-read immediately before the write. A cache here could let a second
    // request overwrite sections that another request saved moments earlier.
    const { readLatestLabResponseSnapshot, upsertLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
    const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(snapshotKey(sport, response.date));
    const latest = validateFeed(stored?.payload, sport, response.date);
    const baseline = mergeContinuityFeeds(previous, latest, sport, response.date);
    const next = captureFeed(response, sport, baseline);
    if (next.games.length === 0 || feedsEqual(latest ?? baseline, next)) return false;
    const result = await upsertLabResponseSnapshot({
      snapshotKey: snapshotKey(sport, response.date),
      kind: "daily_edge",
      payload: next as unknown as Record<string, unknown>,
      ttlMs: CONTINUITY_TTL_MS,
      staleMs: CONTINUITY_STALE_MS,
      sport,
      slateDate: response.date,
      source: "sharp_book_split_continuity",
      payloadVersion: CONTINUITY_RELEASE,
    });
    return result.ok;
  } catch (error) {
    console.warn(`Sharp-book split continuity write failed for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function mergeContinuityFeeds(
  earlier: SharpBookSplitContinuityFeed | null,
  later: SharpBookSplitContinuityFeed | null,
  sport: Sport,
  slateDate: string,
): SharpBookSplitContinuityFeed | null {
  if (!earlier) return later;
  if (!later) return earlier;
  const games = earlier.games.map(cloneRetainedGame);
  for (const latestGame of later.games) {
    const index = games.findIndex((candidate) => retainedGamesMatch(candidate, latestGame));
    if (index < 0) {
      games.push(cloneRetainedGame(latestGame));
      continue;
    }
    const prior = games[index]!;
    games[index] = {
      ...prior,
      ...latestGame,
      markets: { ...prior.markets, ...cloneRetainedGame(latestGame).markets },
    };
  }
  return { release: CONTINUITY_RELEASE, sport, slateDate, games };
}

function captureFeed(
  response: DailyEdgeResponse,
  sport: Sport,
  previous: SharpBookSplitContinuityFeed | null,
): SharpBookSplitContinuityFeed {
  const retained = previous?.games.map(cloneRetainedGame) ?? [];
  for (const game of response.games) {
    const current = retained.find((candidate) => retainedGameMatches(candidate, game));
    const target: RetainedGame = current ?? {
      gameId: String(game.id),
      gameStartAt: validTimestamp(game.gameStartAt),
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      markets: {},
    };
    let captured = false;
    for (const marketKey of MARKET_KEYS) {
      const market = game.markets[marketKey];
      const section = displayedSection(market);
      if (!section || sectionQuality(section) !== 2) continue;
      const normalized = cloneRetainedSection(section);
      const prior = target.markets[marketKey];
      if (!prior || sectionQuality(normalized) >= sectionQuality(prior)) {
        target.markets[marketKey] = normalized;
        captured = true;
      }
    }
    if (!current && captured) retained.push(target);
  }
  return {
    release: CONTINUITY_RELEASE,
    sport,
    slateDate: response.date,
    games: retained
      .filter((game) => Object.keys(game.markets).length > 0)
      .sort((first, second) => retainedSortKey(first).localeCompare(retainedSortKey(second))),
  };
}

function displayedSection(market: MarketEdgeDto | undefined): MarketSplitDisplaySection | null {
  if (!market) return null;
  return market.sportsbookSplits?.rows.length
    ? market.sportsbookSplits
    : market.recommendationDecision?.sharpBookSplits?.rows.length
      ? market.recommendationDecision.sharpBookSplits
      : null;
}

function preferredSection(
  writerSharp: MarketSplitDisplaySection,
  fallback: MarketSplitDisplaySection,
  nowMs: number,
): MarketSplitDisplaySection {
  const writerCurrent = sectionIsCurrent(writerSharp, nowMs);
  const fallbackCurrent = sectionIsCurrent(fallback, nowMs);
  if (writerCurrent !== fallbackCurrent) return fallbackCurrent ? fallback : writerSharp;
  const writerQuality = sectionQuality(writerSharp);
  const fallbackQuality = sectionQuality(fallback);
  if (writerQuality !== fallbackQuality) return fallbackQuality > writerQuality ? fallback : writerSharp;
  if (!writerCurrent && !fallbackCurrent) {
    const writerAt = sectionTimestamp(writerSharp);
    const fallbackAt = sectionTimestamp(fallback);
    if (writerAt !== fallbackAt) return fallbackAt > writerAt ? fallback : writerSharp;
  }
  return sectionPriority(fallback) < sectionPriority(writerSharp) ? fallback : writerSharp;
}

/**
 * The retained section is the source users last saw. Hold that source through
 * short upstream gaps, then allow a newer complete candidate to take over.
 */
function preferredActiveSection(
  retained: MarketSplitDisplaySection,
  candidate: MarketSplitDisplaySection,
  nowMs: number,
): MarketSplitDisplaySection {
  const retainedAt = sectionTimestamp(retained);
  const candidateAt = sectionTimestamp(candidate);
  if (sameSource(retained, candidate)) {
    return candidateAt > retainedAt ? candidate : retained;
  }
  if (sectionIsCurrent(retained, nowMs)) return retained;
  if (sectionIsCurrent(candidate, nowMs)) return candidate;
  return candidateAt > retainedAt ? candidate : retained;
}

function sameSource(first: MarketSplitDisplaySection, second: MarketSplitDisplaySection): boolean {
  const source = (section: MarketSplitDisplaySection): string => {
    if (section.sourceBook === "draftkings_network") return "draftkings";
    if (section.sourceBook) return section.sourceBook;
    if (section.label === "DraftKings Splits") return "draftkings";
    if (section.label === "BetMGM Splits") return "betmgm";
    if (section.label === "Sharp Book Splits") return "circa";
    return section.label;
  };
  return source(first) === source(second);
}

function sectionPriority(section: MarketSplitDisplaySection): number {
  if (section.sourceBook === "circa") return 0;
  if (section.sourceBook === "draftkings" || section.sourceBook === "draftkings_network") return 1;
  if (section.sourceBook === "consensus") return 2;
  if (section.sourceBook === "betmgm") return 3;
  if (section.label === "Sharp Book Splits") return 0;
  if (section.label === "DraftKings Splits") return 1;
  if (section.label === "BetMGM Splits") return 3;
  return 2;
}

function sectionIsCurrent(section: MarketSplitDisplaySection, nowMs: number): boolean {
  const at = sectionTimestamp(section);
  return Number.isFinite(at) && nowMs - at <= SOURCE_FAILOVER_GRACE_MS;
}

function sectionTimestamp(section: MarketSplitDisplaySection): number {
  const internal = Date.parse(section.sourceObservedAt ?? "");
  if (Number.isFinite(internal)) return internal;
  const rowTimes = section.rows
    .map((row) => Date.parse(row.freshnessCheckedAt ?? row.observedAt ?? ""))
    .filter(Number.isFinite);
  return rowTimes.length > 0 ? Math.max(...rowTimes) : Date.parse(section.lastUpdated ?? "");
}

export function sectionQuality(section: MarketSplitDisplaySection): 0 | 1 | 2 {
  if (section.rows.length !== 2 || section.rows[0]!.side === section.rows[1]!.side) return 0;
  const completeMoney = complementary(section.rows.map((row) => row.moneyPct));
  const completeBets = complementary(section.rows.map((row) => row.betsPct));
  return completeMoney && completeBets ? 2 : completeMoney || completeBets ? 1 : 0;
}

function complementary(values: Array<number | null>): boolean {
  return values.length === 2 && values.every((value) => value !== null && Number.isFinite(value) && value >= 0 && value <= 100) &&
    Math.abs(values[0]! + values[1]! - 100) <= 1;
}

function cloneRetainedSection(section: MarketSplitDisplaySection): MarketSplitDisplaySection {
  return {
    label: section.label,
    sourceBook: section.sourceBook ?? null,
    sourceObservedAt: validTimestamp(section.sourceObservedAt) ?? latestSectionTimestamp(section),
    signal: null,
    lastUpdated: null,
    rows: section.rows.map((row) => ({
      side: row.side,
      label: row.label,
      moneyPct: row.moneyPct,
      betsPct: row.betsPct,
      observedAt: null,
      freshnessCheckedAt: null,
      isStale: false,
    })),
  };
}

function latestSectionTimestamp(section: MarketSplitDisplaySection): string | null {
  const values = [
    section.lastUpdated,
    ...section.rows.flatMap((row) => [row.freshnessCheckedAt, row.observedAt]),
  ]
    .map(validTimestamp)
    .filter((value): value is string => value !== null)
    .sort();
  return values.at(-1) ?? null;
}

function cloneRetainedGame(game: RetainedGame): RetainedGame {
  return {
    ...game,
    markets: Object.fromEntries(Object.entries(game.markets).map(([key, section]) => [
      key,
      cloneRetainedSection(section),
    ])) as RetainedGame["markets"],
  };
}

function retainedGameMatches(candidate: RetainedGame, game: DailyEdgeGameDto): boolean {
  if (normalize(candidate.awayTeam) !== normalize(game.awayTeam) || normalize(candidate.homeTeam) !== normalize(game.homeTeam)) return false;
  if (candidate.gameId === String(game.id)) return true;
  const currentStart = validTimestamp(game.gameStartAt);
  return candidate.gameStartAt !== null && currentStart !== null && candidate.gameStartAt === currentStart;
}

function retainedGamesMatch(first: RetainedGame, second: RetainedGame): boolean {
  if (first.gameId === second.gameId) return true;
  return normalize(first.awayTeam) === normalize(second.awayTeam)
    && normalize(first.homeTeam) === normalize(second.homeTeam)
    && first.gameStartAt !== null
    && first.gameStartAt === second.gameStartAt;
}

function retainedSortKey(game: RetainedGame): string {
  return `${game.gameStartAt ?? ""}::${normalize(game.awayTeam)}::${normalize(game.homeTeam)}::${game.gameId}`;
}

function validateFeed(value: unknown, sport: Sport, slateDate: string): SharpBookSplitContinuityFeed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const feed = value as Partial<SharpBookSplitContinuityFeed>;
  if (feed.release !== CONTINUITY_RELEASE || feed.sport !== sport || feed.slateDate !== slateDate || !Array.isArray(feed.games)) return null;
  return feed as SharpBookSplitContinuityFeed;
}

function feedsEqual(first: SharpBookSplitContinuityFeed | null, second: SharpBookSplitContinuityFeed): boolean {
  return first !== null && JSON.stringify(first) === JSON.stringify(second);
}

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const __TEST__ = { captureFeed, preferredSection, preferredActiveSection, retainedGameMatches };
