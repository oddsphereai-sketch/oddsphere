#!/usr/bin/env tsx

/** SELECT-only audit of CFB price/split capture freshness for one kickoff date. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

type Row = {
  id: string;
  evidence_release: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
  payload: Record<string, unknown>;
};

const PAGE_SIZE = 1_000;
const MAX_ROWS = 12_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timestamp(value: unknown): number | null {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<void> {
  const date = process.argv.find((value) => value.startsWith("--date="))?.slice(7) ?? "2026-10-03";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const from = `${date}T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + 86_400_000).toISOString();
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await client
      .from("cfb_forward_evidence_snapshots")
      .select("id,evidence_release,provider_game_id,stage,captured_at,game_start_at,payload")
      .gte("game_start_at", from)
      .lt("game_start_at", to)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new Error(`CFB historical evidence read failed: ${result.error.message}`);
    const page = (result.data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length >= MAX_ROWS) throw new Error(`CFB historical freshness audit exceeded ${MAX_ROWS} rows.`);

  const latest = new Map<string, Row>();
  for (const row of rows) {
    const capture = timestamp(row.captured_at);
    const kickoff = timestamp(row.game_start_at);
    if (capture === null || kickoff === null || capture > kickoff) continue;
    const current = latest.get(row.provider_game_id);
    if (!current || Date.parse(current.captured_at) < capture ||
      (current.captured_at === row.captured_at && current.id < row.id)) latest.set(row.provider_game_id, row);
  }

  const games = [...latest.values()].map((row) => {
    const payload = record(row.payload);
    const game = record(payload.game);
    const market = record(payload.market);
    const splits = record(market.playbookSplits);
    const splitObserved = ["moneyline", "spread", "total"]
      .map((key) => timestamp(record(splits[key]).capturedAt))
      .filter((value): value is number => value !== null);
    const newestSplit = splitObserved.length ? Math.max(...splitObserved) : null;
    const captured = Date.parse(row.captured_at);
    const coverage = record(payload.coverage);
    return {
      providerGameId: row.provider_game_id,
      matchup: `${record(game.away).abbreviation ?? "?"}@${record(game.home).abbreviation ?? "?"}`,
      stage: row.stage,
      capturedAt: row.captured_at,
      gameStartAt: row.game_start_at,
      captureLeadMinutes: (Date.parse(row.game_start_at) - captured) / 60_000,
      playbookLine: coverage.playbookLine === true,
      playbookSplits: coverage.playbookSplits === true,
      splitAgeAtCaptureMinutes: newestSplit === null ? null : (captured - newestSplit) / 60_000,
      warnings: Array.isArray(coverage.availabilityWarnings) ? coverage.availabilityWarnings : [],
      release: row.evidence_release,
    };
  });
  const staleSplits = games.filter((game) => game.splitAgeAtCaptureMinutes !== null && game.splitAgeAtCaptureMinutes > 120);
  const missingSplits = games.filter((game) => !game.playbookSplits);
  const missingLines = games.filter((game) => !game.playbookLine);
  const logs = await client
    .from("data_refresh_log")
    .select("refresh_started_at,refresh_completed_at,refresh_status,records_updated,error_message,api_calls_made")
    .eq("data_source", "cfb_forward_evidence")
    .eq("sport", "cfb")
    .gte("refresh_started_at", from)
    .lt("refresh_started_at", to)
    .order("refresh_started_at", { ascending: true });
  if (logs.error) throw new Error(`CFB refresh-log read failed: ${logs.error.message}`);

  console.log(JSON.stringify({
    release: "cfb_historical_market_freshness_select_audit_2026_10_06_r1",
    readOnly: true,
    writes: 0,
    date,
    evidenceRows: rows.length,
    games: games.length,
    latestBeforeKickoff: {
      playbookLine: games.filter((game) => game.playbookLine).length,
      playbookSplits: games.filter((game) => game.playbookSplits).length,
      missingLines: missingLines.length,
      missingSplits: missingSplits.length,
      splitsOverTwoHoursOldAtCapture: staleSplits.length,
    },
    staleSplits,
    missingLines,
    missingSplits,
    refreshRuns: logs.data ?? [],
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

