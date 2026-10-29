import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookOdds,
  normalizeOwlsNamedBookOdds,
  type NormalizedOwlsNamedPrice,
  type RawOwlsOddsResponse,
} from "@/lib/providers/owls/owlsSharpBookOdds";
import {
  normalizeOwlsSharpBookSplits,
  type NormalizedOwlsSplitObservation,
  type RawOwlsSplitsResponse,
} from "@/lib/providers/owls/owlsSharpBookSplits";
import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import { cfbProviderTeamMatches } from "./cfbProviderTeamIdentity";
import {
  CFB_OWLS_SPLITS_RELEASE,
  type CfbSharpApiSplitRecord,
  type CfbSharpApiSplitSide,
} from "./cfbSharpApiSplits";

export const CFB_OWLS_PROVIDER_RELEASE =
  "cfb_owls_provider_2026_10_29_r2_grade_price_ingestion" as const;

// Conventional named books only. Exchanges (Novig/SX/Kalshi) never cast votes.
export const CFB_OWLS_GRADE_BOOKS = [
  "fanduel", "draftkings", "caesars", "betmgm", "fanatics", "betrivers",
  "circa", "pinnacle", "betr", "stations", "wynn", "southpoint", "bovada",
  "betonline", "ballybet", "thescorebet", "bet365",
] as const;
const EXECUTION_BOOKS = new Set<string>(["fanduel", "draftkings", "caesars", "betmgm", "fanatics", "betrivers"]);

export type CfbOwlsProviderResult = {
  release: typeof CFB_OWLS_PROVIDER_RELEASE;
  requests: 2;
  oddsEvents: number;
  splitEvents: number;
  matchedOddsGames: number;
  matchedSplitGames: number;
  booksByGame: Record<string, NcaafBookOdds[]>;
  /** Grade-only input: never feed into the model, reader, or opening history. */
  gradeBooksByGame: Record<string, NcaafBookOdds[]>;
  splitRecordsByGame: Record<string, CfbSharpApiSplitRecord[]>;
  rejected: string[];
};

export async function fetchCfbOwlsProvider(args: {
  games: NcaafGame[];
  apiKey?: string;
  client?: Pick<OwlsInsightClient, "odds" | "splits">;
}): Promise<CfbOwlsProviderResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  const key = args.apiKey ?? process.env.OWLS_INSIGHT_API_KEY;
  if (!key && !args.client) throw new Error("OWLS_INSIGHT_API_KEY is required for CFB Owls capture.");
  const client = args.client ?? new OwlsInsightClient(key!);
  const [oddsResponse, splitsResponse] = await Promise.all([
    client.odds<RawOwlsOddsResponse>("ncaaf"),
    client.splits<RawOwlsSplitsResponse>("ncaaf"),
  ]);
  return mapCfbOwlsProvider({ games, odds: oddsResponse.body, splits: splitsResponse.body });
}

