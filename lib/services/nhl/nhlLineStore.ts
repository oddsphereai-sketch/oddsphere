import { supabase } from "../../db/supabase";
import { loadCompleteCurrentGameLines } from "../currentGameLineReader";

const NHL_HISTORY_PAGE_SIZE = 1_000;
const NHL_HISTORY_MAX_ROWS_PER_GAME = 20_000;

export type NhlStoredLineHistoryRow = {
  id: number;
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string | null;
};

export async function loadCompleteNhlCurrentLines(
  gameId: number,
  context: string,
) {
  return loadCompleteCurrentGameLines({
    client: supabase,
    gameIds: [gameId],
    marketTypes: ["moneyline", "total", "spread"],
    context,
  });
}

/**
 * NHL movement is append-only and can exceed PostgREST's default 1,000-row
 * response ceiling on busy slates. Read the exact count in stable id order and
 * fail closed if the bounded result cannot be proven complete.
 */
export async function loadCompleteNhlLineHistory(args: {
  gameId: number;
  marketTypes: readonly string[];
  context: string;
}): Promise<NhlStoredLineHistoryRow[]> {
  if (args.marketTypes.length === 0) return [];
  const rows: NhlStoredLineHistoryRow[] = [];
  let expectedRows: number | null = null;

  for (let from = 0; expectedRows === null || from < expectedRows; from += NHL_HISTORY_PAGE_SIZE) {
    const { data, error, count } = await supabase
      .from("line_history")
      .select("id, market_type, sportsbook, side, line_value, odds_american, recorded_at", { count: "exact" })
      .eq("game_id", args.gameId)
      .is("player_id", null)
      .in("market_type", [...args.marketTypes])
      .order("id", { ascending: true })
      .range(from, from + NHL_HISTORY_PAGE_SIZE - 1);
    if (error) throw new Error(`${args.context}: NHL line_history query failed: ${error.message}`);
    if (typeof count !== "number") {
      throw new Error(`${args.context}: NHL line_history returned no exact count`);
    }
    if (count > NHL_HISTORY_MAX_ROWS_PER_GAME) {
      throw new Error(
        `${args.context}: NHL line_history cap exceeded: count=${count} cap=${NHL_HISTORY_MAX_ROWS_PER_GAME}`,
      );
    }
    expectedRows ??= count;
    if (count !== expectedRows) {
      throw new Error(
        `${args.context}: NHL line_history count changed during pagination: initial=${expectedRows} current=${count}`,
      );
    }
    const page = (data ?? []) as unknown as NhlStoredLineHistoryRow[];
    const expectedPageRows = Math.min(NHL_HISTORY_PAGE_SIZE, expectedRows - from);
    if (page.length !== expectedPageRows) {
      throw new Error(
        `${args.context}: NHL line_history truncated: offset=${from} expected=${expectedPageRows} received=${page.length}`,
      );
    }
    rows.push(...page);
  }

  return rows;
}
