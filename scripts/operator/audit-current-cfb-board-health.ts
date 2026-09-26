#!/usr/bin/env tsx

/** SELECT-only audit of the published CFB member snapshot. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardMemberSnapshot } from "../../lib/services/football/cfbForwardMemberSnapshotStore";

loadEnvConfig(process.cwd());

const MARKETS = ["moneyline", "spread", "total"] as const;

function bucket(value: number, boundaries: number[]): string {
  for (const boundary of boundaries) if (value <= boundary) return `<=${boundary}`;
  return `>${boundaries.at(-1)}`;
}

function count<T>(values: T[], key: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const snapshot = await readCfbForwardMemberSnapshot({
    client,
    season: 2026,
    now,
  });
  if (!snapshot) throw new Error("Current CFB member snapshot is unavailable.");
  const { data: refreshRows, error: refreshError } = await client
    .from("data_refresh_log")
    .select("refresh_started_at,refresh_completed_at,refresh_status,records_updated,error_message,api_calls_made")
    .eq("data_source", "cfb_forward_evidence")
    .eq("sport", "cfb")
    .order("refresh_started_at", { ascending: false })
    .limit(12);
  if (refreshError) throw new Error(`CFB refresh log read failed: ${refreshError.message}`);

  const games = snapshot.fixture.snapshot.games;
  const matchupFilter = process.argv.find((value) => value.startsWith("--matchup="))?.slice(10).toUpperCase() ?? null;
  const rows = games.flatMap((game) => MARKETS.map((market) => {
    const dto = market === "spread" ? game.markets.first_inning : game.markets[market];
    return {
      gameId: game.id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      lockState: game.lockState,
      scope: game.collegeFootballScope ?? "unknown",
      market,
      grade: dto.verdict.label,
      prediction: dto.marketPrediction,
      pick: dto.pick,
      held: dto.held,
      line: dto.line,
      currentPrice: dto.currentPriceAmerican,
      priceObservedAt: dto.currentPriceObservedAt,
      source: dto.currentPriceSportsbook ?? dto.marketSource,
      quality: dto.marketDataQuality,
      trailLength: dto.oddsTrail?.length ?? 0,
    };
  }));
  const projections = games.map((game) => {
    const projection = game.footballProjection!;
    return {
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      score: `${game.projected.away}-${game.projected.home}`,
      expectedAway: projection.expectedAwayPoints,
      expectedHome: projection.expectedHomePoints,
      expectedMarginHome: projection.expectedHomePoints - projection.expectedAwayPoints,
      representativeMarginHome: game.projected.home - game.projected.away,
      expectedTotal: projection.expectedHomePoints + projection.expectedAwayPoints,
      representativeTotal: game.projected.home + game.projected.away,
      homeWinProbability: projection.homeWinProbability,
    };
  });
  const nowMs = Date.parse(now);
  const actionable = rows.filter((row) => row.grade === "Lean" || row.grade === "Best Angle");
  const upcomingRows = rows.filter((row) => Date.parse(row.startsAt ?? "") > nowMs);
  const upcomingActionable = upcomingRows.filter((row) => row.grade === "Lean" || row.grade === "Best Angle");
  const missingPrice = rows.filter((row) => row.currentPrice === null);
  const zeroTrail = rows.filter((row) => row.trailLength === 0);
  const report = {
    release: "cfb_current_board_health_select_audit_2026_09_26_r1",
    readOnly: true,
    writes: 0,
    now,
    snapshot: {
      snapshotRelease: snapshot.snapshotRelease,
      evidenceRelease: snapshot.evidenceRelease,
      memberRelease: snapshot.memberRelease,
      fixtureRelease: snapshot.fixtureRelease,
      sourceCapturedAt: snapshot.sourceCapturedAt,
      publishedAt: snapshot.publishedAt,
      ageMinutes: (nowMs - Date.parse(snapshot.publishedAt)) / 60_000,
      games: games.length,
      markets: rows.length,
      provenance: snapshot.fixture.provenance,
    },
    recentRefreshes: refreshRows ?? [],
    focusGames: games.filter((game) => !matchupFilter || `${game.awayTeam}@${game.homeTeam}`.toUpperCase() === matchupFilter).map((game) => ({
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      projected: game.projected,
      footballProjection: game.footballProjection,
      markets: {
        moneyline: game.markets.moneyline,
        spread: game.markets.first_inning,
        total: game.markets.total,
      },
    })),
    board: {
      gameStates: count(games, (game) => Date.parse(game.gameStartAt ?? "") <= nowMs ? "started" : game.lockState ?? "unknown"),
      marketGrades: count(rows, (row) => `${row.market}:${row.grade}`),
      actionableByMarketAndSide: count(actionable, (row) => `${row.market}:${row.prediction?.label ?? row.pick ?? "missing"}`),
      actionableGames: new Set(actionable.map((row) => row.gameId)).size,
      gamesWithoutActionable: games.filter((game) => !actionable.some((row) => row.gameId === game.id)).length,
      upcomingMarketGrades: count(upcomingRows, (row) => `${row.market}:${row.grade}`),
      upcomingGradeTotals: count(upcomingRows, (row) => row.grade),
      upcomingActionableMarkets: upcomingActionable.length,
    },
    priceHealth: {
      missingCurrentPrice: missingPrice.length,
      missingCurrentPriceByMarket: count(missingPrice, (row) => row.market),
      missingCurrentPriceByScopeAndMarket: count(missingPrice, (row) => `${row.scope}:${row.market}`),
      missingFbsInvolved: missingPrice.filter((row) => row.scope === "fbs_involved"),
      zeroTrail: zeroTrail.length,
      zeroTrailByMarket: count(zeroTrail, (row) => row.market),
      missingPriceSample: missingPrice.slice(0, 40),
      zeroTrailWithCurrentPriceSample: zeroTrail.filter((row) => row.currentPrice !== null).slice(0, 30),
    },
    scoreHealth: {
      expectedMarginAbsBuckets: count(projections, (row) => bucket(Math.abs(row.expectedMarginHome), [1, 2, 3, 6, 10, 14, 21, 28])),
      representativeMarginAbsBuckets: count(projections, (row) => bucket(Math.abs(row.representativeMarginHome), [1, 2, 3, 6, 10, 14, 21, 28])),
      expectedTotalBuckets: count(projections, (row) => bucket(row.expectedTotal, [35, 42, 49, 56, 63, 70, 84])),
      representativeTotalBuckets: count(projections, (row) => bucket(row.representativeTotal, [35, 42, 49, 56, 63, 70, 84])),
      closeExpectedGames: projections.filter((row) => Math.abs(row.expectedMarginHome) <= 2).length,
      closeRepresentativeGames: projections.filter((row) => Math.abs(row.representativeMarginHome) <= 2).length,
      projectionExtremes: [...projections].sort((a, b) => Math.abs(b.expectedMarginHome) - Math.abs(a.expectedMarginHome)).slice(0, 20),
      projectionClosest: [...projections].sort((a, b) => Math.abs(a.expectedMarginHome) - Math.abs(b.expectedMarginHome)).slice(0, 20),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
