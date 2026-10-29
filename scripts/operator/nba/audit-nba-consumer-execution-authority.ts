/** Read-only live-slate board impact for consumer execution-line authority. */

import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "../../../app/lab/lib/labTypes";
import { supabase } from "../../../lib/db/supabase";
import { dailyEdgeSnapshotKey, readLatestLabResponseSnapshot } from "../../../lib/services/labResponseSnapshots";
import { adaptNbaToDailyEdgeResponse } from "../../../lib/services/nba/adaptNbaToDailyEdgeResponse";
import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { NbaLineRow } from "../../../lib/services/nba/nbaMarketIntelligence";
import { refreshNbaLines } from "../../../lib/services/nba/refreshNbaLinesService";

const slateDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const owlsApiKey = process.env.OWLS_INSIGHT_API_KEY;
const ballDontLieApiKey = process.env.BALLDONTLIE_API_KEY;
if (!owlsApiKey || !ballDontLieApiKey) throw new Error("NBA consumer execution audit requires Owls and BALLDONTLIE keys.");

function actionable(market: MarketEdgeDto): boolean {
  return market.verdict.key === "best_angle" || market.verdict.key === "lean";
}

function marketSummary(game: DailyEdgeGameDto, market: "moneyline" | "spread" | "total") {
  const value = market === "moneyline" ? game.markets.moneyline
    : market === "spread" ? game.markets.first_inning
    : game.markets.total;
  return {
    market,
    pick: value.pick,
    direction: value.pick?.split(" ")[0] ?? null,
    line: value.marketPrediction?.line ?? null,
    probability: value.modelProb,
    grade: value.verdict.key,
    price: value.priceAmerican,
    sportsbook: value.currentPriceSportsbook ?? null,
    actionable: actionable(value),
  };
}

function gameRows(game: DailyEdgeGameDto) {
  return (["moneyline", "spread", "total"] as const).map((market) => ({
    externalId: game.external_id,
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    projectedAway: game.projected?.away ?? null,
    projectedHome: game.projected?.home ?? null,
    ...marketSummary(game, market),
  }));
}

async function main(): Promise<void> {
  const refresh = await refreshNbaLines({
    slateDate,
    owlsApiKey,
    ballDontLieApiKey,
    dryRun: true,
  });
  if (refresh.errors.length > 0) throw new Error(`NBA consumer execution dry-run errors: ${refresh.errors.join("; ")}`);
  const gameIds = [...new Set(refresh.canonicalLines.map((row) => row.gameId))];
  const { data: games, error } = await supabase
    .from("games")
    .select("id,external_id")
    .eq("sport", "nba")
    .in("id", gameIds);
  if (error) throw new Error(error.message);
  const externalByDbId = new Map((games ?? []).map((game) => [Number(game.id), Number(game.external_id)]));
  const currentLinesOverrideByExternalId = new Map<number, NbaLineRow[]>();
  const observedAt = new Date().toISOString();
  for (const row of refresh.canonicalLines) {
    const externalId = externalByDbId.get(row.gameId);
    if (externalId === undefined) continue;
    currentLinesOverrideByExternalId.set(externalId, [
      ...(currentLinesOverrideByExternalId.get(externalId) ?? []),
      {
        market_type: row.marketType,
        sportsbook: row.sportsbook,
        side: row.side,
        line_value: row.lineValue,
        odds_american: row.oddsAmerican,
        fetched_at: observedAt,
      },
    ]);
  }

  const pipeline = await buildNbaDailyEdgePipeline(slateDate, { currentLinesOverrideByExternalId });
  const candidate = adaptNbaToDailyEdgeResponse(pipeline.nbaDto, {
    openPricesByGame: pipeline.openPricesByGame,
    memberEvidenceByGame: pipeline.memberEvidenceByGame,
    lockedMemberGamesByExternalId: pipeline.lockedMemberGamesByExternalId,
  });
  const snapshotKey = dailyEdgeSnapshotKey({ sport: "nba", requestedDate: slateDate, allowStale: false, copyPreview: false });
  const incumbentSnapshot = await readLatestLabResponseSnapshot<DailyEdgeResponse>(snapshotKey);
  if (!incumbentSnapshot) throw new Error(`Missing incumbent NBA snapshot ${snapshotKey}`);

  const before = incumbentSnapshot.payload.games.flatMap(gameRows);
  const after = candidate.games.flatMap(gameRows);
  const candidateGameIds = new Set(after.map((row) => row.externalId));
  const scopedBefore = before.filter((row) => candidateGameIds.has(row.externalId));
  const beforeByKey = new Map(scopedBefore.map((row) => [`${row.externalId}|${row.market}`, row]));
  const comparisons = after.map((row) => {
    const prior = beforeByKey.get(`${row.externalId}|${row.market}`) ?? null;
    return {
      key: `${row.externalId}|${row.market}`,
      before: prior,
      after: row,
      changed: prior === null || JSON.stringify(prior) !== JSON.stringify(row),
      promotion: prior !== null && !prior.actionable && row.actionable,
      demotion: prior !== null && prior.actionable && !row.actionable,
      sideChange: prior !== null && prior.direction !== row.direction,
      scoreChange: prior !== null && (
        Math.abs((prior.projectedAway ?? 0) - (row.projectedAway ?? 0)) > 1e-9 ||
        Math.abs((prior.projectedHome ?? 0) - (row.projectedHome ?? 0)) > 1e-9
      ),
    };
  });
  console.log(JSON.stringify({
    release: "nba_consumer_execution_authority_audit_2026_10_29_r1",
    generatedAt: new Date().toISOString(),
    slateDate,
    incumbentGeneratedAt: incumbentSnapshot.generatedAt,
    provider: {
      games: refresh.gamesInDb,
      rows: refresh.canonicalLines.length,
      books: [...new Set(refresh.canonicalLines.map((row) => row.sportsbook))].sort(),
      incompleteGroupsDropped: refresh.incompleteBookGroupsDropped,
      errors: refresh.errors,
    },
    summary: {
      markets: comparisons.length,
      beforeActionable: scopedBefore.filter((row) => row.actionable).length,
      afterActionable: after.filter((row) => row.actionable).length,
      promotions: comparisons.filter((row) => row.promotion).length,
      demotions: comparisons.filter((row) => row.demotion).length,
      sideChanges: comparisons.filter((row) => row.sideChange).length,
      scoreChanges: comparisons.filter((row) => row.scoreChange).length,
      changed: comparisons.filter((row) => row.changed).length,
    },
    comparisons,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
