import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { Sport } from "@/lib/types/domain/Sport";
import { normalizeMlbTeamName } from "@/lib/providers/real_api/_teamNameNormalizer";
import { cfbTeamIdentity } from "@/lib/services/football/cfbTeamIdentity";
import { unstable_cache } from "next/cache";

const DRAFTKINGS_NETWORK_SPLITS_URL =
  "https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/";
const DRAFTKINGS_NETWORK_REVALIDATE_SECONDS = 5 * 60;
// The complete-feed cache keeps normal member reads fast. Give its cold fill
// enough time for both provider pages to finish from the production region;
// the prior 3.5s ceiling repeatedly returned only page one for the MLB slate.
const DRAFTKINGS_NETWORK_TIMEOUT_MS = 6_000;
const DRAFTKINGS_NETWORK_PAGE_SIZE = 10;
const DRAFTKINGS_NETWORK_CACHE_TAG = "draftkings-network-splits-complete";

type DraftKingsNetworkSport =
  | "MLB"
  | "NFL"
  | "NCAA Football"
  | "NBA"
  | "NCAA Basketball"
  | "NHL"
  | "WNBA"
  | "Champions League";

type DraftKingsNetworkMarket = "moneyline" | "spread" | "total";

export type DraftKingsNetworkSplitSide = {
  label: string;
  moneyPct: number;
  betsPct: number;
};

export type DraftKingsNetworkSplitMarket = {
  market: DraftKingsNetworkMarket;
  sides: [DraftKingsNetworkSplitSide, DraftKingsNetworkSplitSide];
};

export type DraftKingsNetworkSplitGame = {
  providerEventId: string;
  awayName: string;
  homeName: string;
  monthDay: string;
  markets: Partial<Record<DraftKingsNetworkMarket, DraftKingsNetworkSplitMarket>>;
};

export type DraftKingsNetworkSplitFeed = {
  source: "draftkings_network";
  sport: DraftKingsNetworkSport;
  fetchedAt: string;
  games: DraftKingsNetworkSplitGame[];
};

export type DraftKingsNetworkOverlayResult = {
  matchedGames: number;
  populatedMarkets: number;
};

const SPORT_EVENT_GROUP: Partial<Record<Sport, DraftKingsNetworkSport>> = {
  mlb: "MLB",
  nfl: "NFL",
  cfb: "NCAA Football",
  nba: "NBA",
  cbb: "NCAA Basketball",
  nhl: "NHL",
  wnba: "WNBA",
  ucl: "Champions League",
};

const SPORT_PAGE_CAP: Partial<Record<Sport, number>> = {
  mlb: 3,
  nfl: 4,
  cfb: 12,
  nba: 4,
  cbb: 12,
  nhl: 4,
  wnba: 3,
  ucl: 8,
};

const NFL_PROVIDER_ALIASES: Record<string, readonly string[]> = {
  ARI: ["arizona cardinals", "ari cardinals"], ATL: ["atlanta falcons", "atl falcons"],
  BAL: ["baltimore ravens", "bal ravens"], BUF: ["buffalo bills", "buf bills"],
  CAR: ["carolina panthers", "car panthers"], CHI: ["chicago bears", "chi bears"],
  CIN: ["cincinnati bengals", "cin bengals"], CLE: ["cleveland browns", "cle browns"],
  DAL: ["dallas cowboys", "dal cowboys"], DEN: ["denver broncos", "den broncos"],
  DET: ["detroit lions", "det lions"], GB: ["green bay packers", "gb packers"],
  HOU: ["houston texans", "hou texans"], IND: ["indianapolis colts", "ind colts"],
  JAX: ["jacksonville jaguars", "jax jaguars"], KC: ["kansas city chiefs", "kc chiefs"],
  LAC: ["los angeles chargers", "la chargers", "lac chargers"],
  LAR: ["los angeles rams", "la rams", "lar rams"],
  LV: ["las vegas raiders", "lv raiders"], MIA: ["miami dolphins", "mia dolphins"],
  MIN: ["minnesota vikings", "min vikings"], NE: ["new england patriots", "ne patriots"],
  NO: ["new orleans saints", "no saints"], NYG: ["new york giants", "ny giants", "nyg giants"],
  NYJ: ["new york jets", "ny jets", "nyj jets"], PHI: ["philadelphia eagles", "phi eagles"],
  PIT: ["pittsburgh steelers", "pit steelers"], SEA: ["seattle seahawks", "sea seahawks"],
  SF: ["san francisco 49ers", "sf 49ers"], TB: ["tampa bay buccaneers", "tb buccaneers"],
  TEN: ["tennessee titans", "ten titans"], WSH: ["washington commanders", "was commanders", "wsh commanders"],
};

