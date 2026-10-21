/** Read-only NBA opening/current/T-60 market-evidence readiness audit. */

import { supabase } from "../../../lib/db/supabase";

type Row = Record<string, unknown>;
const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;
const HISTORY_WINDOW_HOURS = 36;
const READER_BOOKS = [
  "circa", "pinnacle", "betmgm", "betrivers", "caesars", "draftkings", "fanatics", "fanduel",
] as const;
const SPLIT_BOOKS = ["consensus", "circa", "draftkings", "betmgm"] as const;

async function readAllPages<T>(
  label: string,
  readPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const page = await readPage(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(`${label}: ${page.error.message}`);
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < PAGE_SIZE) return rows;
  }
  throw new Error(`${label}: exceeded bounded ${MAX_ROWS}-row audit cap`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const from = flag("--from");
const to = flag("--to") ?? from;
if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  throw new Error("Pass --from YYYY-MM-DD and optional --to YYYY-MM-DD.");
}

function sidePair(market: string): readonly string[] {
  return market === "total" ? ["over", "under"] : ["home", "away"];
}

function team(value: unknown): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? String((row as Row).abbreviation ?? "?") : "?";
}

async function main(): Promise<void> {
  const historySince = new Date(Date.now() - HISTORY_WINDOW_HOURS * 3_600_000).toISOString();
  const { data: gameData, error: gameError } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)")
    .eq("sport", "nba")
    .gte("slate_date", from)
    .lte("slate_date", to)
    .order("game_date", { ascending: true });
  if (gameError) throw new Error(`games: ${gameError.message}`);
  const games = (gameData ?? []) as Row[];
  const gameIds = games.map((game) => Number(game.id));
  const externalIds = new Set(games.map((game) => String(game.external_id)));

  const current = gameIds.length === 0 ? [] : await readAllPages<Row>("lines", (from, to) => supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "spread", "total"])
    .order("id", { ascending: true })
    .range(from, to) as never);

  const history = gameIds.length === 0 ? [] : await readAllPages<Row>("line_history", (from, to) => supabase
    .from("line_history")
    .select("id, game_id, market_type, side, sportsbook, line_value, odds_american, is_opener, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "spread", "total"])
    .in("sportsbook", [...READER_BOOKS])
    .gte("recorded_at", historySince)
    .order("id", { ascending: true })
    .range(from, to) as never);

  const splits = externalIds.size === 0 ? [] : await readAllPages<Row>("market_split_observations_v2", (from, to) => supabase
    .from("market_split_observations_v2")
    .select("id, canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at")
    .eq("league", "nba")
    .in("canonical_event_id", [...externalIds])
    .in("source_book", [...SPLIT_BOOKS])
    .gte("fetched_at", historySince)
    .order("id", { ascending: true })
    .range(from, to) as never);

  const gameCoverage = games.map((game) => {
    const id = Number(game.id);
    const eventId = String(game.external_id);
    const gameCurrent = current.filter((row) => Number(row.game_id) === id);
    const gameHistory = history.filter((row) => Number(row.game_id) === id);
    const gameSplits = splits.filter((row) => String(row.canonical_event_id) === eventId);
    const markets = Object.fromEntries(["moneyline", "spread", "total"].map((market) => {
      const marketCurrent = gameCurrent.filter((row) => row.market_type === market);
      const marketHistory = gameHistory.filter((row) => row.market_type === market);
      const books = [...new Set(marketCurrent.map((row) => String(row.sportsbook)))];
      const completeCurrentBooks = books.filter((book) => {
        const rows = marketCurrent.filter((row) => row.sportsbook === book);
        return sidePair(market).every((side) => rows.some((row) => row.side === side && typeof row.odds_american === "number"));
      });
      const sequenceBooks = [...new Set(marketHistory.map((row) => String(row.sportsbook)))].filter((book) => {
        const observations = new Set(
          marketHistory.filter((row) => row.sportsbook === book).map((row) => String(row.recorded_at)),
        );
        return observations.size >= 2;
      });
      return [market, {
        currentRows: marketCurrent.length,
        historyRows: marketHistory.length,
        books: books.length,
        completeCurrentBooks,
        openerRows: marketHistory.filter((row) => row.is_opener === true).length,
        sameBookSequenceBooks: sequenceBooks,
        observations: new Set(marketHistory.map((row) => String(row.recorded_at))).size,
      }];
    }));
    return {
      gameId: id,
      eventId,
      slateDate: game.slate_date,
      matchup: `${team(game.away_team)}@${team(game.home_team)}`,
      status: game.status,
      markets,
      splits: {
        rows: gameSplits.length,
        books: [...new Set(gameSplits.map((row) => String(row.source_book)))],
        completeRows: gameSplits.filter((row) => typeof row.bets_pct === "number" && typeof row.money_pct === "number").length,
      },
    };
  });

  const readyGames = gameCoverage.filter((game) =>
    ["moneyline", "spread", "total"].every((market) => {
      const state = game.markets[market] as {
        completeCurrentBooks: string[];
        openerRows: number;
        sameBookSequenceBooks: string[];
      };
      return state.completeCurrentBooks.length >= 2 && state.openerRows > 0 && state.sameBookSequenceBooks.length >= 2;
    }),
  ).length;

  console.log(JSON.stringify({
    release: "nba_current_market_readiness_2026_10_15_r1",
    generatedAt: new Date().toISOString(),
    window: { from, to },
    evidenceWindow: { since: historySince, hours: HISTORY_WINDOW_HOURS, readerBooks: READER_BOOKS },
    rowsRead: { current: current.length, history: history.length, splits: splits.length },
    games: games.length,
    gamesWithCompleteMultiBookSequenceAllMarkets: readyGames,
    ready: games.length > 0 && readyGames === games.length,
    gameCoverage,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
