#!/usr/bin/env tsx

/** SELECT-only release-pure accuracy audit of the NFL player-props tracking ledger. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { NFL_PLAYER_PROPS_DECISION_RELEASE } from "../../lib/services/football/nflPlayerPropsRuntime";

loadEnvConfig(process.cwd());

type Row = {
  provider_game_id: string;
  market: string;
  side: string;
  play_grade: string;
  result: "pending" | "win" | "loss" | "push" | "void";
  decision_release: string;
  locked_at: string;
};

function summarize(rows: Row[]) {
  const resolved = rows.filter((row) => row.result === "win" || row.result === "loss");
  const wins = resolved.filter((row) => row.result === "win").length;
  return {
    records: rows.length,
    games: new Set(rows.map((row) => row.provider_game_id)).size,
    wins,
    losses: resolved.length - wins,
    pushes: rows.filter((row) => row.result === "push").length,
    voids: rows.filter((row) => row.result === "void").length,
    pending: rows.filter((row) => row.result === "pending").length,
    accuracy: resolved.length ? wins / resolved.length : null,
  };
}

function breakdown(rows: Row[]) {
  const settled = rows.filter((row) => row.result !== "pending");
  const keys = (pick: (row: Row) => string) => [...new Set(settled.map(pick))].sort();
  return {
    overall: summarize(rows),
    settled: summarize(settled),
    byMarket: Object.fromEntries(keys((row) => row.market).map((market) => [market, summarize(settled.filter((row) => row.market === market))])),
    bySide: Object.fromEntries(keys((row) => row.side).map((side) => [side, summarize(settled.filter((row) => row.side === side))])),
    byGrade: Object.fromEntries(keys((row) => row.play_grade).map((grade) => [grade, summarize(settled.filter((row) => row.play_grade === grade))])),
    byMarketSide: Object.fromEntries(keys((row) => `${row.market}:${row.side}`).map((value) => [value, summarize(settled.filter((row) => `${row.market}:${row.side}` === value))])),
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.from("nfl_player_prop_records")
    .select("provider_game_id,market,side,play_grade,result,decision_release,locked_at")
    .order("locked_at", { ascending: true });
  if (error) throw new Error(`NFL player-props tracking read failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const releases = [...new Set(rows.map((row) => row.decision_release))].sort();
  console.log(JSON.stringify({
    release: "nfl_player_props_tracking_accuracy_select_audit_2026_09_26_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
    currentRelease: breakdown(rows.filter((row) => row.decision_release === NFL_PLAYER_PROPS_DECISION_RELEASE)),
    archiveAggregateNotCurrentModelPerformance: breakdown(rows),
    byRelease: Object.fromEntries(releases.map((release) => [release, breakdown(rows.filter((row) => row.decision_release === release))])),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
