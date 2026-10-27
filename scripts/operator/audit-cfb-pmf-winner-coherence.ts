#!/usr/bin/env tsx

/** SELECT-only audit of stored CFB PMF winner/expected-margin disagreements. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

type Json = Record<string, unknown>;
type Grade = { result: string | null; actual_away_score: number | null; actual_home_score: number | null };
type Row = {
  id: number;
  external_id: number;
  slate_date: string;
  side: string | null;
  play_grade: string | null;
  model_version: string | null;
  snapshot_json: Json | null;
  prediction_grades: Grade | Grade[] | null;
};

const PAGE = 500;

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function grade(value: Row["prediction_grades"]): Grade | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function result(correct: boolean): "win" | "loss" {
  return correct ? "win" : "loss";
}

function block(date: string): "development" | "confirmation" | "later_opened" {
  if (date <= "2026-09-27") return "development";
  if (date <= "2026-10-04") return "confirmation";
  return "later_opened";
}

function counts(rows: Array<{ baselineResult: "win" | "loss"; candidateResult: "win" | "loss" }>) {
  return {
    games: rows.length,
    baseline: {
      wins: rows.filter((row) => row.baselineResult === "win").length,
      losses: rows.filter((row) => row.baselineResult === "loss").length,
    },
    candidate: {
      wins: rows.filter((row) => row.candidateResult === "win").length,
      losses: rows.filter((row) => row.candidateResult === "loss").length,
    },
    corrections: rows.filter((row) => row.baselineResult === "loss" && row.candidateResult === "win").length,
    harms: rows.filter((row) => row.baselineResult === "win" && row.candidateResult === "loss").length,
  };
}

async function readRows() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows: Row[] = [];
  for (let from = 0; from < 10_000; from += PAGE) {
    const { data, error } = await client.from("prediction_records")
      .select("id,external_id,slate_date,side,play_grade,model_version,snapshot_json,prediction_grades(result,actual_away_score,actual_home_score)")
      .eq("sport", "cfb")
      .eq("market", "moneyline")
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`CFB prediction read failed: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
  throw new Error("CFB PMF coherence audit exceeded 10,000 Moneyline rows.");
}

async function main(): Promise<void> {
  const raw = await readRows();
  const superseded = new Set(raw.flatMap((row) => {
    const value = finite(record(row.snapshot_json).supersedes_prediction_record_id);
    return value === null ? [] : [value];
  }));
  const rows = raw.filter((row) => !superseded.has(row.id));
  const evaluated = rows.flatMap((row) => {
    const snapshot = record(row.snapshot_json);
    const forecast = record(snapshot.forecast);
    const release = text(forecast.release);
    const expectedMarginHome = finite(forecast.expectedMarginHome);
    const homeWinProbability = finite(forecast.homeWinProbability);
    const awayTeam = text(forecast.awayTeam);
    const homeTeam = text(forecast.homeTeam);
    const settled = grade(row.prediction_grades);
    const awayScore = finite(settled?.actual_away_score);
    const homeScore = finite(settled?.actual_home_score);
    if (!release?.includes("full_product_coordinator_compatibility") || expectedMarginHome === null ||
        homeWinProbability === null || awayTeam === null || homeTeam === null || awayScore === null ||
        homeScore === null || awayScore === homeScore) return [];
    const baselineHome = homeWinProbability >= 0.5;
    const candidateHome = expectedMarginHome >= 0;
    const actualHome = homeScore > awayScore;
    const mismatch = baselineHome !== candidateHome;
    return [{
      id: row.id,
      gameId: String(row.external_id),
      date: row.slate_date,
      block: block(row.slate_date),
      matchup: `${awayTeam}@${homeTeam}`,
      release,
      grade: row.play_grade ?? "unknown",
      expectedMarginHome,
      homeWinProbability,
      baselineSide: baselineHome ? homeTeam : awayTeam,
      candidateSide: candidateHome ? homeTeam : awayTeam,
      actualSide: actualHome ? homeTeam : awayTeam,
      mismatch,
      baselineResult: result(baselineHome === actualHome),
      candidateResult: result(candidateHome === actualHome),
    }];
  });
  const mismatches = evaluated.filter((row) => row.mismatch);
  console.log(JSON.stringify({
    release: "cfb_pmf_winner_coherence_stored_lock_audit_2026_10_27_r1",
    mode: "read_only_zero_writes",
    rawRows: raw.length,
    currentRows: rows.length,
    compatibilityRows: evaluated.length,
    overall: counts(evaluated),
    mismatches: counts(mismatches),
    byBlock: Object.fromEntries(["development", "confirmation", "later_opened"].map((name) => [
      name,
      counts(mismatches.filter((row) => row.block === name)),
    ])),
    cases: mismatches,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
