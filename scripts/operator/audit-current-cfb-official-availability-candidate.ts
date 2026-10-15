#!/usr/bin/env tsx

/** Zero-write replay of current official CFB availability against stored game/QB identity. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type CfbForwardTeamQuarterbacks,
} from "../../lib/services/football/cfbForwardEvidence";
import type { NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { fetchCfbOfficialConferenceAvailability } from "../../lib/services/football/cfbOfficialConferenceAvailability";
import { reportedCfbQuarterbackAvailability } from "../../lib/services/football/cfbVerifiedAvailability";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

type Row = {
  id: string;
  provider_game_id: string;
  captured_at: string;
  game_start_at: string;
  game: NcaafGame;
  quarterbacks: { away: CfbForwardTeamQuarterbacks; home: CfbForwardTeamQuarterbacks };
  stored_report: { source?: string; reportUpdatedAt?: string | null } | null;
  official_requests: number | null;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const window = activeCfbWeeklyWindow(now);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client
    .from("cfb_forward_evidence_snapshots")
    .select([
      "id",
      "provider_game_id",
      "captured_at",
      "game_start_at",
      "game:payload->game",
      "quarterbacks:payload->quarterbacks",
      "stored_report:payload->availability->report",
      "official_requests:payload->requestBudget->officialAvailability",
    ].join(","))
    .eq("season", Number(now.slice(0, 4)))
    .eq("evidence_release", CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .order("captured_at", { ascending: true })
    .limit(10_000);
  if (error) throw new Error(`CFB official-availability candidate read failed: ${error.message}`);
  const latest = new Map<string, Row>();
  for (const row of (data ?? []) as unknown as Row[]) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.game_start_at }, window)) continue;
    const current = latest.get(row.provider_game_id);
    if (!current || Date.parse(row.captured_at) > Date.parse(current.captured_at) ||
      (row.captured_at === current.captured_at && row.id.localeCompare(current.id) > 0)) {
      latest.set(row.provider_game_id, row);
    }
  }
  const rows = [...latest.values()];
  const live = await fetchCfbOfficialConferenceAvailability({ games: rows.map((row) => row.game), capturedAt: now });
  const liveIds = new Set(Object.keys(live.reportsByGame));
  const storedIds = new Set(rows.filter((row) => row.stored_report !== null).map((row) => row.provider_game_id));
  const qbMatches = rows.flatMap((row) => {
    const report = live.reportsByGame[row.provider_game_id] ?? null;
    if (!report) return [];
    const availability = reportedCfbQuarterbackAvailability({
      game: row.game,
      away: row.quarterbacks.away,
      home: row.quarterbacks.home,
      report,
      capturedAt: now,
    });
    return availability ? [{
      gameId: row.provider_game_id,
      matchup: `${row.game.away.abbreviation}@${row.game.home.abbreviation}`,
      team: availability.team,
      expectedQuarterback: availability.unavailablePlayerName,
      replacementQuarterback: availability.replacementPlayerName,
      designation: availability.designation,
      observedAt: availability.observedAt,
      sourceAuthority: availability.sourceAuthority,
    }] : [];
  });

  console.log(JSON.stringify({
    release: "cfb_official_availability_candidate_2026_10_15_r1_per_game_cadence",
    mode: "live_official_provider_read_plus_production_select_zero_writes",
    writes: 0,
    now,
    window,
    games: rows.length,
    providerRequests: live.requests,
    providerFailures: live.failures,
    storedVerifiedReports: storedIds.size,
    gamesMarkedWithOfficialAttempt: rows.filter((row) => (row.official_requests ?? 0) > 0).length,
    liveExactGameReports: liveIds.size,
    recoveredByCandidate: [...liveIds].filter((gameId) => !storedIds.has(gameId)).sort(),
    recoveredByCandidateCount: [...liveIds].filter((gameId) => !storedIds.has(gameId)).length,
    candidateVerifiedReports: new Set([...storedIds, ...liveIds]).size,
    exactExpectedQuarterbackMatches: qbMatches.length,
    quarterbackMatches: qbMatches,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
