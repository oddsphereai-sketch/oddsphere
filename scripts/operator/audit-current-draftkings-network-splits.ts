#!/usr/bin/env tsx

/** Bounded read-only coverage audit for the DraftKings Network split fallback. */

import { createClient } from "@supabase/supabase-js";
import {
  applyDraftKingsNetworkSplitFallback,
  fetchDraftKingsNetworkSplits,
} from "../../lib/providers/draftkings/draftKingsNetworkSplits";
import { readCfbForwardMemberSnapshot } from "../../lib/services/football/cfbForwardMemberSnapshotStore";
import type { Sport } from "../../lib/types/domain/Sport";

const sports = (process.argv.find((value) => value.startsWith("--sports="))?.slice(9) ?? "cfb,nfl,mlb")
  .split(",") as Sport[];

async function main(): Promise<void> {
  const report: Record<string, unknown> = { mode: "read_only", databaseWrites: 0 };
  for (const sport of sports) {
    const feed = await fetchDraftKingsNetworkSplits({ sport, timeoutMs: 15_000 });
    const games = feed?.games ?? [];
    report[sport] = {
      fetchedAt: feed?.fetchedAt ?? null,
      games: games.length,
      completeMoneyline: games.filter((game) => game.markets.moneyline).length,
      completeSpread: games.filter((game) => game.markets.spread).length,
      completeTotal: games.filter((game) => game.markets.total).length,
    };
    if (sport === "cfb" && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const snapshot = await readCfbForwardMemberSnapshot({
        client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
        season: 2026,
      });
      if (snapshot) {
        const response = structuredClone(snapshot.fixture.snapshot);
        const applied = applyDraftKingsNetworkSplitFallback(response, feed);
        const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        const { data: durable } = await client
          .from("lab_response_snapshots")
          .select("payload")
          .eq("snapshot_key", "daily-edge::draftkings-network-splits::cfb::draftkings_network_splits_2026_09_20_r2_durable_last_known_good")
          .maybeSingle();
        const durableGames = durable && typeof durable.payload === "object" && durable.payload !== null && Array.isArray((durable.payload as { games?: unknown[] }).games)
          ? (durable.payload as { games: unknown[] }).games.length
          : 0;
        report.cfb = {
          ...(report.cfb as Record<string, unknown>),
          durableSnapshotGames: durableGames,
          currentBoardGames: response.games.length,
          exactMatchedBoardGames: applied.matchedGames,
          populatedBoardMarkets: applied.populatedMarkets,
        };
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
