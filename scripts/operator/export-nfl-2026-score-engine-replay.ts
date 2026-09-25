/** Read-only frozen-input export for the NFL score-engine 2026 replay. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabase } from "@/lib/db/supabase";
import { hashNflForwardEvidencePayload, type NflForwardEvidencePayload } from "@/lib/services/football/nflForwardEvidence";
import { readNflPlayerPropsCurrentSeasonState } from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";

type Grade = { actual_home_score: number | null; actual_away_score: number | null };
type RecordRow = {
  id: number;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type EvidenceRow = { payload_sha256: string; payload: NflForwardEvidencePayload };

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function main() {
  const state = await readNflPlayerPropsCurrentSeasonState({ client: supabase, season: 2026 });
  if (!state || state.completeThroughWeek < 2) throw new Error("NFL 2026 current-season state is incomplete through Week 2.");
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,snapshot_json,prediction_grades(*)")
    .eq("sport", "nfl")
    .eq("market", "moneyline")
    .not("locked_at", "is", null)
    .order("id", { ascending: true });
  if (error) throw new Error(`NFL replay tracking read failed: ${error.message}`);
  const records = ((data ?? []) as unknown as RecordRow[]).filter((row) =>
    typeof row.snapshot_json?.supersedes_prediction_record_id !== "number");
  const hashes = [...new Set(records.flatMap((row) => {
    const value = row.snapshot_json?.evidence_payload_sha256;
    return typeof value === "string" ? [value] : [];
  }))];
  const evidence: EvidenceRow[] = [];
  for (let index = 0; index < hashes.length; index += 100) {
    const read = await supabase.from("nfl_forward_evidence_snapshots")
      .select("payload_sha256,payload")
      .in("payload_sha256", hashes.slice(index, index + 100));
    if (read.error) throw new Error(`NFL replay evidence read failed: ${read.error.message}`);
    evidence.push(...((read.data ?? []) as unknown as EvidenceRow[]));
  }
  const byHash = new Map(evidence.map((row) => {
    if (hashNflForwardEvidencePayload(row.payload) !== row.payload_sha256) {
      throw new Error(`NFL replay evidence checksum mismatch: ${row.payload_sha256}`);
    }
    return [row.payload_sha256, row.payload] as const;
  }));
  const games = records.flatMap((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    const payload = typeof hash === "string" ? byHash.get(hash) : null;
    const grade = one(record.prediction_grades);
    const odds = payload?.market.current;
    if (!payload || !grade || grade.actual_home_score === null || grade.actual_away_score === null || !odds?.moneyline || !odds.spread || !odds.total) return [];
    return [{
      providerGameId: payload.game.providerGameId,
      week: payload.week,
      scheduledStart: payload.game.scheduledStart,
      homeTeam: payload.game.home.abbreviation,
      awayTeam: payload.game.away.abbreviation,
      homeScore: grade.actual_home_score,
      awayScore: grade.actual_away_score,
      marketHomeMargin: -odds.spread.homeLine,
      marketTotal: odds.total.line,
      homeMoneyline: odds.moneyline.homePrice,
      awayMoneyline: odds.moneyline.awayPrice,
      homeSpreadOdds: odds.spread.homePrice,
      awaySpreadOdds: odds.spread.awayPrice,
      overOdds: odds.total.overPrice,
      underOdds: odds.total.underPrice,
      publishedExpectedHomeScore: payload.outcomeForecast.expectedHomeScore,
      publishedExpectedAwayScore: payload.outcomeForecast.expectedAwayScore,
      marketEvidence: payload.outcomeForecast.marketEvidence ?? null,
      evidencePayloadSha256: hash,
      capturedAt: payload.capturedAt,
    }];
  }).filter((game) => game.week <= 2);
  if (games.length !== 32) throw new Error(`Expected 32 settled Week 1-2 games, received ${games.length}.`);
  const output = {
    release: "nfl_2026_score_engine_replay_inputs_2026_09_25_r1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    state,
    games: games.sort((a, b) => a.week - b.week || a.scheduledStart.localeCompare(b.scheduledStart)),
  };
  const directory = path.join(process.cwd(), "football-research", "reports");
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, "nfl_2026_score_engine_replay_inputs_2026_09_25_r1.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, games: games.length, teamStats: state.teamStats.length, completeThroughWeek: state.completeThroughWeek }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
