#!/usr/bin/env tsx

/**
 * Re-publishes the compact NFL member snapshot from immutable stored evidence.
 * It never recollects, recomputes, or mutates an evidence or tracking row.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";
import {
  buildNflForwardMemberSnapshot,
  writeNflForwardMemberSnapshot,
} from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

const TARGETS = new Set(["ARI@SF", "MIN@TB", "BAL@DAL", "LV@NO"]);

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const publishedAt = new Date().toISOString();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now: new Date(publishedAt) });
  const evidence = await readNflForwardEvidence({ client, season, week });
  const fixture = buildNflWeekOneHeldMemberFixture(evidence);
  const snapshot = buildNflForwardMemberSnapshot({ fixture, season, week, publishedAt });
  const targets = fixture.snapshot.games
    .filter((game) => TARGETS.has(`${game.awayTeam}@${game.homeTeam}`))
    .map((game) => ({
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: game.gameStartAt,
      lockState: game.lockState,
      lockedAt: game.lockedAt,
      moneyline: game.markets.moneyline.marketPrediction?.label ?? game.markets.moneyline.pick,
      spread: game.markets.first_inning.marketPrediction?.label ?? game.markets.first_inning.pick,
      total: game.markets.total.marketPrediction?.label ?? game.markets.total.pick,
    }));
  if (targets.length !== TARGETS.size) throw new Error(`Expected ${TARGETS.size} target games; received ${targets.length}.`);
  if (targets.some((game) => game.lockState !== "locked" || !game.lockedAt)) {
    throw new Error(`Refusing snapshot repair: target lock proof failed: ${JSON.stringify(targets)}.`);
  }
  const write = apply ? await writeNflForwardMemberSnapshot({ client, snapshot }) : null;
  if (apply && !write?.ok) throw new Error(`NFL member snapshot repair failed: ${write?.error ?? "unknown error"}`);
  console.log(JSON.stringify({
    release: "nfl_member_lock_snapshot_repair_2026_09_27_r1",
    apply,
    evidenceRows: evidence.length,
    games: fixture.snapshot.games.length,
    sourceCapturedAt: snapshot.sourceCapturedAt,
    publishedAt: snapshot.publishedAt,
    snapshotRelease: snapshot.snapshotRelease,
    targets,
    write,
  }, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