export function mapCfbOwlsProvider(args: {
  games: NcaafGame[];
  odds: RawOwlsOddsResponse;
  splits: RawOwlsSplitsResponse;
}): CfbOwlsProviderResult {
  const odds = normalizeOwlsSharpBookOdds(args.odds, "ncaaf");
  const gradeOdds = normalizeOwlsNamedBookOdds(args.odds, "ncaaf", CFB_OWLS_GRADE_BOOKS);
  const splits = normalizeOwlsSharpBookSplits(args.splits, "ncaaf");
  const rejected = [
    ...odds.rejected.map((row) => `odds ${row.providerEventId ?? "unknown"}: ${row.reason}`),
    ...gradeOdds.rejected.map((row) => `grade odds ${row.providerEventId ?? "unknown"} ${row.sportsbook ?? "unknown"}: ${row.reason}`),
    ...splits.rejected.map((reason) => `splits: ${reason}`),
  ];
  const booksByGame = Object.fromEntries(args.games.map((game) => [game.providerGameId, [] as NcaafBookOdds[]]));
  const gradeBooksByGame = Object.fromEntries(args.games.map((game) => [game.providerGameId, [] as NcaafBookOdds[]]));
  const splitRecordsByGame = Object.fromEntries(args.games.map((game) => [game.providerGameId, [] as CfbSharpApiSplitRecord[]]));

  const pricesByEvent = groupBy(odds.prices, (row) => row.providerEventId);
  for (const [providerEventId, prices] of pricesByEvent) {
    const game = matchGame(args.games, {
      providerEventId,
      homeTeam: prices[0]!.homeTeam,
      awayTeam: prices[0]!.awayTeam,
      scheduledStart: prices[0]!.scheduledStart,
    });
    if (!game) {
      rejected.push(`odds ${providerEventId}: unmatched or ambiguous CFB game`);
      continue;
    }
    booksByGame[game.providerGameId] = buildBooks(game, providerEventId, prices);
  }

  const gradeEventsByGame = new Map<string, Array<{ eventId: string; prices: NormalizedOwlsNamedPrice[] }>>();
  for (const [eventId, prices] of groupBy(gradeOdds.prices, row => row.providerEventId)) {
    const matches = prices.map(row => matchGame(args.games, {
      providerEventId: eventId, homeTeam: row.homeTeam, awayTeam: row.awayTeam, scheduledStart: row.scheduledStart,
    }));
    const game = matches[0];
    if (!game || matches.some((matched, index) => matched?.providerGameId !== game.providerGameId ||
      !prices[index]!.scheduledStart ||
      Math.abs(Date.parse(prices[index]!.scheduledStart!) - Date.parse(game.scheduledStart)) > 5 * 60_000)) {
      rejected.push(`grade odds ${eventId}: ambiguous identity or kickoff mismatch`);
      continue;
    }
    gradeEventsByGame.set(game.providerGameId, [...(gradeEventsByGame.get(game.providerGameId) ?? []), { eventId, prices }]);
  }
  for (const [gameId, events] of gradeEventsByGame) {
    if (events.length !== 1) {
      rejected.push(`grade odds ${gameId}: multiple provider events for canonical game`);
      continue;
    }
    const event = events[0]!;
    const pairs = [...groupBy(event.prices, row => `${row.sportsbook}:${row.market}`).values()].flatMap(rows => {
      const latest = rows.map(row => row.observedAt).sort().at(-1);
      // Repeated event-per-book rows are common. Deduplicate identical observations,
      // reject conflicting pairs at the same source timestamp rather than vote twice.
      const pair = [...new Map(rows.filter(row => row.observedAt === latest)
        .map(row => [JSON.stringify([row.side, row.line, row.americanPrice]), row])).values()];
      const hold = pair.reduce((sum, row) => sum + 1 / row.decimalPrice, 0);
      const valid = pair.length === 2 && pair.every(row => Math.abs(row.americanPrice) >= 100 &&
        (row.market !== "total" || (row.line !== null && row.line > 0))) && hold >= 1 && hold <= 1.2;
      if (!valid) rejected.push(`grade odds ${event.eventId} ${rows[0]!.sportsbook}: invalid or conflicting ${rows[0]!.market} pair`);
      return valid ? pair : [];
    });
    gradeBooksByGame[gameId] = buildBooks(args.games.find(game => game.providerGameId === gameId)!, event.eventId, pairs)
      .map(book => ({ ...book, targetEligible: EXECUTION_BOOKS.has(book.sportsbook) }));
  }

  const splitsByEvent = groupBy(splits.observations, (row) => row.providerEventId);
  for (const [providerEventId, observations] of splitsByEvent) {
    const game = matchGame(args.games, {
      providerEventId,
      homeTeam: observations[0]!.homeTeam,
      awayTeam: observations[0]!.awayTeam,
      scheduledStart: null,
    });
    if (!game) {
      rejected.push(`splits ${providerEventId}: unmatched or ambiguous CFB game`);
      continue;
    }
    splitRecordsByGame[game.providerGameId] = buildSplitRecords(game, providerEventId, observations);
  }

  return {
    release: CFB_OWLS_PROVIDER_RELEASE,
    requests: 2,
    oddsEvents: odds.eventsReturned,
    splitEvents: splits.eventCount,
    matchedOddsGames: Object.values(booksByGame).filter((rows) => rows.length > 0).length,
    matchedSplitGames: Object.values(splitRecordsByGame).filter((rows) => rows.length > 0).length,
    booksByGame,
    gradeBooksByGame,
    splitRecordsByGame,
    rejected,
  };
}

