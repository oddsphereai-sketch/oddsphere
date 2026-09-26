#!/usr/bin/env tsx

/** SELECT-only audit of whether missing current CFB prices existed in prior evidence. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { readCfbForwardMemberSnapshot } from "../../lib/services/football/cfbForwardMemberSnapshotStore";
import type { NcaafBookOdds } from "../../lib/services/football/balldontlieNcaafSlate";
import type { CfbMemberFixture } from "../../lib/services/football/cfbMemberFixture";

loadEnvConfig(process.cwd());

type Market = "moneyline" | "spread" | "total";
const MARKETS: Market[] = ["moneyline", "spread", "total"];

function marketDto(game: CfbMemberFixture["snapshot"]["games"][number], market: Market) {
  return market === "spread" ? game.markets.first_inning : game.markets[market];
}

function hasMarket(book: NcaafBookOdds, market: Market): boolean {
  return market === "moneyline" ? book.moneyline !== null : market === "spread" ? book.spread !== null : book.total !== null;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const [snapshot, evidence] = await Promise.all([
    readCfbForwardMemberSnapshot({ client, season: 2026, now }),
    readCfbForwardEvidence({ client, season: 2026 }),
  ]);
  if (!snapshot) throw new Error("Current CFB member snapshot is unavailable.");
  const rows = snapshot.fixture.snapshot.games.flatMap((game) => MARKETS.flatMap((market) => {
    const dto = marketDto(game, market);
    if (dto.currentPriceAmerican !== null) return [];
    const providerGameId = String(game.id).replace(/^cfb-/, "");
    const prior = evidence
      .filter((row) => row.providerGameId === providerGameId && Date.parse(row.capturedAt) < Date.parse(game.gameStartAt ?? ""))
      .flatMap((row) => row.payload.market.currentBooks
        .filter((book) => hasMarket(book, market))
        .map((book) => ({ row, book })))
      .sort((left, right) => Date.parse(right.book.marketObservedAt?.[market] ?? right.book.observedAt)
        - Date.parse(left.book.marketObservedAt?.[market] ?? left.book.observedAt))[0];
    return [{
      providerGameId,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      market,
      scope: game.collegeFootballScope ?? "unknown",
      priorCompleteBook: prior ? {
        sportsbook: prior.book.sportsbook,
        provider: prior.book.provider,
        targetEligible: prior.book.targetEligible,
        observedAt: prior.book.marketObservedAt?.[market] ?? prior.book.observedAt,
        capturedAt: prior.row.capturedAt,
      } : null,
    }];
  }));
  const upcoming = rows.filter((row) => Date.parse(row.startsAt ?? "") > Date.parse(now));
  console.log(JSON.stringify({
    release: "cfb_missing_price_continuity_select_audit_2026_09_26_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    now,
    missingMarkets: rows.length,
    missingWithPriorCompleteBook: rows.filter((row) => row.priorCompleteBook !== null).length,
    upcomingMissingMarkets: upcoming.length,
    upcomingMissingWithPriorCompleteBook: upcoming.filter((row) => row.priorCompleteBook !== null).length,
    upcoming,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
