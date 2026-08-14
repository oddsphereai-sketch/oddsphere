/**
 * READ ONLY. Measures whether stored history can reconstruct the complete
 * point-in-time state required by the unified sharp-market methodology.
 */
import { supabase } from "../../lib/db/supabase";

type Json = Record<string, unknown>;
type Sport = "mlb" | "wnba";
type Market = "moneyline" | "spread" | "total";

const FROM = process.env.FROM ?? "2026-08-01";
const THROUGH = process.env.THROUGH ?? new Date().toISOString().slice(0, 10);
const PAGE = 1000;

async function pageAll(
  table: string,
  select: string,
  // Supabase's fluent builder type is table-schema-dependent at runtime here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configure: (query: any) => any,
): Promise<Json[]> {
  const rows: Json[] = [];
  for (let from = 0; ; from += PAGE) {
    const query = configure(supabase.from(table).select(select).range(from, from + PAGE - 1));
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Json[]));
    if ((data ?? []).length < PAGE) return rows;
  }
}

function dayAfter(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function loadBySportAndDate(table: string, select: string, sport: Sport): Promise<Json[]> {
  return pageAll(table, select, (query) => query
    .eq("league", sport)
    .gte("fetched_at", `${FROM}T00:00:00.000Z`)
    .lt("fetched_at", `${dayAfter(THROUGH)}T00:00:00.000Z`)
    .order("fetched_at", { ascending: true }));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sideFromSelection(value: unknown): string | null {
  const raw = stringValue(value);
  return raw?.split(":").at(-1) ?? null;
}

function expectedSides(market: Market): [string, string] {
  return market === "total" ? ["over", "under"] : ["home", "away"];
}

function marketKey(eventId: string, market: Market): string {
  return `${eventId}|${market}`;
}

function observationTime(row: Json): string | null {
  return stringValue(row.provider_timestamp) ?? stringValue(row.fetched_at);
}

function pairedLineKey(row: Json, market: Market): string {
  const line = numberValue(row.line);
  if (line === null) return "null";
  return market === "spread" ? String(Math.abs(line)) : String(line);
}

function pairedPricePaths(rows: Json[], market: Market): Map<string, Set<string>> {
  const [firstSide, secondSide] = expectedSides(market);
  const buckets = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.market_type !== market || numberValue(row.american_price) === null) continue;
    const eventId = stringValue(row.canonical_event_id);
    const sportsbook = stringValue(row.sportsbook)?.toLowerCase();
    const at = observationTime(row);
    const side = sideFromSelection(row.selection_key);
    if (!eventId || !sportsbook || !at || (side !== firstSide && side !== secondSide)) continue;
    const pairKey = `${eventId}|${market}|${sportsbook}|${at}|${pairedLineKey(row, market)}`;
    const sides = buckets.get(pairKey) ?? new Set<string>();
    sides.add(side);
    buckets.set(pairKey, sides);
  }
  const paths = new Map<string, Set<string>>();
  for (const [pairKey, sides] of buckets) {
    if (!sides.has(firstSide) || !sides.has(secondSide)) continue;
    const [eventId, marketName, sportsbook, at] = pairKey.split("|");
    const key = marketKey(eventId, marketName as Market);
    const points = paths.get(key) ?? new Set<string>();
    points.add(`${sportsbook}|${at}`);
    paths.set(key, points);
  }
  return paths;
}

function sharpPairedPricePaths(rows: Json[], market: Market): Map<string, Set<string>> {
  return pairedPricePaths(rows.filter((row) => row.sharp_book === true), market);
}

function splitCoverage(rows: Json[], market: Market, provider: string): Map<string, Set<string>> {
  const [firstSide, secondSide] = expectedSides(market);
  const byGame = new Map<string, { sides: Set<string>; observations: Set<string> }>();
  for (const row of rows) {
    if (row.market_type !== market || String(row.provider ?? "").toLowerCase() !== provider) continue;
    const eventId = stringValue(row.canonical_event_id);
    const side = sideFromSelection(row.selection_key);
    if (!eventId || (side !== firstSide && side !== secondSide)) continue;
    if (numberValue(row.bets_pct) === null && numberValue(row.money_pct) === null) continue;
    const key = marketKey(eventId, market);
    const current = byGame.get(key) ?? { sides: new Set<string>(), observations: new Set<string>() };
    current.sides.add(side);
    const observed = stringValue(row.source_observed_at) ?? stringValue(row.fetched_at);
    if (observed) current.observations.add(observed);
    byGame.set(key, current);
  }
  return new Map([...byGame.entries()]
    .filter(([, value]) => value.sides.has(firstSide) && value.sides.has(secondSide))
    .map(([key, value]) => [key, value.observations]));
}

