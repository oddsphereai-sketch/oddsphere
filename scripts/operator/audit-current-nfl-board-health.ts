#!/usr/bin/env tsx

/** SELECT-only audit of the current published NFL member snapshot. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  auditNflForwardMemberSnapshot,
  readNflForwardMemberSnapshot,
} from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

const MARKETS = ["moneyline", "spread", "total"] as const;

function count<T>(values: T[], key: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function bucket(value: number, boundaries: number[]): string {
  for (const boundary of boundaries) if (value <= boundary) return `<=${boundary}`;
  return `>${boundaries.at(-1)}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const configuredWeek = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? "1");
  const season = Number(process.argv.find((value) => value.startsWith("--season="))?.slice(9) ?? "2026");
  const week = resolveNflForwardWeek({ season, configuredWeek, now: new Date(now) });
  const snapshot = await readNflForwardMemberSnapshot({
    client: createClient(url, key, { auth: { persistSession: false } }),
    season,
    week,
    now,
  });
  if (!snapshot) throw new Error(`Current NFL ${season} Week ${week} member snapshot is unavailable.`);

  const games = snapshot.fixture.snapshot.games;
  const rows = games.flatMap((game) => MARKETS.map((market) => {
    const dto = market === "spread" ? game.markets.first_inning : game.markets[market];
    return {
      gameId: game.id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      market,
      prediction: dto.marketPrediction?.label ?? dto.pick,
      grade: dto.verdict.label,
      held: dto.held,
      price: dto.currentPriceAmerican,
      trailLength: dto.oddsTrail?.length ?? 0,
    };
  }));
  const projections = games.map((game) => {
    const away = game.footballProjection?.expectedAwayPoints ?? game.projected.away;
    const home = game.footballProjection?.expectedHomePoints ?? game.projected.home;
    return {
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      expectedMargin: home - away,
      representativeMargin: game.projected.home - game.projected.away,
      expectedTotal: home + away,
    };
  });
  const nowMs = Date.parse(now);
  const upcoming = rows.filter((row) => Date.parse(row.startsAt ?? "") > nowMs);
  const actionable = upcoming.filter((row) => row.grade === "Lean" || row.grade === "Best Angle");
  const health = auditNflForwardMemberSnapshot({ snapshot, now: new Date(now) });

  console.log(JSON.stringify({
    release: "nfl_current_board_health_select_audit_2026_09_26_r1",
    readOnly: true,
    writes: 0,
    season,
    week,
    now,
    snapshot: {
      snapshotRelease: snapshot.snapshotRelease,
      memberRelease: snapshot.memberRelease,
      evidenceRelease: snapshot.evidenceRelease,
      fixtureRelease: snapshot.fixtureRelease,
      sourceCapturedAt: snapshot.sourceCapturedAt,
      publishedAt: snapshot.publishedAt,
      games: games.length,
      markets: rows.length,
    },
    health,
    board: {
      upcomingMarkets: upcoming.length,
      upcomingGradeTotals: count(upcoming, (row) => row.grade),
      actionableMarkets: actionable.length,
      actionableByMarketAndSide: count(actionable, (row) => `${row.market}:${row.prediction ?? "missing"}`),
      upcomingMissingPrices: upcoming.filter((row) => row.price === null).length,
      upcomingZeroTrails: upcoming.filter((row) => row.trailLength === 0).length,
      upcomingHeld: upcoming.filter((row) => row.held).length,
    },
    scoreHealth: {
      expectedMarginAbsBuckets: count(projections, (row) => bucket(Math.abs(row.expectedMargin), [1, 2, 3, 6, 10, 14, 21])),
      representativeMarginAbsBuckets: count(projections, (row) => bucket(Math.abs(row.representativeMargin), [1, 2, 3, 6, 10, 14, 21])),
      expectedTotalBuckets: count(projections, (row) => bucket(row.expectedTotal, [35, 42, 49, 56, 63, 70])),
      closeExpectedGames: projections.filter((row) => Math.abs(row.expectedMargin) <= 2).length,
      closeRepresentativeGames: projections.filter((row) => Math.abs(row.representativeMargin) <= 2).length,
    },
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
