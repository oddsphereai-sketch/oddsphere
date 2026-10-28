import type { OwlsSport } from "./owlsInsightClient";

export type OwlsSplitBook = "circa" | "draftkings" | "betmgm";
export type OwlsSplitMarket = "moneyline" | "spread" | "total";
export type OwlsSplitSide = "home" | "away" | "over" | "under";

type RawMarket = Record<string, unknown>;

export type RawOwlsSplit = {
  book?: unknown;
  title?: unknown;
  as_of?: unknown;
  moneyline?: RawMarket | null;
  spread?: RawMarket | null;
  total?: RawMarket | null;
};

export type RawOwlsSplitGame = {
  event_id?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  splits?: RawOwlsSplit[] | null;
};

export type RawOwlsSplitsResponse = {
  sport?: unknown;
  data?: RawOwlsSplitGame[] | null;
  meta?: {
    source?: unknown;
    books?: unknown;
    total_games?: unknown;
    status?: unknown;
    partial_reason?: unknown;
    as_of?: unknown;
  } | null;
};

export type NormalizedOwlsSplitObservation = {
  provider: "owls";
  providerEventId: string;
  sport: Exclude<OwlsSport, "soccer">;
  homeTeam: string;
  awayTeam: string;
  sourceBook: OwlsSplitBook;
  sourceType: "sharp_adjacent_book" | "retail_book" | "retail_ticket_share";
  market: OwlsSplitMarket;
  side: OwlsSplitSide;
  line: number | null;
  price: number | null;
  betsPct: number | null;
  moneyPct: number | null;
  observedAt: string;
  complete: boolean;
};

export type OwlsSplitCoverage = {
  feedStatus: "ok" | "partial" | "unknown";
  partialReason: string | null;
  advertisedBooks: OwlsSplitBook[];
  eventCount: number;
  observations: NormalizedOwlsSplitObservation[];
  rejected: string[];
};

const BOOK_ALIASES: Record<string, OwlsSplitBook> = {
  circa: "circa",
  dk: "draftkings",
  draftkings: "draftkings",
  betmgm: "betmgm",
};

const MARKET_SIDES: Record<OwlsSplitMarket, readonly OwlsSplitSide[]> = {
  moneyline: ["away", "home"],
  spread: ["away", "home"],
  total: ["over", "under"],
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  const parsed = number(value);
  if (parsed === null || parsed < 0 || parsed > 100) return null;
  return parsed / 100;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function book(value: unknown): OwlsSplitBook | null {
  const normalized = text(value)?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  return BOOK_ALIASES[normalized] ?? null;
}

function sourceType(
  value: OwlsSplitBook,
  hasTickets: boolean,
  hasMoney: boolean,
): NormalizedOwlsSplitObservation["sourceType"] {
  if (value === "circa") return "sharp_adjacent_book";
  if (hasTickets && !hasMoney) return "retail_ticket_share";
  // The persisted source type describes book provenance. A money-only retail
  // pair remains `retail_book`; betsPct=NULL is the explicit axis mask.
  if (!hasTickets && hasMoney) return "retail_book";
  return "retail_book";
}

function sideFields(market: OwlsSplitMarket, side: OwlsSplitSide): {
  line: string | null;
  price: string | null;
  bets: string;
  money: string;
} {
  if (market === "moneyline") {
    return { line: null, price: `${side}_price`, bets: `${side}_bets_pct`, money: `${side}_handle_pct` };
  }
  if (market === "spread") {
    return { line: `${side}_line`, price: null, bets: `${side}_bets_pct`, money: `${side}_handle_pct` };
  }
  return { line: "line", price: null, bets: `${side}_bets_pct`, money: `${side}_handle_pct` };
}

function opposingPercentagesAreValid(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a + b - 1) <= 0.03;
}

function normalizeFeedStatus(value: unknown): OwlsSplitCoverage["feedStatus"] {
  return value === "ok" || value === "partial" ? value : "unknown";
}

