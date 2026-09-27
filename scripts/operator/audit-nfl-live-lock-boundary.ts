#!/usr/bin/env tsx

/** SELECT-only audit of the live NFL lock boundary for named matchups. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardMemberSnapshot } from "../../lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

const MATCHUPS = new Set(["ARI@SF", "MIN@TB", "BAL@DAL", "LV@NO"]);

type AuditPayload = {
  captureTiming?: unknown;
  t60LagMinutes?: unknown;
  coverage?: { healthHolds?: unknown };
  decisions?: {
    publicationEnabled?: unknown;
    trackingEnabled?: unknown;
    evaluatedBets?: Array<Record<string, unknown>>;
  };
};

async function main(): Promise<void> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now: new Date(now) });
  const [snapshot, evidenceRead, trackingRead, refreshRead, leaseRead] = await Promise.all([
    readNflForwardMemberSnapshot({ client, season, week, now }),
    client.from("nfl_forward_evidence_snapshots")
      .select("id,provider_game_id,away_team,home_team,game_start_at,stage,captured_at,cutoff_at,payload_sha256,payload")
      .eq("season", season)
      .eq("week", week)
      .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
      .order("captured_at", { ascending: false })
      .limit(1000),
    client.from("prediction_records")
      .select("id,external_id,matchup,market,pick,side,line_value,odds_american,play_grade,locked_at,model_version,snapshot_json")
      .eq("sport", "nfl")
      .eq("slate_date", "2026-09-27")
      .order("external_id", { ascending: true })
      .order("market", { ascending: true }),
    client.from("data_refresh_log")
      .select("id,data_source,sport,refresh_status,refresh_started_at,refresh_completed_at,records_updated,api_calls_made,error_message")
      .eq("data_source", "nfl_forward_evidence")
      .eq("sport", "nfl")
      .order("refresh_started_at", { ascending: false })
      .limit(12),
    client.from("cron_job_leases")
      .select("job_name,run_id,lease_expires_at,acquired_at,heartbeat_at")
      .eq("job_name", "prediction_pipeline:nfl")
      .limit(10),
  ]);
  if (evidenceRead.error) throw new Error(`Evidence audit failed: ${evidenceRead.error.message}`);
  if (trackingRead.error) throw new Error(`Tracking audit failed: ${trackingRead.error.message}`);
  if (refreshRead.error) throw new Error(`Refresh audit failed: ${refreshRead.error.message}`);
  if (leaseRead.error) throw new Error(`Lease audit failed: ${leaseRead.error.message}`);

  const allEvidence = (evidenceRead.data ?? []).filter((row) => MATCHUPS.has(`${row.away_team}@${row.home_team}`));
  const evidenceByGameStage = new Map<string, (typeof allEvidence)[number]>();
  for (const row of allEvidence) {
    const key = `${row.provider_game_id}:${row.stage}`;
    if (!evidenceByGameStage.has(key)) evidenceByGameStage.set(key, row);
  }
  const evidence = [...evidenceByGameStage.values()].sort((left, right) =>
    String(left.provider_game_id).localeCompare(String(right.provider_game_id)) ||
    String(left.stage).localeCompare(String(right.stage)));
  const providerIds = new Set(evidence.map((row) => Number(row.provider_game_id)));
  const tracking = (trackingRead.data ?? []).filter((row) => providerIds.has(Number(row.external_id)));
  const games = snapshot?.fixture.snapshot.games.filter((game) => MATCHUPS.has(`${game.awayTeam}@${game.homeTeam}`)) ?? [];
  console.log(JSON.stringify({
    readOnly: true,
    now,
    season,
    week,
    snapshot: snapshot ? {
      publishedAt: snapshot.publishedAt,
      sourceCapturedAt: snapshot.sourceCapturedAt,
      release: snapshot.snapshotRelease,
      games: games.map((game) => ({
        matchup: `${game.awayTeam}@${game.homeTeam}`,
        externalId: game.external_id,
        startsAt: game.gameStartAt,
        lockState: game.lockState,
        lockedAt: game.lockedAt,
        predictions: {
          moneyline: game.markets.moneyline.marketPrediction?.label ?? game.markets.moneyline.pick,
          spread: game.markets.first_inning.marketPrediction?.label ?? game.markets.first_inning.pick,
          total: game.markets.total.marketPrediction?.label ?? game.markets.total.pick,
        },
      })),
    } : null,
    evidence: evidence.map((row) => {
      const payload = row.payload as AuditPayload;
      return {
        id: row.id,
        matchup: `${row.away_team}@${row.home_team}`,
        externalId: row.provider_game_id,
        startsAt: row.game_start_at,
        stage: row.stage,
        capturedAt: row.captured_at,
        cutoffAt: row.cutoff_at,
        captureTiming: payload.captureTiming,
        t60LagMinutes: payload.t60LagMinutes,
        healthHolds: payload.coverage?.healthHolds,
        publicationEnabled: payload.decisions?.publicationEnabled,
        trackingEnabled: payload.decisions?.trackingEnabled,
        decisionCount: payload.decisions?.evaluatedBets?.length,
        decisions: payload.decisions?.evaluatedBets?.map((decision) => {
          const quote = isRecord(decision.evaluatedQuote) ? decision.evaluatedQuote : {};
          return {
            market: decision.market,
            side: decision.side,
            line: quote.line,
            price: quote.price,
            grade: decision.grade,
            stage: decision.stage,
            lockedAt: decision.lockedAt,
          };
        }),
        sha256: row.payload_sha256,
      };
    }),
    tracking: tracking.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      matchup: row.matchup,
      market: row.market,
      pick: row.pick,
      side: row.side,
      line: row.line_value,
      price: row.odds_american,
      grade: row.play_grade,
      lockedAt: row.locked_at,
      modelVersion: row.model_version,
      evidenceSha256: (row.snapshot_json as Record<string, unknown> | null)?.evidence_payload_sha256 ?? null,
    })),
    refreshes: refreshRead.data,
    leases: leaseRead.data,
  }, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
