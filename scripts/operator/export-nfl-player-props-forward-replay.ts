#!/usr/bin/env tsx

/** SELECT-only locked NFL player-props replay export for market-marriage research. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import { readNflPlayerPropsSnapshot } from "../../lib/services/football/nflPlayerPropsSnapshotStore";
import type { NflPlayerPropsRuntimeDecision } from "../../lib/services/football/nflPlayerPropsRuntime";

loadEnvConfig(process.cwd());

const OUTPUT = "football-research/cache/nfl-player-props-forward/nfl_player_props_forward_replay_r1.json";

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}

function actualFor(row: NflPlayerPropsRuntimeDecision, stat: Record<string, unknown>): number | null {
  const key = row.market === "anytime_td" ? null : row.market;
  if (key) {
    const value = stat[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  const fields = ["rushing_touchdowns", "receiving_touchdowns", "kick_return_touchdowns", "punt_return_touchdowns", "fumbles_touchdowns"];
  const values = fields.map((field) => stat[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const state = await readNflPlayerPropsCurrentSeasonState({ client, season: 2026 });
  if (!state) throw new Error("NFL props current-season state is missing.");
  const stats = new Map(state.stats.map((row) => [`${row.gameId}|${normalizeName(row.playerName)}`, row as unknown as Record<string, unknown>]));
  const { data: trackedData, error: trackedError } = await client
    .from("nfl_player_prop_records")
    .select("provider_game_id,player_name,market,actual_value,result")
    .in("result", ["win", "loss", "push"]);
  if (trackedError) throw new Error(`NFL player-props settled tracking read failed: ${trackedError.message}`);
  const trackedActuals = new Map<string, number>();
  for (const value of trackedData ?? []) {
    const actual = Number(value.actual_value);
    if (!Number.isFinite(actual)) continue;
    trackedActuals.set(
      `${value.provider_game_id}|${normalizeName(String(value.player_name))}|${value.market}`,
      actual,
    );
  }
  const rows: unknown[] = [];
  const snapshots: unknown[] = [];
  for (let week = 1; week <= 4; week += 1) {
    const snapshot = await readNflPlayerPropsSnapshot({ client, season: 2026, week });
    if (!snapshot) continue;
    const locked = snapshot.memberDecisions.filter((row) => row.state === "locked");
    snapshots.push({
      week,
      release: snapshot.release,
      generatedAt: snapshot.generatedAt,
      boardRelease: snapshot.board.release,
      decisions: locked.length,
      evidenceIdentities: snapshot.board.marketEvidence?.i.length ?? 0,
    });
    const evidence = new Map(snapshot.board.marketEvidence?.i.map((identity) => [identity[0], identity]) ?? []);
    for (const row of locked) {
      const stat = stats.get(`${row.gameId}|${normalizeName(row.playerName)}`);
      const actual = stat
        ? actualFor(row, stat)
        : trackedActuals.get(`${row.gameId}|${normalizeName(row.playerName)}|${row.market}`) ?? null;
      const tuple = row.marketEvidenceId ? evidence.get(row.marketEvidenceId) : undefined;
      rows.push({
        week,
        gameId: row.gameId,
        playerName: row.playerName,
        team: row.team,
        opponent: row.opponent,
        market: row.market,
        line: row.line,
        side: row.side,
        sportsbook: row.sportsbook,
        price: row.americanPrice,
        observedAt: row.observedAt,
        lockAt: row.lockAt,
        grade: row.grade,
        modelRelease: row.modelRelease,
        calibrationRelease: row.calibrationRelease,
        decisionRelease: row.decisionRelease,
        projection: row.projection,
        independentProjection: row.projectionEvidence && "independentProjection" in row.projectionEvidence
          ? row.projectionEvidence.independentProjection
          : row.projectionEvidence && "roleProjection" in row.projectionEvidence
            ? row.projectionEvidence.roleProjection
            : row.projection,
        rawProbability: row.rawModelProbability,
        marketProbability: row.marketProbability,
        finalProbability: row.finalProbability,
        probabilityEdge: row.probabilityEdge,
        expectedValue: row.expectedValue,
        movement: row.marketMovement,
        participationProbability: row.participationProbability,
        actual,
        win: actual === null ? null : row.side === "over" ? actual > row.line
          : row.side === "under" ? actual < row.line : actual >= 1,
        push: actual === null ? null : row.side !== "yes" && actual === row.line,
        evidence: tuple ? {
          books: tuple[2],
          breadth: tuple[3],
          output: tuple[4],
        } : null,
      });
    }
  }
  const output = {
    release: "nfl_player_props_forward_replay_2026_09_28_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    currentSeasonStateRelease: state.release,
    currentSeasonCompleteThroughWeek: state.completeThroughWeek,
    settledTrackingActualIdentities: trackedActuals.size,
    snapshots,
    rows,
  };
  mkdirSync("football-research/cache/nfl-player-props-forward", { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: OUTPUT, snapshots, rows: rows.length }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