function buildBooks(
  game: NcaafGame,
  providerEventId: string,
  prices: NormalizedOwlsNamedPrice[],
): NcaafBookOdds[] {
  return [...new Set(prices.map((row) => row.sportsbook))].flatMap((sportsbook) => {
    const rows = prices.filter((row) => row.sportsbook === sportsbook);
    const pair = (market: "moneyline" | "spread" | "total") => rows.filter((row) => row.market === market);
    const moneyline = pair("moneyline");
    const spread = pair("spread");
    const total = pair("total");
    const marketObservedAt = Object.fromEntries((["moneyline", "spread", "total"] as const).flatMap((market) => {
      const marketRows = pair(market);
      return marketRows.length === 2 ? [[market, marketRows[0]!.observedAt]] : [];
    }));
    const observedAt = Object.values(marketObservedAt).sort().at(-1);
    if (!observedAt) return [];
    const bySide = (rowsForMarket: NormalizedOwlsNamedPrice[], side: string) =>
      rowsForMarket.find((row) => row.side === side);
    const homeMl = bySide(moneyline, "home");
    const awayMl = bySide(moneyline, "away");
    const homeSpread = bySide(spread, "home");
    const awaySpread = bySide(spread, "away");
    const over = bySide(total, "over");
    const under = bySide(total, "under");
    return [{
      providerGameId: game.providerGameId,
      sportsbook,
      observedAt,
      provider: "owls",
      providerEventId,
      targetEligible: false,
      marketReadingEligible: false,
      marketSelection: Object.fromEntries(Object.keys(marketObservedAt).map((market) => [market, "main_line"])),
      marketObservedAt,
      moneyline: homeMl && awayMl ? { homePrice: homeMl.americanPrice, awayPrice: awayMl.americanPrice } : null,
      spread: homeSpread && awaySpread && homeSpread.line !== null && awaySpread.line !== null ? {
        homeLine: homeSpread.line,
        homePrice: homeSpread.americanPrice,
        awayLine: awaySpread.line,
        awayPrice: awaySpread.americanPrice,
      } : null,
      total: over && under && over.line !== null ? {
        line: over.line,
        overPrice: over.americanPrice,
        underPrice: under.americanPrice,
      } : null,
    } satisfies NcaafBookOdds];
  }).sort((a, b) => a.sportsbook.localeCompare(b.sportsbook));
}

/** Per-market, same-book primary precedence; never splice provider provenance. */
export function cfbOwlsGradeMarketBooks(args: {
  primary: NcaafBookOdds[];
  supplemental: NcaafBookOdds[];
  providerGameId: string;
  market: "moneyline" | "spread" | "total";
  evaluatedAt: string;
  gameStartsAt: string;
}): NcaafBookOdds[] {
  const evaluation = Date.parse(args.evaluatedAt);
  const kickoff = Date.parse(args.gameStartsAt);
  if (!Number.isFinite(evaluation) || !Number.isFinite(kickoff) || evaluation >= kickoff) return [];
  const selected = new Map<string, NcaafBookOdds>();
  for (const book of [...args.primary, ...args.supplemental]) {
    const key = book.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "");
    const observed = Date.parse(book.marketObservedAt?.[args.market] ?? book.observedAt);
    if (book.providerGameId !== args.providerGameId || !book[args.market] || !key || selected.has(key) ||
      !Number.isFinite(observed) || observed > evaluation || observed >= kickoff || evaluation - observed > 60 * 60_000) continue;
    selected.set(key, book);
  }
  return [...selected.values()];
}

