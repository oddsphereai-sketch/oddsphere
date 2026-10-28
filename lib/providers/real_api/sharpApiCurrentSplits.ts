import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { normalizeMlbTeamName } from "@/lib/providers/real_api/_teamNameNormalizer";
import { normalizeNhlTeamName } from "@/lib/providers/nhl/_teamNameNormalizer";
import { fetchOwlsCurrentSplitRows } from "@/lib/providers/owls/owlsCurrentSplits";
import { normalizeTeamAbbr } from "@/lib/providers/playbook/playbookTeamNormalizer";
import { cfbProviderTeamMatches } from "@/lib/services/football/cfbProviderTeamIdentity";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { Sport } from "@/lib/types/domain/Sport";
import { unstable_cache } from "next/cache";

const OWLS_CURRENT_SPLITS_RELEASE = "owls_current_splits_2026_10_27_r1_complete_named_book" as const;
const CURRENT_SPLITS_RELEASE = "sharpapi_current_splits_2026_10_12_r2_cfb_central_team_identity" as const;
const PREVIOUS_CURRENT_SPLITS_RELEASE = "sharpapi_current_splits_2026_09_20_r1_durable_overlay" as const;
const CURRENT_SPLITS_TTL_MS = 5 * 60 * 1000;
const CURRENT_SPLITS_STALE_MS = 10 * 24 * 60 * 60 * 1000;
const CURRENT_SPLITS_TIMEOUT_MS = 4_000;
const SOURCE_FAILOVER_GRACE_MS = 3 * 60 * 60 * 1000;
const MAX_OBSERVATIONS_PER_EVENT_BOOK = 96;

type Json = Record<string, unknown>;
type SupportedSport = Exclude<Sport, "soccer" | "ucl">;
type SplitMarket = "moneyline" | "spread" | "total";
type NamedBook = "circa" | "draftkings" | "consensus" | "betmgm";

type SharpApiCurrentSplitFeed = {
  source: "owls_current_splits" | "sharpapi_current_splits";
  release: typeof OWLS_CURRENT_SPLITS_RELEASE | typeof CURRENT_SPLITS_RELEASE | typeof PREVIOUS_CURRENT_SPLITS_RELEASE;
  sport: SupportedSport;
  fetchedAt: string;
  rows: Json[];
};

export type SharpApiCurrentSplitOverlayResult = {
  matchedGames: number;
  populatedMarkets: number;
};

