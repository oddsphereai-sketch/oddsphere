/**
 * Read-only launch audit for the member-facing Daily Edge data contract.
 *
 * Reports source-aware split completeness and price-history coverage for the
 * requested slate. It never writes, refreshes, or republishes data.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-current-slate-member-data.ts --date 2026-08-10
 */

import { supabase } from "../../lib/db/supabase";

type Row = Record<string, unknown>;

const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const slateDate = dateIndex >= 0 ? args[dateIndex + 1] : new Date().toISOString().slice(0, 10);

if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
  throw new Error("Pass --date YYYY-MM-DD.");
}

function has(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function latestIso(rows: Row[], fields: string[]): string | null {
  return rows
    .flatMap((row) => fields.map((field) => row[field]))
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
}

async function main(): Promise<void> {
  const { data: games, error: gameError } = await supabase
    .from("games")
    .select("id, sport, external_id, game_date, status, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)")
    .eq("slate_date", slateDate)
    .in("sport", ["mlb", "wnba"])
    .order("game_date", { ascending: true });
  if (gameError) throw new Error(`games: ${gameError.message}`);

  const gameRows = (games ?? []) as Row[];
  const eventIds = gameRows.map((row) => String(row.external_id));
  const gameIds = gameRows.map((row) => Number(row.id));

  const splitRows: Row[] = [];
  for (const eventId of eventIds) {
    const { data, error } = await supabase
      .from("market_split_observations_v2")
      .select("league, canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at")
      .eq("canonical_event_id", eventId)
      .order("fetched_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(`market_split_observations_v2 ${eventId}: ${error.message}`);
    splitRows.push(...((data ?? []) as Row[]));
  }

  const lineHistory: Row[] = [];
  for (const gameId of gameIds) {
    const { data, error } = await supabase
      .from("line_history")
      .select("game_id, market_type, side, sportsbook, line_value, odds_american, is_opener, recorded_at")
      .eq("game_id", gameId)
      .order("recorded_at", { ascending: true })
      .limit(2000);
    if (error) throw new Error(`line_history ${gameId}: ${error.message}`);
    lineHistory.push(...((data ?? []) as Row[]));
  }

  const legacySignals: Row[] = [];
  for (const gameId of gameIds) {
    const { data, error } = await supabase
      .from("sharp_signals")
      .select("game_id, market_type, side, public_betting_pct, public_money_pct, computed_at")
      .eq("game_id", gameId)
      .in("market_type", ["moneyline", "total", "spread"]);
    if (error) throw new Error(`sharp_signals ${gameId}: ${error.message}`);
    legacySignals.push(...((data ?? []) as Row[]));
  }

  const bySource = new Map<string, Row[]>();
  for (const row of splitRows) {
    const key = [row.league, row.provider, row.source_book, row.source_type].join("|");
    const current = bySource.get(key) ?? [];
    current.push(row);
    bySource.set(key, current);
  }

  const sourceCoverage = [...bySource.entries()].map(([source, rows]) => ({
    source,
    rows: rows.length,
    events: new Set(rows.map((row) => row.canonical_event_id)).size,
    ticketRows: rows.filter((row) => has(row.bets_pct)).length,
    moneyRows: rows.filter((row) => has(row.money_pct)).length,
    bothRows: rows.filter((row) => has(row.bets_pct) && has(row.money_pct)).length,
    latest: latestIso(rows, ["source_observed_at", "fetched_at"]),
  })).sort((a, b) => a.source.localeCompare(b.source));

  const gameCoverage = gameRows.map((game) => {
    const eventId = String(game.external_id);
    const id = Number(game.id);
    const splits = splitRows.filter((row) => String(row.canonical_event_id) === eventId);
    const prices = lineHistory.filter((row) => Number(row.game_id) === id);
    const signals = legacySignals.filter((row) => Number(row.game_id) === id);
    const team = (value: unknown) => {
      const row = Array.isArray(value) ? value[0] : value;
      return row && typeof row === "object" ? String((row as Row).abbreviation ?? "?") : "?";
    };
    const market = (name: string) => {
      const rows = prices.filter((row) => row.market_type === name);
      const observations = new Set(rows.map((row) => row.recorded_at)).size;
      const books = new Set(rows.map((row) => row.sportsbook)).size;
      return { rows: rows.length, observations, books, hasOpener: rows.some((row) => row.is_opener === true) };
    };
    return {
      sport: game.sport,
      matchup: `${team(game.away_team)}@${team(game.home_team)}`,
      eventId,
      status: game.status,
      splits: {
        sharpMoneyRows: splits.filter((row) => row.provider === "sharpapi" && has(row.money_pct)).length,
        sharpTicketRows: splits.filter((row) => row.provider === "sharpapi" && has(row.bets_pct)).length,
        consensusMoneyRows: splits.filter((row) => (row.provider === "playbook" || row.source_type === "multi_book_consensus") && has(row.money_pct)).length,
        legacyMoneyRows: signals.filter((row) => has(row.public_money_pct)).length,
        legacyTicketRows: signals.filter((row) => has(row.public_betting_pct)).length,
      },
      priceHistory: {
        moneyline: market("moneyline"),
        total: market("total"),
        spread: market("spread"),
        firstInning: market("first_inning_total"),
      },
    };
  });

  const blockers: string[] = [];
  for (const game of gameCoverage) {
    if (game.sport === "mlb") {
      if (game.splits.sharpMoneyRows === 0) blockers.push(`MLB_SHARP_MONEY_MISSING_${game.matchup}`);
      if (game.priceHistory.moneyline.observations < 2) blockers.push(`MLB_MONEYLINE_HISTORY_THIN_${game.matchup}`);
      if (game.priceHistory.total.observations < 2) blockers.push(`MLB_TOTAL_HISTORY_THIN_${game.matchup}`);
      if (game.priceHistory.firstInning.observations < 2) blockers.push(`MLB_FIRST_INNING_HISTORY_THIN_${game.matchup}`);
    }
    if (game.sport === "wnba") {
      // WNBA intentionally has consensus-only split coverage. Sharp-book
      // splits are not part of its member-facing contract.
      if (game.splits.consensusMoneyRows === 0) blockers.push(`WNBA_CONSENSUS_MONEY_MISSING_${game.matchup}`);
      if (game.priceHistory.moneyline.observations < 2) blockers.push(`WNBA_MONEYLINE_HISTORY_THIN_${game.matchup}`);
      if (game.priceHistory.total.observations < 2) blockers.push(`WNBA_TOTAL_HISTORY_THIN_${game.matchup}`);
      if (game.priceHistory.spread.observations < 2) blockers.push(`WNBA_SPREAD_HISTORY_THIN_${game.matchup}`);
    }
  }

  console.log(JSON.stringify({
    slateDate,
    generatedAt: new Date().toISOString(),
    games: gameRows.length,
    contracts: { mlbSplits: "consensus_and_sharp_book", wnbaSplits: "consensus_only" },
    ready: blockers.length === 0,
    blockers,
    sourceCoverage,
    gameCoverage,
  }, null, 2));
  if (args.includes("--strict") && blockers.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
