import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaReaderPriceRow } from "./nbaProfessionalMarketReader";
import type { NbaMovementMarket } from "./nbaSameBookMovement";
import { isNbaConsumerExecutionSportsbook } from "./nbaMarketSourceEligibility";

export const NBA_CONSUMER_HISTORY_PAGE_SIZE = 1_000;

type NbaConsumerLineHistoryDbRow = {
  id: number;
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string;
};

export type NbaConsumerMemberHistoryResult = {
  rowsByExternalGameId: Map<number, NbaReaderPriceRow[]>;
  error: string | null;
};

function validSide(market: NbaMovementMarket, side: string): boolean {
  return market === "total"
    ? side === "over" || side === "under"
    : side === "home" || side === "away";
}

export function mapNbaConsumerLineHistoryRows(args: {
  rows: readonly NbaConsumerLineHistoryDbRow[];
  externalIdByDbId: ReadonlyMap<number, number>;
}): Map<number, NbaReaderPriceRow[]> {
  const result = new Map<number, NbaReaderPriceRow[]>();
  for (const row of args.rows) {
    const externalId = args.externalIdByDbId.get(row.game_id);
    const market = row.market_type as NbaMovementMarket;
    if (
      externalId === undefined ||
      !["moneyline", "spread", "total"].includes(market) ||
      !validSide(market, row.side) ||
      !isNbaConsumerExecutionSportsbook(row.sportsbook) ||
      row.odds_american === null || row.odds_american === 0 ||
      !Number.isFinite(Date.parse(row.recorded_at))
    ) continue;
    const gameRows = result.get(externalId) ?? [];
    gameRows.push({
      sportsbook: row.sportsbook,
      sharpBook: false,
      market,
      selectionKey: `consumer_history:${market}:${row.side}`,
      americanPrice: row.odds_american,
      line: row.line_value,
      providerTimestamp: row.recorded_at,
      fetchedAt: row.recorded_at,
    });
    result.set(externalId, gameRows);
  }
  return result;
}

/**
 * Read the complete, bounded consumer chronology used only by the unlocked
 * member movement panel. The professional reader continues to use its own
 * provider-separated observation store, so these rows cannot change a score,
 * side, grade, stake, or market interpretation.
 */
export async function loadNbaConsumerMemberLineHistory(args: {
  client: SupabaseClient;
  externalIdByDbId: ReadonlyMap<number, number>;
}): Promise<NbaConsumerMemberHistoryResult> {
  const gameIds = [...args.externalIdByDbId.keys()].sort((left, right) => left - right);
  if (gameIds.length === 0) return { rowsByExternalGameId: new Map(), error: null };

  const highWaterRead = await args.client
    .from("line_history")
    .select("id")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "spread", "total"])
    .is("player_id", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (highWaterRead.error) {
    return {
      rowsByExternalGameId: new Map(),
      error: `consumer_history_high_water_failed:${highWaterRead.error.message}`,
    };
  }

  const highWaterId = Number(highWaterRead.data?.id ?? 0);
  const rows: NbaConsumerLineHistoryDbRow[] = [];
  let lastId = 0;
  while (lastId < highWaterId) {
    const page = await args.client
      .from("line_history")
      .select("id,game_id,market_type,sportsbook,side,line_value,odds_american,recorded_at")
      .in("game_id", gameIds)
      .in("market_type", ["moneyline", "spread", "total"])
      .is("player_id", null)
      .gt("id", lastId)
      .lte("id", highWaterId)
      .order("id", { ascending: true })
      .limit(NBA_CONSUMER_HISTORY_PAGE_SIZE);
    if (page.error) {
      return {
        rowsByExternalGameId: new Map(),
        error: `consumer_history_lookup_failed:${page.error.message}`,
      };
    }
    const data = (page.data ?? []) as NbaConsumerLineHistoryDbRow[];
    if (data.some((row, index) =>
      !Number.isInteger(row.id) || row.id <= (index === 0 ? lastId : data[index - 1]!.id)
    )) {
      return {
        rowsByExternalGameId: new Map(),
        error: "consumer_history_id_order_invalid",
      };
    }
    rows.push(...data);
    if (data.length < NBA_CONSUMER_HISTORY_PAGE_SIZE) break;
    lastId = data.at(-1)!.id;
  }
  return {
    rowsByExternalGameId: mapNbaConsumerLineHistoryRows({
      rows,
      externalIdByDbId: args.externalIdByDbId,
    }),
    error: null,
  };
}
