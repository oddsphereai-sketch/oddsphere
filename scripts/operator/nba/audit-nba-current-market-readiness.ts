/** Read-only NBA opening/current/T-60 market-evidence readiness audit. */

import { supabase } from "../../../lib/db/supabase";

type Row = Record<string, unknown>;

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

  const { data: currentData, error: currentError } = gameIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("lines")
        .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
        .in("game_id", gameIds)
        .in("market_type", ["moneyline", "spread", "total"])
        .limit(10_000);
  if (currentError) throw new Error(`lines: ${currentError.message}`);
  const current = (currentData ?? []) as Row[];

  const { data: historyData, error: historyError } = gameIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("line_history")
        .select("game_id, market_type, side, sportsbook, line_value, odds_american, is_opener, recorded_at")
        .in("game_id", gameIds)
        .in("market_type", ["moneyline", "spread", "total"])
        .order("recorded_at", { ascending: true })
        .limit(50_000);
  if (historyError) throw new Error(`line_history: ${historyError.message}`);
  const history = (historyData ?? []) as Row[];

  const { data: splitData, error: splitError } = externalIds.size === 0
    ? { data: [], error: null }
    : await supabase
        .from("market_split_observations_v2")
        .select("canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at")
        .eq("league", "nba")
        .in("canonical_event_id", [...externalIds])
        .limit(20_000);
  if (splitError) throw new Error(`market_split_observations_v2: ${splitError.message}`);
  const splits = (splitData ?? []) as Row[];

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