const CFB_PROVIDER_ALIASES: Record<string, readonly string[]> = {
  APP: ["appalachian state", "app state"],
  CONN: ["connecticut", "uconn"],
  MIA: ["miami fl", "miami florida"],
  "M-OH": ["miami oh", "miami ohio"],
  NCST: ["nc state", "north carolina state"],
  NCSU: ["nc state", "north carolina state"],
  UL: ["louisiana", "louisiana lafayette"],
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchDraftKingsNetworkSplits(args: {
  sport: Sport;
  fetchImpl?: FetchLike;
  now?: Date;
  timeoutMs?: number;
}): Promise<DraftKingsNetworkSplitFeed | null> {
  const eventGroup = SPORT_EVENT_GROUP[args.sport];
  if (!eventGroup) return null;
  const fetchImpl = args.fetchImpl ?? fetch;
  const deadline = Date.now() + (args.timeoutMs ?? DRAFTKINGS_NETWORK_TIMEOUT_MS);
  const fetchPage = async (page: number) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("DraftKings Network split fetch deadline exceeded");
    const url = new URL(DRAFTKINGS_NETWORK_SPLITS_URL);
    url.searchParams.set("tb_eg", eventGroup);
    url.searchParams.set("itm_content", eventGroup);
    url.searchParams.set("tb_edate", args.sport === "nfl" || args.sport === "cfb" || args.sport === "cbb" || args.sport === "ucl" ? "n7days" : "today");
    url.searchParams.set("tb_emt", "0");
    url.searchParams.set("tb_page", String(page));
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Oddsphere-Daily-Edge/1.0",
      },
      // One overall deadline covers both pagination waves, so a slow provider
      // can never stack multiple full timeouts onto the member board load.
      signal: AbortSignal.timeout(Math.max(1, remainingMs)),
      next: { revalidate: DRAFTKINGS_NETWORK_REVALIDATE_SECONDS },
    } as RequestInit & { next: { revalidate: number } });
    if (!response.ok) throw new Error(`DraftKings Network splits page ${page} HTTP ${response.status}`);
    const responseDate = response.headers.get("date");
    const html = await response.text();
    // The WordPress shell can return HTTP 200 while its sportsbook-data
    // request failed with 403. Treat that as an upstream failure rather than
    // caching an apparently successful empty slate as the complete fallback.
    if (/Unable to fetch data from server\.\s*403/i.test(html)) {
      throw new Error(`DraftKings Network splits page ${page} embedded upstream HTTP 403`);
    }
    return {
      fetchedAt: responseDate ? new Date(responseDate).toISOString() : (args.now ?? new Date()).toISOString(),
      games: parseDraftKingsNetworkSplitsHtml(html),
    };
  };
  const initial = await Promise.allSettled([fetchPage(1), fetchPage(2)]);
  const failedInitialPage = initial.find((result) => result.status === "rejected");
  if (failedInitialPage?.status === "rejected") throw failedInitialPage.reason;
  const initialPages = initial.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (initialPages.length !== 2) throw new Error("DraftKings Network split seed pages incomplete");
  const firstSignature = pageSignature(initialPages[0]?.games ?? []);
  const secondSignature = pageSignature(initialPages[1]?.games ?? []);
  const pageCap = SPORT_PAGE_CAP[args.sport] ?? 2;
  const needsRemainingPages = initialPages.length === 2
    && initialPages[1]!.games.length >= DRAFTKINGS_NETWORK_PAGE_SIZE
    && firstSignature !== secondSignature;
  const remaining = needsRemainingPages && pageCap > 2
    ? await Promise.allSettled(Array.from({ length: pageCap - 2 }, (_, index) => fetchPage(index + 3)))
    : [];
  const failedRemainingPage = remaining.find((result) => result.status === "rejected");
  if (failedRemainingPage?.status === "rejected") throw failedRemainingPage.reason;
  const pages = [
    ...initialPages,
    ...remaining.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
  ];
  const games = Array.from(new Map(
    pages.flatMap((page) => page.games).map((game) => [game.providerEventId, game] as const),
  ).values());
  const fetchedAt = pages.map((page) => page.fetchedAt).sort().at(-1) ?? (args.now ?? new Date()).toISOString();
  return {
    source: "draftkings_network",
    sport: eventGroup,
    fetchedAt,
    games,
  };
}

