/** SELECT-only production audit for MLB Sharp/starter gap recovery. */
import { createClient } from "@supabase/supabase-js";

type Row = {
  id?: number | string | null;
  external_id?: number | string | null;
  game_date?: string | null;
  home_pitcher_id?: number | string | null;
  away_pitcher_id?: number | string | null;
  updated_at?: string | null;
  home?: { abbreviation?: string | null } | null;
  away?: { abbreviation?: string | null } | null;
  canonical_event_id?: number | string | null;
  market_type?: string | null;
  source_book?: string | null;
  source_type?: string | null;
  bets_pct?: number | null;
  money_pct?: number | null;
  fetched_at?: string | null;
  data_source?: string | null;
  refresh_status?: string | null;
  records_updated?: number | null;
  api_calls_made?: number | null;
  refresh_started_at?: string | null;
  refresh_completed_at?: string | null;
  error_message?: string | null;
};
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const date = process.argv[2] ?? "2026-08-31";

async function main() {
  const gamesResult = await sb.from("games")
    .select("id,external_id,game_date,home_pitcher_id,away_pitcher_id,updated_at,home:teams!games_home_team_id_fkey(abbreviation),away:teams!games_away_team_id_fkey(abbreviation)")
    .eq("sport", "mlb").eq("slate_date", date).order("game_date");
  if (gamesResult.error) throw new Error(gamesResult.error.message);
  const games = (gamesResult.data ?? []) as Row[];
  const externalIds = games.map((row) => String(row.external_id));
  const logsResult = await sb.from("data_refresh_log")
    .select("id,data_source,sport,refresh_status,records_updated,api_calls_made,refresh_started_at,refresh_completed_at,error_message")
    .gte("refresh_started_at", "2026-08-29T00:00:00.000Z")
    .in("data_source", ["daily_edge_data_health", "slate_cycle_automation", "public_splits_observations_refresh"])
    .order("refresh_started_at", { ascending: false }).limit(500);
  if (logsResult.error) throw new Error(logsResult.error.message);
  const splitResult = await sb.from("market_split_observations_v2")
    .select("canonical_event_id,market_type,source_book,source_type,bets_pct,money_pct,source_observed_at,fetched_at")
    .eq("league", "mlb").in("canonical_event_id", externalIds)
    .in("market_type", ["moneyline", "total"]).order("fetched_at", { ascending: false }).limit(5000);
  if (splitResult.error) throw new Error(splitResult.error.message);
  const latestByEventMarketBook = new Map<string, Row>();
  for (const row of (splitResult.data ?? []) as Row[]) {
    const key = `${row.canonical_event_id}|${row.market_type}|${row.source_book}|${row.source_type}`;
    if (!latestByEventMarketBook.has(key)) latestByEventMarketBook.set(key, row);
  }
  const splitCoverage = games.map((game) => {
    const rows = [...latestByEventMarketBook.values()].filter((row) => String(row.canonical_event_id) === String(game.external_id));
    return {
      matchup: `${game.away?.abbreviation}@${game.home?.abbreviation}`,
      markets: Object.fromEntries(["moneyline", "total"].map((market) => {
        const marketRows = rows.filter((row) => row.market_type === market);
        const completeBooks = [...new Set(marketRows.filter((row) => row.bets_pct !== null && row.money_pct !== null).map((row) => row.source_book))];
        return [market, { completeBooks, newestFetchedAt: marketRows.map((row) => row.fetched_at).filter(Boolean).sort().at(-1) ?? null }];
      })),
    };
  });
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), readOnly: true, providerCalls: 0, writes: 0,
    starters: games.map((game) => ({
      matchup: `${game.away?.abbreviation}@${game.home?.abbreviation}`,
      externalId: game.external_id,
      awayPitcherPresent: game.away_pitcher_id !== null,
      homePitcherPresent: game.home_pitcher_id !== null,
      gameUpdatedAt: game.updated_at,
    })),
    naturalRuns: (logsResult.data ?? []).map((row: Row) => ({
      id: row.id, source: row.data_source, status: row.refresh_status, records: row.records_updated,
      calls: row.api_calls_made, startedAt: row.refresh_started_at, completedAt: row.refresh_completed_at,
      error: row.error_message,
    })),
    splitCoverage,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