function buildSplitRecords(
  game: NcaafGame,
  providerEventId: string,
  observations: NormalizedOwlsSplitObservation[],
): CfbSharpApiSplitRecord[] {
  return [...new Set(observations.map((row) => row.sourceBook))].flatMap((sportsbook) => {
    const rows = observations.filter((row) => row.sourceBook === sportsbook && row.complete);
    const pair = (market: "moneyline" | "spread" | "total") => {
      const marketRows = rows.filter((row) => row.market === market);
      return marketRows.length === 2 && marketRows[0]!.observedAt === marketRows[1]!.observedAt
        ? marketRows
        : [];
    };
    const moneyline = pair("moneyline");
    const spread = pair("spread");
    const total = pair("total");
    const capturedAt = [...moneyline, ...spread, ...total].map((row) => row.observedAt).sort().at(-1);
    if (!capturedAt) return [];
    const side = (marketRows: NormalizedOwlsSplitObservation[], name: string): CfbSharpApiSplitSide | null => {
      const row = marketRows.find((candidate) => candidate.side === name);
      return row?.betsPct === null || row?.betsPct === undefined || row.moneyPct === null
        ? null
        : { ticketsPct: row.betsPct * 100, moneyPct: row.moneyPct * 100 };
    };
    const awayMl = side(moneyline, "away");
    const homeMl = side(moneyline, "home");
    const awaySpread = side(spread, "away");
    const homeSpread = side(spread, "home");
    const over = side(total, "over");
    const under = side(total, "under");
    const awaySpreadRow = spread.find((row) => row.side === "away");
    const homeSpreadRow = spread.find((row) => row.side === "home");
    const totalRow = total[0];
    return [{
      release: CFB_OWLS_SPLITS_RELEASE,
      provider: "owls",
      providerGameId: game.providerGameId,
      providerEventId,
      sportsbook,
      sourceSemantics: sportsbook === "circa" ? "sharp_adjacent" : "public_recreational",
      capturedAt,
      moneyline: awayMl && homeMl ? { away: awayMl, home: homeMl } : null,
      spread: awaySpread && homeSpread && awaySpreadRow?.line !== null && awaySpreadRow?.line !== undefined && homeSpreadRow?.line !== null && homeSpreadRow?.line !== undefined ? {
        awayLine: awaySpreadRow.line,
        homeLine: homeSpreadRow.line,
        away: awaySpread,
        home: homeSpread,
      } : null,
      total: over && under && totalRow?.line !== null && totalRow?.line !== undefined ? {
        line: totalRow.line,
        over,
        under,
      } : null,
    } satisfies CfbSharpApiSplitRecord];
  }).sort((a, b) => a.sportsbook.localeCompare(b.sportsbook));
}

function matchGame(
  games: NcaafGame[],
  event: { providerEventId: string; homeTeam: string; awayTeam: string; scheduledStart: string | null },
): NcaafGame | null {
  const eventDate = event.scheduledStart?.slice(0, 10) ?? providerEventDate(event.providerEventId);
  const matches = games.filter((game) => {
    const teamMatch = cfbProviderTeamMatches({ observed: event.homeTeam, expectedName: game.home.name, abbreviation: game.home.abbreviation }) &&
      cfbProviderTeamMatches({ observed: event.awayTeam, expectedName: game.away.name, abbreviation: game.away.abbreviation });
    if (!teamMatch || !eventDate) return teamMatch;
    return acceptedGameDates(game.scheduledStart).has(eventDate);
  });
  return matches.length === 1 ? matches[0]! : null;
}

function providerEventDate(value: string): string | null {
  const match = value.match(/(?:-|_)(\d{4})-?(\d{2})-?(\d{2})(?:\D|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function acceptedGameDates(scheduledStart: string): Set<string> {
  const instant = new Date(scheduledStart);
  return new Set([
    scheduledStart.slice(0, 10),
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant),
  ]);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

export const __TEST__ = { providerEventDate, matchGame };
