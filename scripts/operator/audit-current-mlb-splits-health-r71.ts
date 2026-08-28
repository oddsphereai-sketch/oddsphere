/**
 * SELECT-only MLB split-health incident audit.
 *
 * Reads the exact current slate identities plus both split storage paths. It
 * never calls a provider and never writes. Extreme rows are reported with
 * their provider/source/timestamps so a rendered 100/100 cannot be mistaken
 * for healthy consensus merely because the opposite side is complementary.
 */

import { supabase } from "../../lib/db/supabase";

type Row = Record<string, unknown>;

const slateDate = process.argv[2] ?? "2026-08-28";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function isExtreme(row: Row): boolean {
  const bets = numberOrNull(row.public_betting_pct ?? row.bets_pct);
  const money = numberOrNull(row.public_money_pct ?? row.money_pct);
  return bets === 0 || bets === 100 || money === 0 || money === 100;
}

async function selectOrThrow(
  table: string,
  select: string,
  apply: (query: any) => any,
): Promise<Row[]> {
  const result = await apply(supabase.from(table).select(select));
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

async function main() {
  const games = await selectOrThrow(
    "games",
    "id, external_id, home_team_id, away_team_id, slate_date, status, updated_at",
    (query) => query.eq("sport", "mlb").eq("slate_date", slateDate).order("id"),
  );
  const gameIds = games.map((row) => numberOrNull(row.id)).filter((id): id is number => id !== null);
  const eventIds = games.map((row) => String(row.external_id ?? "")).filter(Boolean);
  if (gameIds.length === 0) throw new Error(`No MLB games found for ${slateDate}`);

  const [observations, sourceAware, signals, lines] = await Promise.all([
    selectOrThrow(
      "public_splits_observations",
      "provider, game_id, market_type, side, public_betting_pct, public_money_pct, books_used, observed_at, created_at",
      (query) => query.in("game_id", gameIds).in("market_type", ["moneyline", "total"]).order("observed_at", { ascending: false }),
    ),
    selectOrThrow(
      "market_split_observations_v2",
      "canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at",
      (query) => query.eq("league", "mlb").in("canonical_event_id", eventIds).in("market_type", ["moneyline", "total"]).order("fetched_at", { ascending: false }).limit(5000),
    ),
    selectOrThrow(
      "sharp_signals",
      "game_id, market_type, side, public_betting_pct, public_money_pct, computed_at",
      (query) => query.in("game_id", gameIds).in("market_type", ["moneyline", "total"]),
    ),
    selectOrThrow(
      "lines",
      "game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at",
      (query) => query.in("game_id", gameIds).in("market_type", ["moneyline", "total", "first_inning_total"]).is("player_id", null),
    ),
  ]);

  const newest = (rows: Row[], field: string): string | null => rows
    .map((row) => isoOrNull(row[field]))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const lineKeys = new Set(lines.map((row) => `${row.game_id}:${row.market_type}:${row.sportsbook}:${row.side}:${row.line_value}`));
  const eventByGameId = new Map(games.map((row) => [row.id, row.external_id]));
  const withEvent = (row: Row): Row => ({
    event_id: eventByGameId.get(row.game_id) ?? row.canonical_event_id ?? null,
    ...row,
  });

  console.log(JSON.stringify({
    release: "mlb_split_health_audit_2026_08_28_r71",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    slateDate,
    games: games.length,
    storage: {
      publicSplitsRows: observations.length,
      sourceAwareRows: sourceAware.length,
      signalRows: signals.length,
      lineRows: lines.length,
      distinctLineTuples: lineKeys.size,
      newestPublicSplit: newest(observations, "observed_at"),
      newestSourceAwareFetch: newest(sourceAware, "fetched_at"),
      newestSignal: newest(signals, "computed_at"),
      newestLine: newest(lines, "fetched_at"),
    },
    extremePublicSplitRows: observations.filter(isExtreme).map(withEvent),
    extremeSourceAwareRows: sourceAware.filter(isExtreme),
    extremeSignalRows: signals.filter(isExtreme).map(withEvent),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
