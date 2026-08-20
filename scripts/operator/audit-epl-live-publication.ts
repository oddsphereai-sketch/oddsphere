import type { DailyEdgeResponse, MarketEdgeDto } from "../../app/lab/lib/labTypes";
import { supabase } from "../../lib/db/supabase";
import { EPL_EXTERNAL_ID_OFFSET } from "../../lib/services/epl/eplProductionPipeline";

const SNAPSHOT_KEY = "soccer::english_premier_league::current-week";

function marketSummary(markets: MarketEdgeDto[]) {
  const verdicts: Record<string, number> = {};
  const picks: Record<string, number> = {};
  const probabilities: number[] = [];
  for (const market of markets) {
    verdicts[market.verdict.label] = (verdicts[market.verdict.label] ?? 0) + 1;
    picks[market.pick ?? "Held"] = (picks[market.pick ?? "Held"] ?? 0) + 1;
    if (market.modelProb !== null) probabilities.push(market.modelProb);
  }
  return {
    verdicts,
    picks,
    probabilityRange: probabilities.length ? [Math.min(...probabilities), Math.max(...probabilities)] : null,
  };
}

async function main() {
  const { data: snapshotRow, error: snapshotError } = await supabase
    .from("lab_response_snapshots")
    .select("payload,payload_version,generated_at,updated_at")
    .eq("snapshot_key", SNAPSHOT_KEY)
    .single();
  if (snapshotError) throw new Error(snapshotError.message);
  const snapshot = snapshotRow.payload as DailyEdgeResponse;
  const providerIds = snapshot.games.map((game) => Number(game.external_id));
  const externalIds = providerIds.map((id) => EPL_EXTERNAL_ID_OFFSET + id);
  const { data: gameRows, error: gameError } = await supabase
    .from("games")
    .select("id,external_id")
    .eq("sport", "soccer")
    .in("external_id", externalIds);
  if (gameError) throw new Error(gameError.message);
  const providerByGameId = new Map((gameRows ?? []).map((row) => [Number(row.id), Number(row.external_id) - EPL_EXTERNAL_ID_OFFSET]));
  const { data: historyRows, error: historyError } = await supabase
    .from("line_history")
    .select("game_id,market_type,sportsbook,side,line_value,odds_american,is_opener,recorded_at")
    .in("game_id", [...providerByGameId.keys()])
    .in("market_type", ["match_result", "double_chance", "total", "btts"])
    .order("recorded_at", { ascending: true })
    .limit(5000);
  if (historyError) throw new Error(historyError.message);

  const arsenal = snapshot.games.find((game) => game.homeTeam === "ARS" || game.awayTeam === "ARS") ?? null;
  const arsenalProviderId = arsenal ? Number(arsenal.external_id) : null;
  const arsenalGameIds = [...providerByGameId.entries()].filter(([, providerId]) => providerId === arsenalProviderId).map(([gameId]) => gameId);
  const arsenalHistory = (historyRows ?? []).filter((row) => arsenalGameIds.includes(Number(row.game_id)) && row.market_type === "match_result");
  const { data: arsenalRecords, error: arsenalRecordError } = await supabase
    .from("prediction_records")
    .select("id,game_id,market,odds_american,created_at,locked_at,snapshot_json")
    .in("game_id", arsenalGameIds)
    .eq("market", "match_result")
    .order("created_at", { ascending: true });
  if (arsenalRecordError) throw new Error(arsenalRecordError.message);
  const arsenalSnapshotBoard = arsenal?.markets.moneyline.soccerPriceBoard?.rows.map((row) => ({
    side: row.side,
    label: row.label,
    price: row.price_american,
    selected: row.selected,
    trail: row.odds_trail ?? [],
  })) ?? [];

  const totals = snapshot.games.map((game) => game.markets.total);
  const btts = snapshot.games.map((game) => game.markets.first_inning);
  const matchResults = snapshot.games.map((game) => game.markets.moneyline);
  const projections = snapshot.games.map((game) => ({
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    expectedAway: game.soccerProjection?.expectedGoals.away ?? null,
    expectedHome: game.soccerProjection?.expectedGoals.home ?? null,
    expectedTotal: game.soccerProjection ? game.soccerProjection.expectedGoals.away + game.soccerProjection.expectedGoals.home : null,
    representativeScore: game.soccerProjection?.representativeScore ?? null,
    totalPick: game.markets.total.pick,
    bttsPick: game.markets.first_inning.pick,
  }));
  const historyGroups = new Map<string, number>();
  for (const row of historyRows ?? []) {
    const key = `${row.game_id}:${row.market_type}:${row.side}:${row.sportsbook}`;
    historyGroups.set(key, (historyGroups.get(key) ?? 0) + 1);
  }

  console.log(JSON.stringify({
    snapshot: {
      asOf: snapshot.as_of,
      payloadVersion: snapshotRow.payload_version,
      generatedAt: snapshotRow.generated_at,
      updatedAt: snapshotRow.updated_at,
      games: snapshot.games.length,
    },
    board: {
      matchResult: marketSummary(matchResults),
      total: marketSummary(totals),
      btts: marketSummary(btts),
    },
    projections,
    durableHistory: {
      rows: historyRows?.length ?? 0,
      groups: historyGroups.size,
      groupsWithMovement: [...historyGroups.values()].filter((count) => count > 1).length,
    },
    arsenal: {
      matchup: arsenal ? `${arsenal.awayTeam}@${arsenal.homeTeam}` : null,
      snapshotBoard: arsenalSnapshotBoard,
      durableMatchResultHistory: arsenalHistory,
      predictionRecords: arsenalRecords,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
