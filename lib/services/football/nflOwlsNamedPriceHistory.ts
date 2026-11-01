import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";

export const NFL_OWLS_NAMED_PRICE_HISTORY_RELEASE =
  "nfl_owls_named_price_history_2026_10_31_r1_exact_paired_chronology" as const;

const PAGE_SIZE = 1000;
const MAX_PAGES = 64;
const BOOKS = ["circa", "pinnacle"] as const;
type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";

export type NflOwlsNamedPriceRow = {
  id: number;
  canonical_event_id: string;
  provider: string;
  provider_event_id: string | null;
  ingestion_run_id: string | null;
  sportsbook: string;
  market_type: string;
  selection_key: string;
  line: number | string | null;
  american_price: number | null;
  provider_timestamp: string | null;
  fetched_at: string;
};

export type NflOwlsNamedPriceHistory = {
  release: typeof NFL_OWLS_NAMED_PRICE_HISTORY_RELEASE;
  queries: number;
  rows: number;
  rejectedPairs: number;
  historyByGame: Record<string, Array<{ capturedAt: string; books: NflPreviewBookOdds[] }>>;
  earliestByGame: Record<string, NflPreviewBookOdds[]>;
  latestByGame: Record<string, NflPreviewBookOdds[]>;
};

/** Read the existing leased Owl's collector's append-only tape; no provider call or new writer. */
export async function readNflOwlsNamedPriceHistory(args: {
  client: SupabaseClient;
  gameIds: string[];
  evaluatedAt: string;
}): Promise<NflOwlsNamedPriceHistory> {
  const gameIds = [...new Set(args.gameIds)].filter(Boolean);
  if (gameIds.length === 0) return pairNflOwlsNamedPriceRows([], 0);
  const highWater = await args.client.from("market_price_observations_v2")
    .select("id")
    .eq("league", "nfl").eq("provider", "owls")
    .in("canonical_event_id", gameIds).in("sportsbook", [...BOOKS])
    .lte("fetched_at", args.evaluatedAt)
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (highWater.error) throw new Error(`NFL Owl's named price high-water read failed: ${highWater.error.message}`);
  const maximumId = Number(highWater.data?.id ?? 0);
  if (!maximumId) return pairNflOwlsNamedPriceRows([], 1);
  let lastId = 0;
  const rows: NflOwlsNamedPriceRow[] = [];
  let queries = 1;
  for (let page = 0; page < MAX_PAGES && lastId < maximumId; page++) {
    const result = await args.client.from("market_price_observations_v2")
      .select("id,canonical_event_id,provider,provider_event_id,ingestion_run_id,sportsbook,market_type,selection_key,line,american_price,provider_timestamp,fetched_at")
      .eq("league", "nfl").eq("provider", "owls")
      .in("canonical_event_id", gameIds).in("sportsbook", [...BOOKS])
      .lte("fetched_at", args.evaluatedAt)
      .gt("id", lastId).lte("id", maximumId)
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    queries++;
    if (result.error) throw new Error(`NFL Owl's named price page failed: ${result.error.message}`);
    const pageRows = (result.data ?? []) as NflOwlsNamedPriceRow[];
    if (pageRows.length === 0 || pageRows.some((row, index) =>
      !Number.isInteger(row.id) || row.id <= (index ? pageRows[index - 1]!.id : lastId))) {
      throw new Error("NFL Owl's named price history is truncated or out of order.");
    }
    rows.push(...pageRows);
    lastId = pageRows.at(-1)!.id;
    if (pageRows.length < PAGE_SIZE) break;
  }
  if (lastId < maximumId) throw new Error(`NFL Owl's named price history exceeded ${MAX_PAGES * PAGE_SIZE} rows.`);
  return pairNflOwlsNamedPriceRows(rows, queries);
}

