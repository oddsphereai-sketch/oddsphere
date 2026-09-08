import type { SupabaseClient } from "@supabase/supabase-js";

export const CURRENT_GAME_LINE_PAGE_SIZE = 500;
export const CURRENT_GAME_LINE_MAX_ROWS = 10_000;

export type CurrentGameLineRow = {
  id: number;
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

export async function collectBoundedCurrentGameLineRows(
  readPage: (from: number, to: number) => Promise<CurrentGameLineRow[]>,
  options: {
    pageSize?: number;
    maxRows?: number;
    context?: string;
  } = {},
): Promise<CurrentGameLineRow[]> {
  const pageSize = options.pageSize ?? CURRENT_GAME_LINE_PAGE_SIZE;
  const maxRows = options.maxRows ?? CURRENT_GAME_LINE_MAX_ROWS;
  const context = options.context ?? "current game lines";
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`${context}: page size must be a positive integer`);
  }
  if (!Number.isInteger(maxRows) || maxRows < pageSize || maxRows % pageSize !== 0) {
    throw new Error(`${context}: row cap must be a positive multiple of page size`);
  }

  const rows: CurrentGameLineRow[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const page = await readPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }

  throw new Error(`${context}: reached bounded ${maxRows}-row cap; refusing a partial price board`);
}

/**
 * Read the complete current game-level price board without relying on
 * PostgREST's default 1,000-row response ceiling. Stable id ordering makes
 * page boundaries deterministic while the slate is being refreshed.
 */
export async function loadCompleteCurrentGameLines(args: {
  client: SupabaseClient;
  gameIds: readonly number[];
  marketTypes: readonly string[];
  context: string;
}): Promise<CurrentGameLineRow[]> {
  if (args.gameIds.length === 0 || args.marketTypes.length === 0) return [];
  return collectBoundedCurrentGameLineRows(async (from, to) => {
    const { data, error } = await args.client
      .from("lines")
      .select("id, game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
      .in("game_id", [...args.gameIds])
      .in("market_type", [...args.marketTypes])
      .is("player_id", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`${args.context}: lines query failed: ${error.message}`);
    return (data ?? []) as unknown as CurrentGameLineRow[];
  }, { context: args.context });
}