export function normalizeOwlsSharpBookSplits(
  response: RawOwlsSplitsResponse,
  expectedSport: Exclude<OwlsSport, "soccer">,
): OwlsSplitCoverage {
  const observations: NormalizedOwlsSplitObservation[] = [];
  const rejected: string[] = [];
  const rows = Array.isArray(response.data) ? response.data : [];
  const responseSport = text(response.sport)?.toLowerCase() ?? null;

  if (responseSport !== null && responseSport !== expectedSport) {
    return {
      feedStatus: normalizeFeedStatus(response.meta?.status),
      partialReason: text(response.meta?.partial_reason),
      advertisedBooks: [],
      eventCount: rows.length,
      observations: [],
      rejected: [`response sport ${responseSport} does not match requested sport ${expectedSport}`],
    };
  }

  for (const game of rows) {
    const providerEventId = text(game.event_id);
    const homeTeam = text(game.home_team);
    const awayTeam = text(game.away_team);
    if (!providerEventId || !homeTeam || !awayTeam) {
      rejected.push("game missing event_id or team identity");
      continue;
    }
    for (const rawSplit of Array.isArray(game.splits) ? game.splits : []) {
      const sourceBook = book(rawSplit.book);
      const observedAt = timestamp(rawSplit.as_of);
      if (!sourceBook || !observedAt) {
        rejected.push(`${providerEventId}: split missing supported book or valid as_of`);
        continue;
      }
      for (const market of Object.keys(MARKET_SIDES) as OwlsSplitMarket[]) {
        const rawMarket = rawSplit[market];
        if (!rawMarket || typeof rawMarket !== "object") continue;
        const parsedRows = MARKET_SIDES[market].map((side) => {
          const fields = sideFields(market, side);
          const betsPct = percent(rawMarket[fields.bets]);
          const moneyPct = percent(rawMarket[fields.money]);
          return {
            side,
            line: fields.line ? number(rawMarket[fields.line]) : null,
            price: fields.price ? number(rawMarket[fields.price]) : null,
            betsPct,
            moneyPct,
          };
        });
        const hasTickets = parsedRows.every((row) => row.betsPct !== null);
        const hasMoney = parsedRows.every((row) => row.moneyPct !== null);
        const marketRows = parsedRows.map((row) => ({
          provider: "owls" as const,
          providerEventId,
          sport: expectedSport,
          homeTeam,
          awayTeam,
          sourceBook,
          sourceType: sourceType(sourceBook, hasTickets, hasMoney),
          market,
          ...row,
          observedAt,
          complete: row.betsPct !== null && row.moneyPct !== null,
        } satisfies NormalizedOwlsSplitObservation));
        if (
          !opposingPercentagesAreValid(marketRows[0]?.betsPct ?? null, marketRows[1]?.betsPct ?? null) ||
          !opposingPercentagesAreValid(marketRows[0]?.moneyPct ?? null, marketRows[1]?.moneyPct ?? null)
        ) {
          rejected.push(`${providerEventId}: ${sourceBook} ${market} opposing percentages do not sum to 100%`);
          continue;
        }
        observations.push(...marketRows.filter((row) => row.betsPct !== null || row.moneyPct !== null));
      }
    }
  }

  const advertisedBooks = (Array.isArray(response.meta?.books) ? response.meta?.books : [])
    .map(book)
    .filter((value): value is OwlsSplitBook => value !== null);

  return {
    feedStatus: normalizeFeedStatus(response.meta?.status),
    partialReason: text(response.meta?.partial_reason),
    advertisedBooks: [...new Set(advertisedBooks)],
    eventCount: rows.length,
    observations,
    rejected,
  };
}

export function selectCompleteNamedBookSplit(
  observations: readonly NormalizedOwlsSplitObservation[],
  opts: {
    providerEventId: string;
    market: OwlsSplitMarket;
    nowMs?: number;
    maxAgeMs?: number;
  },
): NormalizedOwlsSplitObservation[] {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60 * 1000;
  for (const sourceBook of ["circa", "draftkings", "betmgm"] as const) {
    const pair = observations.filter((row) =>
      row.providerEventId === opts.providerEventId &&
      row.market === opts.market &&
      row.sourceBook === sourceBook &&
      row.complete &&
      nowMs - Date.parse(row.observedAt) >= -5 * 60 * 1000 &&
      nowMs - Date.parse(row.observedAt) <= maxAgeMs,
    );
    if (pair.length === 2 && pair[0]?.observedAt === pair[1]?.observedAt) return pair;
  }
  return [];
}