function countWhere(keys: string[], predicate: (key: string) => boolean): number {
  return keys.filter(predicate).length;
}

function hasMultiPointBookPath(points: Set<string> | undefined): boolean {
  const timesByBook = new Map<string, Set<string>>();
  for (const point of points ?? []) {
    const separator = point.indexOf("|");
    if (separator < 0) continue;
    const book = point.slice(0, separator);
    const at = point.slice(separator + 1);
    const times = timesByBook.get(book) ?? new Set<string>();
    times.add(at);
    timesByBook.set(book, times);
  }
  return [...timesByBook.values()].some((times) => times.size >= 2);
}

async function auditSport(sport: Sport) {
  const games = await pageAll(
    "games",
    "id,external_id,slate_date,game_date,sport",
    (query) => query.eq("sport", sport).gte("slate_date", FROM).lte("slate_date", THROUGH),
  );
  const eventIds = [...new Set(games.map((row) => String(row.external_id)).filter(Boolean))];
  const prices = await loadBySportAndDate(
    "market_price_observations_v2",
    "canonical_event_id,league,market_type,selection_key,sportsbook,sharp_book,american_price,line,provider_timestamp,fetched_at",
    sport,
  );
  const splits = await loadBySportAndDate(
    "market_split_observations_v2",
    "canonical_event_id,league,market_type,selection_key,provider,source_book,source_type,bets_pct,money_pct,books_used,source_observed_at,fetched_at",
    sport,
  );
  const markets: Market[] = sport === "wnba" ? ["moneyline", "spread", "total"] : ["moneyline", "total"];
  return {
    games: games.length,
    priceObservations: prices.length,
    splitObservations: splits.length,
    markets: Object.fromEntries(markets.map((market) => {
      const keys = eventIds.map((eventId) => marketKey(eventId, market));
      const paired = pairedPricePaths(prices, market);
      const sharpPaired = sharpPairedPricePaths(prices, market);
      const playbook = splitCoverage(splits, market, "playbook");
      const sharpapi = splitCoverage(splits, market, "sharpapi");
      return [market, {
        eligibleGames: keys.length,
        pairedBothSidePrice: countWhere(keys, (key) => paired.has(key)),
        multiPointPairedPricePath: countWhere(keys, (key) => hasMultiPointBookPath(paired.get(key))),
        pairedSharpReferencePrice: countWhere(keys, (key) => sharpPaired.has(key)),
        multiPointSharpReferencePath: countWhere(keys, (key) => hasMultiPointBookPath(sharpPaired.get(key))),
        bothSidePlaybookSplits: countWhere(keys, (key) => playbook.has(key)),
        multiPointPlaybookSplitPath: countWhere(keys, (key) => (playbook.get(key)?.size ?? 0) >= 2),
        bothSideSharpApiSplits: countWhere(keys, (key) => sharpapi.has(key)),
        multiPointSharpApiSplitPath: countWhere(keys, (key) => (sharpapi.get(key)?.size ?? 0) >= 2),
        twoProviderCurrentJointState: countWhere(keys, (key) =>
          paired.has(key) && sharpPaired.has(key) && playbook.has(key) && sharpapi.has(key)),
        twoProviderMultiPointJointPath: countWhere(keys, (key) =>
          hasMultiPointBookPath(paired.get(key)) &&
          hasMultiPointBookPath(sharpPaired.get(key)) &&
          (playbook.get(key)?.size ?? 0) >= 2 &&
          (sharpapi.get(key)?.size ?? 0) >= 2),
      }];
    })),
  };
}

async function main() {
  const mlb = await auditSport("mlb");
  const wnba = await auditSport("wnba");
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    databaseWrites: false,
    from: FROM,
    through: THROUGH,
    note: "Coverage only. This does not test predictive performance or authorize a model change.",
    mlb,
    wnba,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
