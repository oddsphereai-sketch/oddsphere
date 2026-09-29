#!/usr/bin/env tsx

/** SELECT-only audit of the current NFL weekly rollover and publication chain. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "../../lib/services/football/nflForwardEvidence";
import {
  NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
  nflForwardMemberSnapshotKey,
  readNflForwardMemberSnapshot,
} from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  nflPlayerPropsSnapshotKey,
  readNflPlayerPropsSnapshotRecord,
} from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const adjacentWeeks = [Math.max(1, week - 1), week, week + 1];

  const [member, state, evidence, logs, lease, snapshotRows, ...props] = await Promise.all([
    readNflForwardMemberSnapshot({ client, season, week, now: now.toISOString() }),
    readNflPlayerPropsCurrentSeasonState({ client, season }),
    client.from("nfl_forward_evidence_snapshots")
      .select("week,provider_game_id,away_team,home_team,game_start_at,stage,captured_at,evidence_release,payload")
      .eq("season", season)
      .in("week", adjacentWeeks)
      .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
      .order("captured_at", { ascending: false })
      .limit(5000),
    client.from("data_refresh_log")
      .select("data_source,sport,refresh_status,refresh_started_at,refresh_completed_at,records_updated,api_calls_made,error_message")
      .eq("sport", "nfl")
      .order("refresh_started_at", { ascending: false })
      .limit(40),
    client.from("cron_job_leases")
      .select("job_name,run_id,lease_expires_at,acquired_at,heartbeat_at")
      .eq("job_name", "prediction_pipeline:nfl")
      .limit(5),
    client.from("lab_response_snapshots")
      .select("snapshot_key,payload_version,source,generated_at,updated_at")
      .or([
        `snapshot_key.eq.${nflForwardMemberSnapshotKey({ season, week })}`,
        ...adjacentWeeks.map((candidateWeek) => `snapshot_key.eq.${nflPlayerPropsSnapshotKey(season, candidateWeek)}`),
        `snapshot_key.eq.nfl::player-props-current-season::${season}`,
      ].join(","))
      .order("updated_at", { ascending: false }),
    ...adjacentWeeks.map((candidateWeek) => readNflPlayerPropsSnapshotRecord({ client, season, week: candidateWeek })),
  ]);

  if (evidence.error) throw new Error(`Evidence audit failed: ${evidence.error.message}`);
  if (logs.error) throw new Error(`Refresh-log audit failed: ${logs.error.message}`);
  if (lease.error) throw new Error(`Lease audit failed: ${lease.error.message}`);
  if (snapshotRows.error) throw new Error(`Snapshot-row audit failed: ${snapshotRows.error.message}`);

  const evidenceRows = evidence.data ?? [];
  const priorWeekCurrent = new Map<string, (typeof evidenceRows)[number]>();
  for (const row of evidenceRows.filter((candidate) => candidate.week === week)) {
    const key = String(row.provider_game_id);
    if (!priorWeekCurrent.has(key)) priorWeekCurrent.set(key, row);
  }
  const evidenceSummary = adjacentWeeks.map((candidateWeek) => {
    const rows = evidenceRows.filter((row) => row.week === candidateWeek);
    const games = new Set(rows.map((row) => row.provider_game_id));
    const stages: Record<string, number> = {};
    for (const row of rows) stages[row.stage] = (stages[row.stage] ?? 0) + 1;
    return {
      week: candidateWeek,
      rows: rows.length,
      games: games.size,
      stages,
      latestCapturedAt: rows[0]?.captured_at ?? null,
      gameIds: [...games].map(String).sort(),
      matchups: [...new Set(rows.map((row) => `${row.away_team}@${row.home_team}`))].sort(),
      starts: [...new Set(rows.map((row) => row.game_start_at))].sort(),
    };
  });

  console.log(JSON.stringify({
    readOnly: true,
    now: now.toISOString(),
    resolvedWeek: week,
    releases: {
      evidence: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      member: NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    },
    dailyEdge: member ? {
      week: member.week,
      publishedAt: member.publishedAt,
      sourceCapturedAt: member.sourceCapturedAt,
      games: member.fixture.snapshot.games.length,
      slateDate: member.fixture.snapshot.date,
    } : null,
    currentSeasonState: state ? {
      release: state.release,
      completeThroughWeek: state.completeThroughWeek,
      updatedAt: state.updatedAt,
      games: state.games.length,
      teamStats: state.teamStats.length,
      playerStats: state.stats.length,
    } : null,
    evidence: evidenceSummary,
    failedGameEvidence: evidenceRows
      .filter((row) => String(row.provider_game_id) === "1392268")
      .slice(0, 3)
      .map((row) => {
        const payload = row.payload as {
          game?: unknown;
          forecasts?: unknown;
          decisions?: unknown;
          coverage?: unknown;
        };
        return {
          week: row.week,
          matchup: `${row.away_team}@${row.home_team}`,
          stage: row.stage,
          capturedAt: row.captured_at,
          game: payload.game,
          forecasts: payload.forecasts,
          decisions: payload.decisions,
          coverage: payload.coverage,
        };
      }),
    priorWeekEvaluations: [...priorWeekCurrent.values()].flatMap((row) => {
      const payload = row.payload as { decisions?: { evaluatedBets?: Array<{ market?: unknown; side?: unknown; grade?: unknown }> } };
      return (payload.decisions?.evaluatedBets ?? []).map((decision) => ({
        gameId: String(row.provider_game_id),
        matchup: `${row.away_team}@${row.home_team}`,
        market: decision.market,
        side: decision.side,
        grade: decision.grade,
      }));
    }),
    playerProps: props.map((record, index) => ({
      week: adjacentWeeks[index],
      generatedAt: record?.generatedAt ?? null,
      release: record?.snapshot.release ?? null,
      board: record?.snapshot.board.decisions.length ?? 0,
      memberDecisions: record?.snapshot.memberDecisions.length ?? 0,
      games: record ? new Set(record.snapshot.board.decisions.map((row) => row.gameId)).size : 0,
    })),
    snapshotRows: snapshotRows.data ?? [],
    refreshLogs: logs.data ?? [],
    leases: lease.data ?? [],
  }, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