/** Exact same-run, same-source-time two-sided pairs. No synthetic odds or opener. */
export function pairNflOwlsNamedPriceRows(
  rows: NflOwlsNamedPriceRow[], queries = 0,
): NflOwlsNamedPriceHistory {
  const grouped = new Map<string, NflOwlsNamedPriceRow[]>();
  for (const row of rows) {
    if (row.provider !== "owls" || !BOOKS.includes(row.sportsbook as typeof BOOKS[number]) ||
        !row.ingestion_run_id || !row.provider_event_id || !row.provider_timestamp ||
        !["moneyline", "spread", "total"].includes(row.market_type) ||
        !Number.isFinite(Date.parse(row.provider_timestamp)) ||
        !Number.isFinite(Date.parse(row.fetched_at))) continue;
    const key = [row.canonical_event_id, row.sportsbook, row.ingestion_run_id,
      row.provider_event_id, row.provider_timestamp, row.market_type].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  let rejectedPairs = 0;
  const paired = new Map<string, {
    gameId: string; sportsbook: string; runId: string; eventId: string;
    sourceAt: string; fetchedAt: string;
    markets: {
      moneyline?: NflPreviewBookOdds["moneyline"];
      spread?: NflPreviewBookOdds["spread"];
      total?: NflPreviewBookOdds["total"];
    };
  }>();
  for (const group of grouped.values()) {
    const first = group[0]!;
    const market = first.market_type as Market;
    const expectedSides: Side[] = market === "total" ? ["over", "under"] : ["away", "home"];
    const bySide = expectedSides.map((side) => group.filter((row) =>
      row.selection_key === `${first.canonical_event_id}:${market}:${side}`));
    if (bySide.some((sideRows) => sideRows.length !== 1)) { rejectedPairs++; continue; }
    const firstSide = bySide[0]![0]!;
    const secondSide = bySide[1]![0]!;
    const firstPrice = firstSide.american_price;
    const secondPrice = secondSide.american_price;
    const firstLine = numberOrNull(firstSide.line);
    const secondLine = numberOrNull(secondSide.line);
    if (!validPrice(firstPrice) || !validPrice(secondPrice) ||
        (market === "moneyline" && (firstLine !== null || secondLine !== null)) ||
        (market === "spread" && (firstLine === null || secondLine === null ||
          Math.abs(firstLine + secondLine) > 0.0001)) ||
        (market === "total" && (firstLine === null || secondLine === null ||
          Math.abs(firstLine - secondLine) > 0.0001))) {
      rejectedPairs++;
      continue;
    }
    const key = [first.canonical_event_id, first.sportsbook, first.ingestion_run_id,
      first.provider_event_id, first.provider_timestamp].join("|");
    const entry = paired.get(key) ?? {
      gameId: first.canonical_event_id,
      sportsbook: first.sportsbook,
      runId: first.ingestion_run_id!,
      eventId: first.provider_event_id!,
      sourceAt: first.provider_timestamp!,
      fetchedAt: first.fetched_at,
      markets: {},
    };
    entry.fetchedAt = latestTime(entry.fetchedAt, secondSide.fetched_at);
    if (market === "moneyline") entry.markets.moneyline = { awayPrice: firstPrice, homePrice: secondPrice };
    else if (market === "spread") entry.markets.spread = {
      awayLine: firstLine!, awayPrice: firstPrice, homeLine: secondLine!, homePrice: secondPrice,
    };
    else entry.markets.total = { line: firstLine!, overPrice: firstPrice, underPrice: secondPrice };
    paired.set(key, entry);
  }
  const historyByGame: NflOwlsNamedPriceHistory["historyByGame"] = {};
  const latestByGame: NflOwlsNamedPriceHistory["latestByGame"] = {};
  const earliestByGame: NflOwlsNamedPriceHistory["earliestByGame"] = {};
  const byGame = new Map<string, Array<{ fetchedAt: string; book: NflPreviewBookOdds }>>();
  for (const entry of paired.values()) {
    const book: NflPreviewBookOdds = {
      providerGameId: entry.gameId,
      providerEventId: entry.eventId,
      provider: "owls",
      sportsbook: entry.sportsbook,
      observedAt: entry.sourceAt,
      targetEligible: false,
      marketSelection: { moneyline: "main_line", spread: "main_line", total: "main_line" },
      marketObservedAt: Object.fromEntries(Object.keys(entry.markets).map((market) => [market, entry.sourceAt])),
      moneyline: entry.markets.moneyline ?? null,
      spread: entry.markets.spread ?? null,
      total: entry.markets.total ?? null,
    };
    byGame.set(entry.gameId, [...(byGame.get(entry.gameId) ?? []), { fetchedAt: entry.fetchedAt, book }]);
  }
  for (const [gameId, values] of byGame) {
    const sorted = [...values].sort((left, right) => Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt) ||
      Date.parse(left.book.observedAt) - Date.parse(right.book.observedAt));
    const byReceipt = new Map<string, NflPreviewBookOdds[]>();
    for (const value of sorted) byReceipt.set(value.fetchedAt,
      [...(byReceipt.get(value.fetchedAt) ?? []), value.book]);
    historyByGame[gameId] = [...byReceipt.entries()].map(([capturedAt, books]) => ({ capturedAt, books }));
    const selectEndpoint = (latest: boolean) => BOOKS.flatMap((sportsbook) => {
      const candidates = sorted.filter((item) => item.book.sportsbook === sportsbook);
      const endpoint = (market: Market) => {
        const eligible = candidates.filter((item) => item.book[market] !== null)
          .sort((left, right) => Date.parse(left.book.marketObservedAt?.[market] ?? left.book.observedAt) -
            Date.parse(right.book.marketObservedAt?.[market] ?? right.book.observedAt) ||
            Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt));
        return (latest ? eligible.at(-1) : eligible[0])?.book ?? null;
      };
      const ml = endpoint("moneyline");
      const spread = endpoint("spread");
      const total = endpoint("total");
      const observed = [ml, spread, total].filter((book): book is NflPreviewBookOdds => book !== null);
      if (observed.length === 0) return [];
      return [{
        ...observed[0]!,
        observedAt: observed.map((book) => book.observedAt)
          .sort((first, second) => Date.parse(second) - Date.parse(first))[0]!,
        marketObservedAt: {
          ...(ml ? { moneyline: ml.marketObservedAt?.moneyline ?? ml.observedAt } : {}),
          ...(spread ? { spread: spread.marketObservedAt?.spread ?? spread.observedAt } : {}),
          ...(total ? { total: total.marketObservedAt?.total ?? total.observedAt } : {}),
        },
        moneyline: ml?.moneyline ?? null,
        spread: spread?.spread ?? null,
        total: total?.total ?? null,
      }];
    });
    latestByGame[gameId] = selectEndpoint(true);
    earliestByGame[gameId] = selectEndpoint(false);
  }
  return {
    release: NFL_OWLS_NAMED_PRICE_HISTORY_RELEASE,
    queries, rows: rows.length, rejectedPairs,
    historyByGame, earliestByGame, latestByGame,
  };
}

function numberOrNull(value: number | string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function validPrice(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && (value <= -100 || value >= 100);
}
function latestTime(first: string, second: string) {
  return Date.parse(first) >= Date.parse(second) ? first : second;
}
