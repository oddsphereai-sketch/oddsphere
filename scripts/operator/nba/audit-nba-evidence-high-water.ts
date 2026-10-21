/** SELECT-only probe for NBA canonical evidence high-water pagination. */

import { supabase } from "../../../lib/db/supabase";

const eventIds = process.argv.slice(2);
if (eventIds.length === 0) throw new Error("Pass one or more canonical NBA event ids.");

async function probe(table: "market_split_observations_v2" | "market_price_observations_v2") {
  const high = await supabase
    .from(table)
    .select("id")
    .eq("league", "nba")
    .in("canonical_event_id", eventIds)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const first = await supabase
    .from(table)
    .select("id,canonical_event_id,market_type,selection_key,fetched_at")
    .eq("league", "nba")
    .in("canonical_event_id", eventIds)
    .order("id", { ascending: true })
    .limit(3);
  const latest = await supabase
    .from(table)
    .select(table === "market_price_observations_v2"
      ? "id,canonical_event_id,market_type,selection_key,sportsbook,american_price,line,provider_timestamp,fetched_at"
      : "id,canonical_event_id,market_type,selection_key,source_book,bets_pct,money_pct,source_observed_at,fetched_at")
    .eq("league", "nba")
    .in("canonical_event_id", eventIds)
    .order("id", { ascending: false })
    .limit(12);
  const highWaterId = Number(high.data?.id ?? 0);
  const boundedFirst = await supabase
    .from(table)
    .select("id,canonical_event_id,market_type,selection_key,fetched_at")
    .eq("league", "nba")
    .in("canonical_event_id", eventIds)
    .gt("id", 0)
    .lte("id", highWaterId)
    .order("id", { ascending: true })
    .limit(3);
  let lastId = 0;
  let rows = 0;
  let pages = 0;
  let latestFetchedAt: string | null = null;
  while (lastId < highWaterId) {
    const page = await supabase
      .from(table)
      .select("id,fetched_at")
      .eq("league", "nba")
      .in("canonical_event_id", eventIds)
      .gt("id", lastId)
      .lte("id", highWaterId)
      .order("id", { ascending: true })
      .limit(1_000);
    if (page.error) throw new Error(`${table}: ${page.error.message}`);
    const values = page.data ?? [];
    pages += 1;
    rows += values.length;
    latestFetchedAt = values.at(-1)?.fetched_at ?? latestFetchedAt;
    if (values.length < 1_000) break;
    lastId = Number(values.at(-1)!.id);
  }
  return { table, high, first, boundedFirst, pagination: { rows, pages, latestFetchedAt }, latest };
}

async function main() {
  console.log(JSON.stringify({
    readOnly: true,
    eventIds,
    splits: await probe("market_split_observations_v2"),
    prices: await probe("market_price_observations_v2"),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