/**
 * Retain every fresh, complete named-book pair for internal market reading.
 *
 * This is deliberately different from `selectCompleteNamedBookSplit`, which
 * chooses one preferred pair for the member-facing display. Collapsing Circa,
 * DraftKings, and BetMGM into that display choice would erase the cross-book
 * agreement/conflict evidence needed by the Market Brain.
 */
export function selectAllCompleteNamedBookSplits(
  observations: readonly NormalizedOwlsSplitObservation[],
  opts: {
    providerEventId: string;
    market: OwlsSplitMarket;
    nowMs?: number;
    maxAgeMs?: number;
  },
): NormalizedOwlsSplitObservation[] {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60 * 1000;
  const expectedSides = MARKET_SIDES[opts.market];
  const rows = observations.filter((row) => {
    const ageMs = nowMs - Date.parse(row.observedAt);
    return row.providerEventId === opts.providerEventId &&
      row.market === opts.market &&
      row.complete &&
      ageMs >= -5 * 60 * 1000 &&
      ageMs <= maxAgeMs;
  });
  const groups = new Map<string, NormalizedOwlsSplitObservation[]>();
  for (const row of rows) {
    const key = `${row.sourceBook}\u0000${row.observedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const priority = new Map<OwlsSplitBook, number>([
    ["circa", 0], ["draftkings", 1], ["betmgm", 2],
  ]);
  return [...groups.values()]
    .filter((pair) => pair.length === 2 && expectedSides.every((side) =>
      pair.some((row) => row.side === side)))
    .sort((a, b) =>
      (priority.get(a[0]!.sourceBook) ?? 99) - (priority.get(b[0]!.sourceBook) ?? 99) ||
      a[0]!.observedAt.localeCompare(b[0]!.observedAt))
    .flatMap((pair) => expectedSides.map((side) => pair.find((row) => row.side === side)!));
}

/**
 * Retain every source-book pair that is truthful internal evidence.
 *
 * Complete money-plus-ticket pairs remain unchanged. Coherent named-book pairs
 * with exactly one available axis are additionally retained with the other
 * axis null. They are not eligible for the member-facing complete-pair selector
 * above and cannot be reinterpreted as money-minus-ticket divergence.
 */
export function selectAllInternalNamedBookSplits(
  observations: readonly NormalizedOwlsSplitObservation[],
  opts: {
    providerEventId: string;
    market: OwlsSplitMarket;
    nowMs?: number;
    maxAgeMs?: number;
  },
): NormalizedOwlsSplitObservation[] {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60 * 1000;
  const expectedSides = MARKET_SIDES[opts.market];
  const rows = observations.filter((row) => {
    const ageMs = nowMs - Date.parse(row.observedAt);
    return row.providerEventId === opts.providerEventId &&
      row.market === opts.market &&
      ageMs >= -5 * 60 * 1000 &&
      ageMs <= maxAgeMs;
  });
  const groups = new Map<string, NormalizedOwlsSplitObservation[]>();
  for (const row of rows) {
    const key = `${row.sourceBook}\u0000${row.observedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const priority = new Map<OwlsSplitBook, number>([
    ["circa", 0], ["draftkings", 1], ["betmgm", 2],
  ]);
  return [...groups.values()]
    .filter((pair) => {
      if (pair.length !== 2 || !expectedSides.every((side) =>
        pair.some((row) => row.side === side))) return false;
      if (pair.every((row) => row.complete)) return true;
      const ticketOnly = pair.every((row) => row.betsPct !== null && row.moneyPct === null);
      const moneyOnly = pair.every((row) => row.betsPct === null && row.moneyPct !== null);
      return ticketOnly || moneyOnly;
    })
    .sort((a, b) =>
      (priority.get(a[0]!.sourceBook) ?? 99) - (priority.get(b[0]!.sourceBook) ?? 99) ||
      a[0]!.observedAt.localeCompare(b[0]!.observedAt))
    .flatMap((pair) => expectedSides.map((side) => pair.find((row) => row.side === side)!));
}