export type SharpApiCurrentSplitOverlayOptions = {
  /**
   * A locked payload stays authoritative. This opt-in may fill only a field
   * that was never stored, from an exact-game observation no later than the
   * immutable lock instant. It never updates the locked decision or reader.
   */
  reconstructMissingLockedPreLock?: boolean;
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

const BOOK_PRIORITY: readonly NamedBook[] = ["circa", "draftkings", "consensus", "betmgm"];

const BOOK_LABEL: Record<NamedBook, MarketSplitDisplaySection["label"]> = {
  circa: "Sharp Book Splits",
  draftkings: "Sharp Book Splits",
  // SharpAPI emits `consensus` when every contributing source publishes the
  // same row. It is a synthetic merge, not a fourth book, and belongs in the
  // existing Sharp Book Splits panel rather than a new member-facing label.
  consensus: "Sharp Book Splits",
  betmgm: "Sharp Book Splits",
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

function snapshotKey(
  sport: SupportedSport,
  release: typeof OWLS_CURRENT_SPLITS_RELEASE | typeof CURRENT_SPLITS_RELEASE | typeof PREVIOUS_CURRENT_SPLITS_RELEASE = OWLS_CURRENT_SPLITS_RELEASE,
): string {
  return release === OWLS_CURRENT_SPLITS_RELEASE
    ? `daily-edge::named-book-current-splits::${sport}::${release}`
    : `daily-edge::sharpapi-current-splits::${sport}::${release}`;
}

function supportedSport(sport: Sport): sport is SupportedSport {
  return sport !== "soccer" && sport !== "ucl";
}

const readCachedCurrentSplits = unstable_cache(
  async (sport: SupportedSport) => readDurableCurrentSplits(sport),
  ["owls-current-splits-durable-overlay-v3-single-axis-display"],
  { revalidate: 5 * 60, tags: ["owls-current-splits"] },
);

async function readDurableCurrentSplits(
  sport: SupportedSport,
  options: { forceProviderFetch?: boolean; requireProviderSuccess?: boolean } = {},
): Promise<SharpApiCurrentSplitFeed | null> {
  const { readLabResponseSnapshot, readLatestLabResponseSnapshot, upsertLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
  const key = snapshotKey(sport);
  if (!options.forceProviderFetch) {
    const fresh = await readLabResponseSnapshot<Record<string, unknown>>(key, "fresh");
    const validatedFresh = validateSharpApiCurrentSplitFeed(fresh?.payload, sport);
    if (validatedFresh) return validatedFresh;
  }
  const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(key);
  const previousStored = stored;
  const validatedStored = validateSharpApiCurrentSplitFeed(previousStored?.payload, sport);

  const owlsApiKey = process.env.OWLS_INSIGHT_API_KEY;
  if (owlsApiKey) {
    try {
      const owls = await fetchOwlsCurrentSplitRows({ sport, apiKey: owlsApiKey, timeoutMs: CURRENT_SPLITS_TIMEOUT_MS });
      if (owls.rows.length > 0) {
        const current: SharpApiCurrentSplitFeed = {
          source: "owls_current_splits",
          release: OWLS_CURRENT_SPLITS_RELEASE,
          sport,
          fetchedAt: owls.fetchedAt,
          rows: owls.rows,
        };
        const feed = mergeCurrentSplitFeeds(validatedStored, current);
        await upsertLabResponseSnapshot({
          snapshotKey: key,
          kind: "daily_edge",
          payload: feed as unknown as Record<string, unknown>,
          ttlMs: CURRENT_SPLITS_TTL_MS,
          staleMs: CURRENT_SPLITS_STALE_MS,
          sport,
          source: "owls_current_splits",
          payloadVersion: OWLS_CURRENT_SPLITS_RELEASE,
        });
        return feed;
      }
    } catch (error) {
      console.warn(`Owls current split overlay fetch failed for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
      if (options.requireProviderSuccess) throw error;
    }
  } else if (options.requireProviderSuccess) {
    throw new Error("OWLS_INSIGHT_API_KEY is not configured");
  }

  return validatedStored;
}

export async function readStoredSharpApiCurrentSplits(
  sport: Sport,
): Promise<SharpApiCurrentSplitFeed | null> {
  if (!supportedSport(sport)) return null;
  const { readLatestLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
  const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(snapshotKey(sport));
  return validateSharpApiCurrentSplitFeed(stored?.payload, sport);
}

export async function restoreStoredCompleteSharpApiCurrentSplitDisplay(
  response: DailyEdgeResponse,
  sport: Sport,
): Promise<number> {
  if (!supportedSport(sport)) return 0;
  const feed = await readStoredSharpApiCurrentSplits(sport);
  return restoreCompleteSharpApiCurrentSplitDisplay(response, feed);
}

export async function refreshOwlsCurrentSplitFallback(sport: Sport): Promise<number> {
  if (!supportedSport(sport)) return 0;
  const feed = await readDurableCurrentSplits(sport, {
    forceProviderFetch: true,
    requireProviderSuccess: true,
  });
  return feed?.rows.length ?? 0;
}

export async function refreshCachedOwlsCurrentSplitFallback(sport: Sport): Promise<number> {
  if (!supportedSport(sport)) return 0;
  const feed = await readCachedCurrentSplits(sport);
  return feed?.rows.length ?? 0;
}

/** @deprecated Use the provider-accurate Owls name for new callers. */
export async function refreshSharpApiCurrentSplitFallback(sport: Sport): Promise<number> {
  return refreshCachedOwlsCurrentSplitFallback(sport);
}

export function validateSharpApiCurrentSplitFeed(
  value: unknown,
  sport: SupportedSport,
): SharpApiCurrentSplitFeed | null {
  if (!isRecord(value)) return null;
  const fetchedAt = timestamp(value.fetchedAt);
  if (
    !(
      (value.source === "owls_current_splits" && value.release === OWLS_CURRENT_SPLITS_RELEASE) ||
      (value.source === "sharpapi_current_splits" && (value.release === CURRENT_SPLITS_RELEASE || value.release === PREVIOUS_CURRENT_SPLITS_RELEASE))
    ) ||
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
  options: SharpApiCurrentSplitOverlayOptions = {},
): Promise<SharpApiCurrentSplitOverlayResult> {
  if (!supportedSport(sport)) return { matchedGames: 0, populatedMarkets: 0 };
  try {
    return applySharpApiCurrentSplitOverlay(response, await readCachedCurrentSplits(sport), Date.now(), options);
  } catch (error) {
    console.warn(`SharpAPI current split overlay skipped for ${sport}: ${error instanceof Error ? error.message : String(error)}`);
    return { matchedGames: 0, populatedMarkets: 0 };
  }
}

export function applySharpApiCurrentSplitOverlay(
  response: DailyEdgeResponse,
  feed: SharpApiCurrentSplitFeed | null,
  nowMs = Date.now(),
  options: SharpApiCurrentSplitOverlayOptions = {},
): SharpApiCurrentSplitOverlayResult {
  if (!feed || response.sport !== feed.sport) return { matchedGames: 0, populatedMarkets: 0 };
  let matchedGames = 0;
  let populatedMarkets = 0;
  for (const game of response.games) {
    const lockedCutoffMs = game.lockState === "locked" && options.reconstructMissingLockedPreLock
      ? Date.parse(game.lockedAt ?? "")
      : null;
    if (game.lockState === "locked" && !Number.isFinite(lockedCutoffMs)) continue;
    const candidates = feed.rows.filter((row) => rowMatchesGame(row, game, response.date, feed.sport));
    if (candidates.length === 0) continue;
    matchedGames += 1;
    populatedMarkets += attachBestMarket(game, "moneyline", "moneyline", candidates, nowMs, lockedCutoffMs);
    populatedMarkets += attachBestMarket(game, "total", "total", candidates, nowMs, lockedCutoffMs);
    if (feed.sport !== "mlb") {
      populatedMarkets += attachBestMarket(game, "first_inning", "spread", candidates, nowMs, lockedCutoffMs);
    }
  }
  return { matchedGames, populatedMarkets };
}

/**
 * Recover the newest complete exact-game observation from the durable provider
 * history for member display only. This runs after the market-reader bridge,
 * so an older retained pair can never enter the canonical decision. Locked
 * records remain owned by the explicit pre-lock reconstruction path.
 */
export function restoreCompleteSharpApiCurrentSplitDisplay(
  response: DailyEdgeResponse,
  feed: SharpApiCurrentSplitFeed | null,
): number {
  if (!feed || response.sport !== feed.sport) return 0;
  let restored = 0;
  for (const game of response.games) {
    if (game.lockState === "locked") continue;
    const candidates = feed.rows.filter((row) => rowMatchesGame(row, game, response.date, feed.sport));
    if (candidates.length === 0) continue;
    const markets: Array<[keyof DailyEdgeGameDto["markets"], SplitMarket]> = [
      ["moneyline", "moneyline"],
      ["total", "total"],
    ];
    if (feed.sport !== "mlb") markets.push(["first_inning", "spread"]);
    for (const [slot, sourceMarket] of markets) {
      const market = game.markets[slot];
      if (!market) continue;
      const displayedComplete = [
        market.sportsbookSplits ?? null,
        market.recommendationDecision?.sharpBookSplits ?? null,
      ].some((section) => section !== null && sectionQuality(section) === 2);
      if (displayedComplete) continue;
      const section = newestCompleteSection(game, sourceMarket, candidates);
      if (!section) continue;
      market.sportsbookSplits = section;
      restored += 1;
    }
  }
  return restored;
}

function newestCompleteSection(
  game: DailyEdgeGameDto,
  market: SplitMarket,
  candidates: Json[],
): MarketSplitDisplaySection | null {
  for (const book of BOOK_PRIORITY) {
    const sections = candidates
      .filter((row) => normalize(text(row.sportsbook) ?? "") === book)
      .map((row) => sectionFromRow(game, market, book, row))
      .filter((section): section is MarketSplitDisplaySection => section !== null && sectionQuality(section) === 2)
      .sort((first, second) => sectionSourceTimestamp(second) - sectionSourceTimestamp(first));
    if (sections[0]) return sections[0];
  }
  return null;
}

/**
 * Presentation-only response cleanup for any retained named-book section,
 * including writer-captured Circa rows that predate the durable overlays.
 * The authoritative source timestamp remains in its stored snapshot/feed;
 * member responses keep only the values and established source label.
 */
export function sanitizeRetainedSharpSplitPresentation(response: DailyEdgeResponse): number {
  let sanitized = 0;
  for (const game of response.games) {
    for (const market of Object.values(game.markets)) {
      if (!market) continue;
      const sections = [
        market.sportsbookSplits ?? null,
        market.recommendationDecision?.sharpBookSplits ?? null,
      ];
      for (const section of sections) {
        if (!section?.rows.length) continue;
        if (section.evidenceContext === "locked_prelock_reconstruction") {
          // This timestamp is the proof that the separately rendered field
          // existed before the immutable lock. Never make it look live.
          for (const row of section.rows) row.isStale = false;
          sanitized += 1;
          continue;
        }
        section.lastUpdated = null;
        for (const row of section.rows) {
          row.observedAt = null;
          row.freshnessCheckedAt = null;
          delete row.staleAfterMinutes;
          row.isStale = false;
        }
        sanitized += 1;
      }
      if (market.recommendationDecision?.sharpBookSplits?.rows.length) {
        // A complete retained section is the presentation authority. Remove
        // an older availability warning so the reader cannot render stale or
        // historical copy beside the preserved values.
        market.sharpBookAvailability = null;
      }
    }
  }
  return sanitized;
}

function attachBestMarket(
  game: DailyEdgeGameDto,
  slot: keyof DailyEdgeGameDto["markets"],
  sourceMarket: SplitMarket,
  candidates: Json[],
  nowMs: number,
  lockedCutoffMs: number | null = null,
): 0 | 1 {
  const market = game.markets[slot];
  if (!market) return 0;
  if (
    lockedCutoffMs !== null &&
    (market.sportsbookSplits?.rows.length || market.recommendationDecision?.sharpBookSplits?.rows.length)
  ) return 0;
  const sections = BOOK_PRIORITY.flatMap((book) => {
    const rows = dedupeBookRows(
      candidates.filter((row) => normalize(text(row.sportsbook) ?? "") === book),
      sourceMarket,
      lockedCutoffMs,
    );
    if (rows.length !== 1) return [];
    const section = sectionFromRow(game, sourceMarket, book, rows[0]!);
    return section ? [section] : [];
  });
  // Freshness still controls internal source selection, but it does not
  // create a member-facing stale state. A current lower-priority fallback can
  // therefore remain until the preferred book publishes a current update.
  // Prefer a book that reports both axes, but do not erase a truthful paired
  // ticket-only or money-only observation when that is all the provider has.
  // The member renderer already labels a missing axis "not reported". The
  // market-reader bridge below still requires quality 2, so a quality-1
  // display row cannot silently become decision evidence.
  const usable = sections.filter((section) =>
    sectionQuality(section) > 0 &&
    (lockedCutoffMs === null || sectionSourceTimestamp(section) <= lockedCutoffMs)
  );
  const complete = usable.filter((section) => sectionQuality(section) === 2);
  const eligible = complete.length > 0 ? complete : usable;
  const current = eligible.filter((section) => sectionIsFreshAt(section, nowMs));
  const selected = lockedCutoffMs === null
    ? current[0] ?? eligible.sort((a, b) => sectionSourceTimestamp(b) - sectionSourceTimestamp(a))[0]
    : eligible[0];
  if (!selected) return 0;

  const selectedForDisplay = lockedCutoffMs === null
    ? selected
    : preLockReconstruction(selected);

  const existing = market.sportsbookSplits;
  let populated: 0 | 1 = 0;
  if (!existing || lockedCutoffMs === null && shouldReplace(existing, selectedForDisplay, nowMs)) {
    market.sportsbookSplits = selectedForDisplay;
    populated = 1;
  }

  // NHL may silently use a complete BetMGM retail split as the Public
  // Consensus fallback only when the Sharp Book panel is owned by a different
  // named book. Playbook remains authoritative whenever it populated the
  // public lane upstream. This keeps both panels useful without ever showing
  // one book/observation twice or inventing a blended consensus.
  if (game.sport === "nhl" && (market.publicSplits?.length ?? 0) === 0) {
    const publicRetail = sections.find((section) => section.sourceBook === "betmgm") ?? null;
    const finalSharpBook = market.sportsbookSplits?.sourceBook ?? null;
    if (publicRetail && finalSharpBook !== null && finalSharpBook !== publicRetail.sourceBook) {
      market.publicSplits = publicRetail.rows.map((row) => ({ ...row }));
      const selectedPublicRow = selectedPublicSplitRow(market, publicRetail);
      if (selectedPublicRow) {
        market.moneyPct = selectedPublicRow.moneyPct;
        market.betsPct = selectedPublicRow.betsPct;
      }
      populated = 1;
    }
  }
  return populated;
}

function preLockReconstruction(section: MarketSplitDisplaySection): MarketSplitDisplaySection {
  const observedAtMs = sectionSourceTimestamp(section);
  const observedAt = new Date(observedAtMs).toISOString();
  return {
    ...section,
    evidenceContext: "locked_prelock_reconstruction",
    lastUpdated: observedAt,
    rows: section.rows.map((row) => ({
      ...row,
      observedAt,
      freshnessCheckedAt: observedAt,
      isStale: false,
    })),
  };
}

function selectedPublicSplitRow(
  market: DailyEdgeGameDto["markets"][keyof DailyEdgeGameDto["markets"]],
  section: MarketSplitDisplaySection,
): MarketSplitDisplaySection["rows"][number] | null {
  if (!market) return null;
  const pick = (market.pick ?? "").trim().toUpperCase();
  if (!pick) return null;
  return section.rows.find((row) =>
    (row.side === "over" && pick.startsWith("OVER")) ||
    (row.side === "under" && pick.startsWith("UNDER")) ||
    ((row.side === "home" || row.side === "away") && pick.includes(row.label.trim().toUpperCase()))
  ) ?? null;
}

function dedupeBookRows(
  rows: Json[],
  market: SplitMarket,
  cutoffMs: number | null,
): Json[] {
  const newestByEvent = new Map<string, Json>();
  for (const row of rows) {
    const eventId = text(row.event_id);
    if (!eventId) continue;
    const observedAt = marketObservedAt(row, market);
    if (!Number.isFinite(observedAt) || cutoffMs !== null && observedAt > cutoffMs) continue;
    const existing = newestByEvent.get(eventId);
    if (!existing || observedAt > marketObservedAt(existing, market)) {
      newestByEvent.set(eventId, row);
    }
  }
  return [...newestByEvent.values()];
}

function marketObservedAt(row: Json, market: SplitMarket): number {
  return Date.parse(
    timestamp(record(row._oddsphere_market_fetched_at)[market]) ??
    timestamp(row.fetched_at) ??
    "",
  );
}

function sectionFromRow(
  game: DailyEdgeGameDto,
  market: SplitMarket,
  book: NamedBook,
  row: Json,
): MarketSplitDisplaySection | null {
  const fetchedAt = timestamp(record(row._oddsphere_market_fetched_at)[market]) ?? timestamp(row.fetched_at);
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
  const moneyComplete = firstMoney !== null && secondMoney !== null && complementary(firstMoney, secondMoney);
  const betsComplete = firstBets !== null && secondBets !== null && complementary(firstBets, secondBets);
  if (!moneyComplete && !betsComplete) return null;
  return {
    label: BOOK_LABEL[book],
    sourceBook: book,
    sourceObservedAt: fetchedAt,
    rows: [
      {
        side: market === "total" ? "over" : "away",
        label: market === "total" ? "Over" : game.awayTeam,
        moneyPct: moneyComplete ? firstMoney : null,
        betsPct: betsComplete ? firstBets : null,
        observedAt: null,
        freshnessCheckedAt: fetchedAt,
        // The exact-game fallback remains until a verified update replaces it.
        // Do not introduce a member-facing stale state, copy, badge, or label.
        isStale: false,
      },
      {
        side: market === "total" ? "under" : "home",
        label: market === "total" ? "Under" : game.homeTeam,
        moneyPct: moneyComplete ? secondMoney : null,
        betsPct: betsComplete ? secondBets : null,
        observedAt: null,
        freshnessCheckedAt: fetchedAt,
        isStale: false,
      },
    ],
    signal: null,
    lastUpdated: null,
  };
}

function mergeCurrentSplitFeeds(
  previous: SharpApiCurrentSplitFeed | null,
  current: SharpApiCurrentSplitFeed,
): SharpApiCurrentSplitFeed {
  if (!previous) return current;
  // Provider event identities are not interchangeable. Mixing legacy
  // SharpAPI and Owls rows for one matchup would create two same-book event
  // candidates and either suppress the current Circa row or risk a false
  // doubleheader match. Cross-provider continuity is owned by the exact-game
  // display snapshot; this feed stays single-provider.
  if (previous.source !== current.source) return current;
  const merged = new Map<string, Json>();
  for (const row of previous.rows) merged.set(splitObservationKey(row), row);
  for (const row of current.rows) {
    // Keep every provider observation intact. Copying a prior handle axis into
    // a newer ticket-only row made the resulting timestamp look current even
    // though half of the values were old. Historical complete observations
    // remain available separately, and the exact-game continuity layer owns
    // the bounded last-known-good display decision.
    merged.set(splitObservationKey(row), row);
  }
  return { ...current, rows: trimSplitHistory([...merged.values()]) };
}

function splitRowKey(row: Json): string {
  return `${text(row.event_id) ?? ""}::${normalize(text(row.sportsbook) ?? "")}`;
}

function splitObservationKey(row: Json): string {
  return `${splitRowKey(row)}::${timestamp(row.fetched_at) ?? ""}`;
}

function rowFetchedAt(row: Json): number {
  return Date.parse(timestamp(row.fetched_at) ?? "");
}

function trimSplitHistory(rows: Json[]): Json[] {
  const byEventBook = new Map<string, Json[]>();
  for (const row of rows) {
    const key = splitRowKey(row);
    if (!key.startsWith("::")) byEventBook.set(key, [...(byEventBook.get(key) ?? []), row]);
  }
  return [...byEventBook.values()].flatMap((history) => {
    const newestFirst = history.sort((first, second) => rowFetchedAt(second) - rowFetchedAt(first));
    const retained = newestFirst.slice(0, MAX_OBSERVATIONS_PER_EVENT_BOOK);
    const retainedKeys = new Set(retained.map(splitObservationKey));
    // A long ticket-only outage must not evict the last verified money+ticket
    // pair. Keep at most one additional complete observation per market so a
    // later member request can still recover the truthful last-known-good
    // section without combining axes from different timestamps.
    for (const market of ["moneyline", "spread", "total"] as const) {
      const complete = newestFirst.find((row) => rowHasCompleteMarketPair(row, market));
      if (!complete) continue;
      const key = splitObservationKey(complete);
      if (!retainedKeys.has(key)) {
        retained.push(complete);
        retainedKeys.add(key);
      }
    }
    return retained.sort((first, second) => rowFetchedAt(first) - rowFetchedAt(second));
  });
}

function rowHasCompleteMarketPair(row: Json, market: SplitMarket): boolean {
  const source = record(row[market]);
  const firstKey = market === "total" ? "over" : "away";
  const secondKey = market === "total" ? "under" : "home";
  const handle = record(source.handle_pct);
  const bets = record(source.bets_pct);
  const firstMoney = percentage(handle[firstKey]);
  const secondMoney = percentage(handle[secondKey]);
  const firstBets = percentage(bets[firstKey]);
  const secondBets = percentage(bets[secondKey]);
  return firstMoney !== null && secondMoney !== null && complementary(firstMoney, secondMoney) &&
    firstBets !== null && secondBets !== null && complementary(firstBets, secondBets);
}

function shouldReplace(
  existing: MarketSplitDisplaySection,
  incoming: MarketSplitDisplaySection,
  nowMs = Date.now(),
): boolean {
  const existingQuality = sectionQuality(existing);
  const incomingQuality = sectionQuality(incoming);
  const existingCurrent = sectionIsFreshAt(existing, nowMs);
  const incomingCurrent = sectionIsFreshAt(incoming, nowMs);
  if (existingCurrent !== incomingCurrent) return incomingCurrent;
  if (existingQuality !== incomingQuality) return incomingQuality > existingQuality;
  const priority = (label: MarketSplitDisplaySection["label"]) => {
    if (label === "Sharp Book Splits") return 0;
    if (label === "DraftKings Splits") return 1;
    if (label === "BetMGM Splits") return 2;
    return 3;
  };
  const sourcePriority = (section: MarketSplitDisplaySection) => {
    if (section.sourceBook === "circa") return 0;
    if (section.sourceBook === "draftkings" || section.sourceBook === "draftkings_network") return 1;
    if (section.sourceBook === "consensus") return 2;
    if (section.sourceBook === "betmgm") return 3;
    return priority(section.label);
  };
  const priorityDelta = sourcePriority(incoming) - sourcePriority(existing);
  if (priorityDelta !== 0) return priorityDelta < 0;
  const incomingAt = sectionSourceTimestamp(incoming);
  const existingAt = sectionSourceTimestamp(existing);
  return incomingAt > existingAt ||
    (incomingAt === existingAt && hasMemberFacingFreshnessState(existing));
}

function sectionQuality(section: MarketSplitDisplaySection): 0 | 1 | 2 {
  if (section.rows.length !== 2 || section.rows[0]!.side === section.rows[1]!.side) return 0;
  const money = section.rows.map((row) => row.moneyPct);
  const bets = section.rows.map((row) => row.betsPct);
  const moneyComplete = money.every((value) => value !== null) && complementary(money[0]!, money[1]!);
  const betsComplete = bets.every((value) => value !== null) && complementary(bets[0]!, bets[1]!);
  return moneyComplete && betsComplete ? 2 : moneyComplete || betsComplete ? 1 : 0;
}

function sectionIsFreshAt(section: MarketSplitDisplaySection, nowMs: number): boolean {
  const observedAt = sectionSourceTimestamp(section);
  return Number.isFinite(observedAt) &&
    nowMs - observedAt <= SOURCE_FAILOVER_GRACE_MS;
}

function sectionSourceTimestamp(section: MarketSplitDisplaySection): number {
  const internal = Date.parse(section.sourceObservedAt ?? "");
  if (Number.isFinite(internal)) return internal;
  const rowTimestamps = section.rows
    .map((row) => Date.parse(row.freshnessCheckedAt ?? row.observedAt ?? ""))
    .filter(Number.isFinite);
  return rowTimestamps.length > 0
    ? Math.max(...rowTimestamps)
    : Date.parse(section.lastUpdated ?? "");
}

function hasMemberFacingFreshnessState(section: MarketSplitDisplaySection): boolean {
  return section.lastUpdated !== null || section.rows.some((row) =>
    row.observedAt != null || row.staleAfterMinutes != null || row.isStale === true
  );
}

function rowMatchesGame(row: Json, game: DailyEdgeGameDto, slateDate: string, sport: SupportedSport): boolean {
  if (normalize(text(row.league) ?? "") !== normalize(LEAGUE_BY_SPORT[sport])) return false;
  const dates = acceptedDates(game.gameStartAt, slateDate);
  const startAt = timestamp(row.event_start_time);
  const rawEventId = text(row.event_id) ?? "";
  const dashedEventDate = rawEventId.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  const compactEventDate = rawEventId.match(/-(\d{4})(\d{2})(\d{2})(?:$|[-_])/);
  const eventDate = dashedEventDate ?? (compactEventDate
    ? `${compactEventDate[1]}-${compactEventDate[2]}-${compactEventDate[3]}`
    : null);
  if (startAt ? !dates.has(easternDate(startAt)) : !eventDate || !dates.has(eventDate)) return false;
  return teamMatches(sport, row.away_team, game.awayTeam, game.awayTeamDisplayName) &&
    teamMatches(sport, row.home_team, game.homeTeam, game.homeTeamDisplayName);
}

function acceptedDates(gameStartAt: string | null | undefined, slateDate: string): Set<string> {
  const dates = new Set<string>();
  if (gameStartAt && Number.isFinite(Date.parse(gameStartAt))) {
    dates.add(gameStartAt.slice(0, 10));
    dates.add(easternDate(gameStartAt));
  } else {
    // Legacy rows without a scheduled start can use the board date. Games
    // with an exact start must stay scoped to that event's UTC/Eastern dates;
    // a rolling multi-day board may contain the same matchup more than once.
    dates.add(slateDate);
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
  if (sport === "nhl") {
    const observed = normalizeNhlTeamName(raw);
    const expected = normalizeNhlTeamName(abbreviation) ?? normalizeNhlTeamName(displayName);
    return observed !== null && expected !== null && observed === expected;
  }
  if (sport === "cfb") {
    return cfbProviderTeamMatches({ observed: raw, abbreviation, expectedName: displayName });
  }
  if (sport === "nba" || sport === "wnba") {
    const observed = normalizeTeamAbbr(sport, raw);
    const expected = normalizeTeamAbbr(sport, abbreviation) ?? normalizeTeamAbbr(sport, displayName);
    return observed !== null && expected !== null && observed === expected;
  }
  const observed = normalizeTeam(raw);
  const aliases = [abbreviation, displayName ?? ""];
  if (sport === "nfl") aliases.push(...(NFL_ALIASES[abbreviation.toUpperCase()] ?? []));
  return aliases.some((alias) => {
    const expected = normalizeTeam(alias);
    return expected.length > 0 && observed === expected;
  });
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

export const __TEST__ = { rowMatchesGame, sectionFromRow, teamMatches, shouldReplace, sectionQuality, mergeCurrentSplitFeeds };
