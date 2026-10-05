#!/usr/bin/env tsx

/** SELECT-only live NFL player-props role and posterior coherence audit. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const season = Number(process.argv.find((value) => value.startsWith("--season="))?.slice(9) ?? "2026");
  const week = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? "4");
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error("NFL player-props snapshot is unavailable.");
  const rows = record.snapshot.memberDecisions;
  const incoherent = rows.filter((row) => row.market !== "anytime_td" && row.projection !== null && (
    (row.side === "over" && row.projection > row.line && row.finalProbability < 0.5) ||
    (row.side === "under" && row.projection < row.line && row.finalProbability < 0.5)
  ));
  const keenum = rows.filter((row) => row.playerName.toLowerCase().includes("keenum"));
  console.log(JSON.stringify({
    release: "nfl_player_props_live_coherence_audit_2026_09_28_r1",
    readOnly: true,
    writes: 0,
    generatedAt: record.generatedAt,
    season,
    week,
    snapshotRelease: record.snapshot.release,
    boardRelease: record.snapshot.board.release,
    memberRows: rows.length,
    incoherentRows: incoherent.length,
    incoherentExamples: incoherent.slice(0, 20).map((row) => ({
      playerName: row.playerName, team: row.team, market: row.market, line: row.line, side: row.side,
      projection: row.projection, rawModelProbability: row.rawModelProbability,
      marketProbability: row.marketProbability, finalProbability: row.finalProbability,
      grade: row.grade, healthHolds: row.healthHolds,
    })),
    caseKeenum: keenum.map((row) => ({
      market: row.market, line: row.line, side: row.side, projection: row.projection,
      rawModelProbability: row.rawModelProbability, marketProbability: row.marketProbability,
      finalProbability: row.finalProbability, grade: row.grade, healthHolds: row.healthHolds,
      forecastContext: row.forecastContext,
    })),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
