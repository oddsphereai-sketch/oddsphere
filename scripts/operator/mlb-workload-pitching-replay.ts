/**
 * Read-only replay for the MLB workload-weighted pitching candidate.
 *
 * Compares current V2.2 independent projection vs the replay-only workload
 * pitching mode against completed game scores. No writes. No model promotion.
 *
 * Usage:
 *   npm run audit:mlb-workload-replay -- --start-date 2026-06-17 --end-date 2026-06-23
 *   npm run audit:mlb-workload-replay -- --date 2026-06-23
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import {
  __TEST__ as INDEP_TEST,
  projectIndependent,
} from "../../lib/automodel/mlbIndependentProjection";
import type { GameSnapshot } from "../../lib/automodel/types";
import { readNumberFlag, readStringFlag, todayUTC } from "./_cliCommon";

type GameScoreRow = {
  external_id: number;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
};

type ReplayRow = {
  date: string;
  matchup: string;
  externalId: number;
  actualTotal: number;
  actualDiff: number;
  currentTotal: number;
  workloadTotal: number;
  currentDiff: number;
  workloadDiff: number;
  currentTotalAbsErr: number;
  workloadTotalAbsErr: number;
  currentDiffAbsErr: number;
  workloadDiffAbsErr: number;
  currentWinnerCorrect: boolean;
  workloadWinnerCorrect: boolean;
  currentOuCorrect: boolean | null;
  workloadOuCorrect: boolean | null;
  workloadRoles: string;
};

function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid date "${s}". Expected YYYY-MM-DD.`);
  }
  return new Date(`${s}T00:00:00Z`);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function pct(n: number, d: number): string {
  if (d === 0) return "-";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function winnerSide(homeRuns: number, awayRuns: number): "home" | "away" {
  return homeRuns >= awayRuns ? "home" : "away";
}

function ouCorrect(predictedTotal: number, actualTotal: number, line: number | null): boolean | null {
  if (line === null || actualTotal === line) return null;
  const pick = predictedTotal > line ? "over" : "under";
  const actual = actualTotal > line ? "over" : "under";
  return pick === actual;
}

function roleSummary(snap: GameSnapshot): string {
  const away = INDEP_TEST.estimateStarterWorkload(snap.away_starter);
  const home = INDEP_TEST.estimateStarterWorkload(snap.home_starter);
  return `${snap.away_team.abbreviation}:${away.role}(${away.starter_innings}/${away.bullpen_innings}) ` +
    `${snap.home_team.abbreviation}:${home.role}(${home.starter_innings}/${home.bullpen_innings})`;
}

async function loadScores(date: string, externalIds: number[]): Promise<Map<number, GameScoreRow>> {
  if (externalIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("games")
    .select("external_id, home_score, away_score, status")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .in("external_id", externalIds);
  if (error) throw new Error(`games score query failed for ${date}: ${error.message}`);
  return new Map(((data ?? []) as GameScoreRow[]).map((g) => [g.external_id, g]));
}

async function replayDate(date: string): Promise<ReplayRow[]> {
  const snapshots = await buildFeatureSnapshots("mlb", date);
  const scores = await loadScores(date, snapshots.map((s) => s.game_external_id));
  const rows: ReplayRow[] = [];

  for (const snap of snapshots) {
    const score = scores.get(snap.game_external_id);
    if (
      score === undefined ||
      typeof score.home_score !== "number" ||
      typeof score.away_score !== "number"
    ) {
      continue;
    }

    const current = projectIndependent(snap);
    const workload = projectIndependent(snap, { useWorkloadPitching: true });
    const actualTotal = score.home_score + score.away_score;
    const actualDiff = score.home_score - score.away_score;
    const matchup = `${snap.away_team.abbreviation}@${snap.home_team.abbreviation}`;
    const actualWinner = score.home_score >= score.away_score ? "home" : "away";

    rows.push({
      date,
      matchup,
      externalId: snap.game_external_id,
      actualTotal,
      actualDiff,
      currentTotal: current.total_expected_runs,
      workloadTotal: workload.total_expected_runs,
      currentDiff: current.home_run_diff,
      workloadDiff: workload.home_run_diff,
      currentTotalAbsErr: Math.abs(current.total_expected_runs - actualTotal),
      workloadTotalAbsErr: Math.abs(workload.total_expected_runs - actualTotal),
      currentDiffAbsErr: Math.abs(current.home_run_diff - actualDiff),
      workloadDiffAbsErr: Math.abs(workload.home_run_diff - actualDiff),
      currentWinnerCorrect: winnerSide(current.home_expected_runs, current.away_expected_runs) === actualWinner,
      workloadWinnerCorrect: winnerSide(workload.home_expected_runs, workload.away_expected_runs) === actualWinner,
      currentOuCorrect: ouCorrect(current.total_expected_runs, actualTotal, snap.market.listed_total),
      workloadOuCorrect: ouCorrect(workload.total_expected_runs, actualTotal, snap.market.listed_total),
      workloadRoles: roleSummary(snap),
    });
  }

  return rows;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("READ-ONLY. --write is not supported.");
    process.exit(1);
  }

  const singleDate = readStringFlag(argv, "--date");
  const today = todayUTC();
  const defaultEnd = addDays(today, -1);
  const days = readNumberFlag(argv, "--days") ?? 7;
  const startDate = singleDate ?? readStringFlag(argv, "--start-date") ?? addDays(defaultEnd, -(days - 1));
  const endDate = singleDate ?? readStringFlag(argv, "--end-date") ?? defaultEnd;
  parseDate(startDate);
  parseDate(endDate);
  if (startDate > endDate) throw new Error("--start-date must be <= --end-date");

  console.log(`[mlb-workload-pitching-replay] ${startDate}..${endDate} mode=READ-ONLY`);
  console.log("Comparing current independent projection vs workload-weighted candidate.\n");

  const rows: ReplayRow[] = [];
  for (const date of dateRange(startDate, endDate)) {
    const dayRows = await replayDate(date);
    console.log(`${date}: completed-score rows=${dayRows.length}`);
    rows.push(...dayRows);
  }

  if (rows.length === 0) {
    console.log("\nNo completed MLB games with scores found for this range.");
    console.log("✓ Read-only. No writes.");
    return;
  }

  const currentTotalMae = mean(rows.map((r) => r.currentTotalAbsErr));
  const workloadTotalMae = mean(rows.map((r) => r.workloadTotalAbsErr));
  const currentDiffMae = mean(rows.map((r) => r.currentDiffAbsErr));
  const workloadDiffMae = mean(rows.map((r) => r.workloadDiffAbsErr));
  const currentWinnerWins = rows.filter((r) => r.currentWinnerCorrect).length;
  const workloadWinnerWins = rows.filter((r) => r.workloadWinnerCorrect).length;
  const ouRows = rows.filter((r) => r.currentOuCorrect !== null && r.workloadOuCorrect !== null);
  const currentOuWins = ouRows.filter((r) => r.currentOuCorrect === true).length;
  const workloadOuWins = ouRows.filter((r) => r.workloadOuCorrect === true).length;

  console.log("\nSummary");
  console.log(`games evaluated: ${rows.length}`);
  console.log(`total MAE: current=${fmt(currentTotalMae)} workload=${fmt(workloadTotalMae)} delta=${fmt((workloadTotalMae ?? 0) - (currentTotalMae ?? 0))}`);
  console.log(`margin MAE: current=${fmt(currentDiffMae)} workload=${fmt(workloadDiffMae)} delta=${fmt((workloadDiffMae ?? 0) - (currentDiffMae ?? 0))}`);
  console.log(`winner direction: current=${currentWinnerWins}/${rows.length} (${pct(currentWinnerWins, rows.length)}) workload=${workloadWinnerWins}/${rows.length} (${pct(workloadWinnerWins, rows.length)})`);
  console.log(`O/U direction vs listed_total: current=${currentOuWins}/${ouRows.length} (${pct(currentOuWins, ouRows.length)}) workload=${workloadOuWins}/${ouRows.length} (${pct(workloadOuWins, ouRows.length)})`);

  const bySwing = [...rows]
    .map((r) => ({
      ...r,
      totalImprovement: r.currentTotalAbsErr - r.workloadTotalAbsErr,
      diffImprovement: r.currentDiffAbsErr - r.workloadDiffAbsErr,
      totalMove: r.workloadTotal - r.currentTotal,
      diffMove: r.workloadDiff - r.currentDiff,
    }))
    .sort((a, b) => Math.abs(b.totalImprovement) - Math.abs(a.totalImprovement))
    .slice(0, 12);

  console.log("\nLargest total-error swings");
  for (const r of bySwing) {
    console.log(
      `${r.date} ${r.matchup.padEnd(8)} actualT=${fmt(r.actualTotal, 0)} ` +
        `current=${fmt(r.currentTotal)} workload=${fmt(r.workloadTotal)} ` +
        `improve=${fmt(r.totalImprovement)} move=${fmt(r.totalMove)} roles=${r.workloadRoles}`
    );
  }

  console.log("\nPromotion read:");
  if ((workloadTotalMae ?? Infinity) < (currentTotalMae ?? -Infinity) && workloadWinnerWins >= currentWinnerWins) {
    console.log("Candidate improved total MAE without hurting winner direction in this sample. Next: gated live flag + broader replay.");
  } else {
    console.log("Candidate is not clearly better on this sample. Keep as replay-only and tune before promotion.");
  }
  console.log("✓ Read-only. No writes.");
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(2);
});