// Cache only a fully collected feed. A partial pagination wave must throw so
// Next keeps serving the previous successful value across requests and
// deployments instead of replacing a complete slate with a one-page subset.
const readCachedDraftKingsNetworkSplits = unstable_cache(
  async (sport: Sport) => fetchDraftKingsNetworkSplits({ sport }),
  ["draftkings-network-splits-complete-v1"],
  {
    revalidate: DRAFTKINGS_NETWORK_REVALIDATE_SECONDS,
    tags: [DRAFTKINGS_NETWORK_CACHE_TAG],
  },
);

export function parseDraftKingsNetworkSplitsHtml(html: string): DraftKingsNetworkSplitGame[] {
  const starts = Array.from(html.matchAll(/<div\s+class="tb-se(?:\s[^"]*)?"[^>]*>/gi));
  const games: DraftKingsNetworkSplitGame[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!.index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const title = block.match(/<div\s+class="[^"]*\btb-se-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div\s+class="tb-market-wrap|$)/i)?.[1]
      ?? block.slice(0, Math.min(block.length, 2_500));
    const eventLink = title.match(/href="[^"]*\/event\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const matchup = cleanHtmlText(eventLink?.[2] ?? "");
    const teams = matchup.match(/^(.+?)\s+(?:@|vs\.?|v\.)\s+(.+)$/i);
    const monthDay = cleanHtmlText(title.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
      .match(/^(\d{1,2}\/\d{1,2})\b/)?.[1] ?? "";
    if (!eventLink?.[1] || !teams?.[1] || !teams[2] || !monthDay) continue;

    const markets: DraftKingsNetworkSplitGame["markets"] = {};
    const marketHeaders = Array.from(block.matchAll(/<div\s+class="tb-se-head(?:\s[^"]*)?"[^>]*>/gi));
    for (let marketIndex = 0; marketIndex < marketHeaders.length; marketIndex += 1) {
      const header = marketHeaders[marketIndex]!;
      const marketStart = header.index ?? 0;
      const marketEnd = marketHeaders[marketIndex + 1]?.index ?? block.length;
      const marketBlock = block.slice(marketStart, marketEnd);
      const firstSideIndex = marketBlock.search(/<div\s+class="tb-sm(?:\s[^"]*)?"[^>]*>/i);
      const market = marketFromLabel(cleanHtmlText(firstSideIndex < 0 ? marketBlock : marketBlock.slice(0, firstSideIndex)));
      if (!market) continue;
      const sideStarts = Array.from(marketBlock.matchAll(/<div\s+class="tb-sodd(?:\s[^"]*)?"[^>]*>/gi));
      const sides: DraftKingsNetworkSplitSide[] = [];
      for (let sideIndex = 0; sideIndex < sideStarts.length; sideIndex += 1) {
        const sideStart = sideStarts[sideIndex]!.index ?? 0;
        const sideEnd = sideStarts[sideIndex + 1]?.index ?? marketBlock.length;
        const sideBlock = marketBlock.slice(sideStart, sideEnd);
        const label = cleanHtmlText(sideBlock.match(/<div\s+class="[^"]*\btb-slipline\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
        const percentages = Array.from(sideBlock.matchAll(/<div\s+class="flex-1"[^>]*>\s*(\d{1,3})%/gi))
          .map((match) => Number(match[1]));
        const moneyPct = percentages[0];
        const betsPct = percentages[1];
        if (!label || !validPercentage(moneyPct) || !validPercentage(betsPct)) continue;
        sides.push({ label, moneyPct, betsPct });
      }
      if (sides.length === 2 && complementary(sides[0]!.moneyPct, sides[1]!.moneyPct) && complementary(sides[0]!.betsPct, sides[1]!.betsPct)) {
        markets[market] = { market, sides: [sides[0]!, sides[1]!] };
      }
    }
    if (Object.keys(markets).length === 0) continue;
    games.push({
      providerEventId: eventLink[1],
      awayName: cleanHtmlText(teams[1]),
      homeName: cleanHtmlText(teams[2]),
      monthDay,
      markets,
    });
  }
  return games;
}

export function applyDraftKingsNetworkSplitFallback(
  response: DailyEdgeResponse,
  feed: DraftKingsNetworkSplitFeed | null,
): DraftKingsNetworkOverlayResult {
  if (!feed) return { matchedGames: 0, populatedMarkets: 0 };
  let matchedGames = 0;
  let populatedMarkets = 0;
  const claimedProviderEvents = new Set<string>();
  for (const game of response.games) {
    const matches = feed.games.filter((candidate) =>
      !claimedProviderEvents.has(candidate.providerEventId) &&
      candidate.monthDay === gameMonthDay(game, response.date) &&
      providerTeamMatches(response.sport, candidate.awayName, game.awayTeam, game.awayTeamDisplayName) &&
      providerTeamMatches(response.sport, candidate.homeName, game.homeTeam, game.homeTeamDisplayName)
    );
    if (matches.length !== 1) continue;
    const match = matches[0]!;
    claimedProviderEvents.add(match.providerEventId);
    matchedGames += 1;
    populatedMarkets += attachMarketFallback(game, "moneyline", match.markets.moneyline, feed.fetchedAt);
    populatedMarkets += attachMarketFallback(game, "total", match.markets.total, feed.fetchedAt);
    if (response.sport !== "mlb" && response.sport !== "soccer" && response.sport !== "ucl") {
      populatedMarkets += attachMarketFallback(game, "first_inning", match.markets.spread, feed.fetchedAt);
    }
  }
  return { matchedGames, populatedMarkets };
}

export async function populateDailyEdgeDraftKingsFallback(
  response: DailyEdgeResponse,
  sport: Sport,
): Promise<DraftKingsNetworkOverlayResult> {
  try {
    return applyDraftKingsNetworkSplitFallback(
      response,
      await readCachedDraftKingsNetworkSplits(sport),
    );
  } catch (error) {
    console.warn(`DraftKings Network split fallback skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { matchedGames: 0, populatedMarkets: 0 };
  }
}

function attachMarketFallback(
  game: DailyEdgeGameDto,
  slot: keyof DailyEdgeGameDto["markets"],
  source: DraftKingsNetworkSplitMarket | undefined,
  fetchedAt: string,
): 0 | 1 {
  const market = game.markets[slot];
  if (!market || !source) return 0;
  const section = splitSection(game, source, fetchedAt);
  if (!section) return 0;
  const existing = market.sportsbookSplits;
  // The display-only hierarchy is Circa (held separately in sharpBookSplits),
  // then DraftKings, then another complete approved named book. A current
  // DraftKings row already in the DTO wins by freshness; a lower-priority
  // BetMGM row is replaced by this independently verified DraftKings pair.
  if (
    existing &&
    existing.label !== "BetMGM Splits" &&
    sectionIsSameAgeOrNewer(existing, fetchedAt)
  ) return 0;
  market.sportsbookSplits = section;
  return 1;
}

function splitSection(
  game: DailyEdgeGameDto,
  source: DraftKingsNetworkSplitMarket,
  fetchedAt: string,
): MarketSplitDisplaySection | null {
  const rows = source.sides.flatMap((side) => {
    const canonicalSide = source.market === "total"
      ? /^over\b/i.test(side.label) ? "over" as const : /^under\b/i.test(side.label) ? "under" as const : null
      : providerTeamMatches(game.sport, side.label, game.homeTeam, game.homeTeamDisplayName)
        ? "home" as const
        : providerTeamMatches(game.sport, side.label, game.awayTeam, game.awayTeamDisplayName)
          ? "away" as const
          : null;
    if (!canonicalSide) return [];
    return [{
      side: canonicalSide,
      label: canonicalSide === "home" ? game.homeTeam : canonicalSide === "away" ? game.awayTeam : canonicalSide === "over" ? "Over" : "Under",
      moneyPct: side.moneyPct,
      betsPct: side.betsPct,
      observedAt: fetchedAt,
      freshnessCheckedAt: fetchedAt,
      staleAfterMinutes: 15,
      isStale: false,
    }];
  });
  if (rows.length !== 2 || rows[0]!.side === rows[1]!.side) return null;
  return { label: "DraftKings Splits", rows, signal: null, lastUpdated: fetchedAt };
}

function sectionIsSameAgeOrNewer(section: MarketSplitDisplaySection, incomingAt: string): boolean {
  const existingAt = Date.parse(section.lastUpdated ?? "");
  const nextAt = Date.parse(incomingAt);
  return Number.isFinite(existingAt) && Number.isFinite(nextAt) && existingAt >= nextAt;
}

function marketFromLabel(label: string): DraftKingsNetworkMarket | null {
  const normalized = label.toLowerCase();
  if (normalized.includes("moneyline")) return "moneyline";
  if (normalized.includes("run line") || normalized.includes("spread")) return "spread";
  if (normalized.includes("total")) return "total";
  return null;
}

function providerTeamMatches(
  sport: Sport,
  providerName: string,
  abbreviation: string,
  displayName?: string | null,
): boolean {
  if (sport === "mlb") {
    const provider = normalizeMlbTeamName(providerName);
    const target = normalizeMlbTeamName(abbreviation) ?? normalizeMlbTeamName(displayName ?? "");
    if (provider !== null && target !== null) return provider === target;
    const providerTokens = new Set(cleanName(providerName).split(" "));
    return target !== null && providerTokens.has(cleanName(target));
  }
  const provider = cleanName(providerName).replace(/\s+\d+(?:\s+\d+)*$/, "");
  const abbr = cleanName(abbreviation);
  const identityDisplay = sport === "cfb" ? cfbTeamIdentity(abbreviation)?.displayName ?? "" : "";
  const display = cleanName(displayName ?? identityDisplay);
  if (!provider || !abbr) return false;
  if (sport === "nfl") {
    return [abbreviation, ...(NFL_PROVIDER_ALIASES[abbreviation.toUpperCase()] ?? [])]
      .some((alias) => providerIdentityMatches(provider, cleanName(alias)));
  }
  if (sport === "cfb") {
    const aliases = CFB_PROVIDER_ALIASES[abbreviation.toUpperCase()] ?? [];
    if (aliases.some((alias) => providerIdentityMatches(provider, cleanName(alias)))) return true;
  }
  const providerTokens = new Set(provider.split(" "));
  if (provider === abbr || providerTokens.has(abbr)) return true;
  if (
    display &&
    (
      provider === display ||
      display.startsWith(`${provider} `) ||
      provider.startsWith(`${display} `) ||
      provider.endsWith(` ${lastToken(display)}`)
    )
  ) return true;
  return provider.endsWith(` ${lastToken(abbr)}`);
}

function providerIdentityMatches(provider: string, identity: string): boolean {
  return identity.length > 0 && (provider === identity || provider.startsWith(`${identity} `));
}

function gameMonthDay(game: DailyEdgeGameDto, slateDate: string): string {
  const value = game.gameStartAt ?? `${slateDate}T12:00:00Z`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
  }).format(parsed);
}

function cleanHtmlText(value: string | undefined): string {
  return decodeHtml(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&minus;|&#8722;/gi, "−")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lastToken(value: string): string {
  return value.split(" ").at(-1) ?? "";
}

function validPercentage(value: number | undefined): value is number {
  // This independently verified pair is presentation-only: it is never fed
  // into recommendationDecision, grading, or tracking. Preserve provider-
  // reported endpoint percentages when both sides form a coherent 100% pair
  // so a real DraftKings fallback does not disappear from the member card.
  // Decision-grade source-aware evidence retains its stricter endpoint guard.
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100;
}

function complementary(first: number, second: number): boolean {
  return Math.abs(first + second - 100) <= 1;
}

function pageSignature(games: DraftKingsNetworkSplitGame[]): string {
  return games.map((game) => game.providerEventId).sort().join("|");
}

export const __TEST__ = { providerTeamMatches, gameMonthDay };
