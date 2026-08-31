import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import type { NflPlayerPropsProductionSnapshot } from "../../lib/services/football/nflPlayerPropsProductionContract";
import { nflPlayerPropsSnapshotKey } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

const season = Number(process.argv.find((value) => value.startsWith("--season="))?.slice(9) ?? 2026);
const week = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? 1);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");
const supabaseUrl = url;
const supabaseKey = key;

async function main(): Promise<void> {
const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const { data, error } = await client
  .from("lab_response_snapshots")
  .select("payload,generated_at")
  .eq("snapshot_key", nflPlayerPropsSnapshotKey(season, week))
  .maybeSingle();
if (error) throw new Error(`NFL props snapshot read failed: ${error.message}`);
if (!data?.payload) throw new Error(`NFL props snapshot is unavailable for ${season} Week ${week}.`);

const snapshot = data.payload as NflPlayerPropsProductionSnapshot;
const rows = snapshot.board.decisions.map((row) => ({
  market: row.market,
  grade: row.grade,
  candidateGrade: row.grade === "Held"
    ? "Held"
    : Math.abs(row.rawModelProbability - row.marketProbability) > 0.48
    ? "No Play"
    : (row.market === "receiving_yards" || row.market === "receptions") && row.side === "under" && row.grade === "Watchlist"
      && row.expectedValue >= 0.04 && row.probabilityEdge >= 0.02 && row.participationProbability >= 0.70
      && row.bookEvidence.length >= 2
      ? "Lean"
      : row.grade,
  state: row.state,
  divergencePp: 100 * Math.abs(row.rawModelProbability - row.marketProbability),
  openingAvailable: row.bookEvidence.some((book) => book.openingAmericanPrice !== null && book.openingObservedAt !== null),
}));
const divergences = rows.map((row) => row.divergencePp).sort((a, b) => a - b);
const counts = (values: typeof rows) => Object.fromEntries(
  ["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) => [grade, values.filter((row) => row.grade === grade).length]),
);
const byMarket = Object.fromEntries([...new Set(rows.map((row) => row.market))].sort().map((market) => [
  market,
  {
    rows: rows.filter((row) => row.market === market).length,
    grades: counts(rows.filter((row) => row.market === market)),
    maximumDivergencePp: round(Math.max(...rows.filter((row) => row.market === market).map((row) => row.divergencePp))),
  },
]));

const { data: tracking, error: trackingError } = await client
  .from("nfl_player_prop_records")
  .select("result,closing_price,play_grade");
if (trackingError) throw new Error(`NFL props tracking read failed: ${trackingError.message}`);

const report = {
  readOnly: true,
  season,
  week,
  generatedAt: data.generated_at,
  release: snapshot.release,
  rows: rows.length,
  grades: counts(rows),
  candidateGrades: Object.fromEntries(
    ["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) => [grade, rows.filter((row) => row.candidateGrade === grade).length]),
  ),
  candidateImpact: {
    promotions: rows.filter((row) => row.grade !== row.candidateGrade && row.candidateGrade === "Lean").length,
    divergenceDemotions: rows.filter((row) => row.grade !== row.candidateGrade && row.candidateGrade === "No Play").length,
    unchanged: rows.filter((row) => row.grade === row.candidateGrade).length,
  },
  byMarket,
  divergencePp: {
    p50: quantile(divergences, 0.5),
    p90: quantile(divergences, 0.9),
    p95: quantile(divergences, 0.95),
    p99: quantile(divergences, 0.99),
    maximum: round(divergences.at(-1) ?? 0),
    over8: rows.filter((row) => row.divergencePp > 8).length,
    actionableOver8: rows.filter((row) => (row.grade === "Best Angle" || row.grade === "Lean") && row.divergencePp > 8).length,
  },
  actionable: snapshot.board.decisions
    .filter((row) => row.grade === "Best Angle" || row.grade === "Lean")
    .map((row) => ({
      player: row.playerName,
      market: row.market,
      side: row.side,
      grade: row.grade,
      rawModelProbability: round(100 * row.rawModelProbability),
      marketProbability: round(100 * row.marketProbability),
      divergencePp: round(100 * Math.abs(row.rawModelProbability - row.marketProbability)),
      finalProbability: round(100 * row.finalProbability),
      edgePp: round(100 * row.probabilityEdge),
      expectedValuePct: round(100 * row.expectedValue),
    })),
  openingCoverage: {
    rows: rows.filter((row) => row.openingAvailable).length,
    total: rows.length,
  },
  tracking: {
    records: tracking?.length ?? 0,
    settledMissingClosingPrice: (tracking ?? []).filter((row) => row.result !== "pending" && row.closing_price === null).length,
    pendingMissingClosingPrice: (tracking ?? []).filter((row) => row.result === "pending" && row.closing_price === null).length,
  },
};
console.log(JSON.stringify(process.argv.includes("--summary") ? {
  readOnly: report.readOnly,
  generatedAt: report.generatedAt,
  rows: report.rows,
  grades: report.grades,
  candidateGrades: report.candidateGrades,
  candidateImpact: report.candidateImpact,
  divergencePp: report.divergencePp,
  openingCoverage: report.openingCoverage,
  tracking: report.tracking,
} : report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  return round(values[Math.min(values.length - 1, Math.floor(probability * values.length))]!);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
