/* eslint-disable @typescript-eslint/no-explicit-any -- immutable snapshots have release-specific JSON shapes */
import { createClient } from "@supabase/supabase-js";
import {
  resolveFullGameConfidenceDecision,
  type FullGameConfidenceMarket,
} from "../../lib/services/dailyEdge/fullGameConfidenceSemantics";
import type { Sport } from "../../lib/types/domain/Sport";
import { decisionRelease } from "./audit-daily-edge-loss-market-evidence";

const SPORTS = ["mlb", "wnba", "soccer", "ucl", "nfl", "cfb", "nba", "nhl"] as const;
const MARKETS = new Set<FullGameConfidenceMarket>([
  "moneyline", "spread", "total", "match_result", "btts", "double_chance",
]);
const PAGE_SIZE = 750;
const MAX_ROWS = 50_000;

type Row = {
  id: number;
  sport: Sport;
  slate_date: string;
  locked_at: string;
  market: string;
  play_grade: string | null;
  odds_american: number | null;
  model_probability: number | null;
  snapshot_json: Record<string, any> | null;
  prediction_grades: { result?: string | null } | Array<{ result?: string | null }> | null;
};

type Evaluated = {
  sport: Sport;
  market: FullGameConfidenceMarket;
  release: string;
  lockedAt: string;
  incumbentGrade: string;
  candidateGrade: string;
  recommendation: string;
  result: "win" | "loss" | "push" | "void" | "pending";
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("prediction_records")
      .select("id,sport,slate_date,locked_at,market,play_grade,odds_american,model_probability,snapshot_json,prediction_grades(result)")
      .in("sport", [...SPORTS])
      .not("locked_at", "is", null)
      .order("locked_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (offset + PAGE_SIZE >= MAX_ROWS) throw new Error(`Audit exceeded ${MAX_ROWS}-row safety cap.`);
  }

  const skipped = { unsupportedMarket: 0, missingProbability: 0 };
  const evaluated: Evaluated[] = [];
  for (const row of rows) {
    if (!MARKETS.has(row.market as FullGameConfidenceMarket)) {
      skipped.unsupportedMarket += 1;
      continue;
    }
    if (!finite(row.model_probability) || row.model_probability < 0 || row.model_probability > 1) {
      skipped.missingProbability += 1;
      continue;
    }
    const ev = expectedValue(row.model_probability, row.odds_american);
    const decision = resolveFullGameConfidenceDecision({
      sport: row.sport,
      market: row.market as FullGameConfidenceMarket,
      modelProbability: row.model_probability,
      evidenceAdjustmentPoints: 0,
      americanPrice: row.odds_american,
      expectedValue: ev,
      quoteFresh: row.odds_american !== null,
      quoteCoherent: row.odds_american !== null,
    });
    evaluated.push({
      sport: row.sport,
      market: row.market as FullGameConfidenceMarket,
      release: decisionRelease(row.snapshot_json),
      lockedAt: row.locked_at,
      incumbentGrade: normalizeGrade(row.play_grade),
      candidateGrade: decision.confidenceGrade,
      recommendation: decision.recommendationStatus,
      result: result(row.prediction_grades),
    });
  }

  const groups = new Map<string, Evaluated[]>();
  for (const row of evaluated) {
    const key = `${row.sport}|${row.market}|${row.release}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const cohorts = [...groups.entries()].map(([key, cohort]) => {
    const settled = cohort.filter((row) => row.result === "win" || row.result === "loss");
    const split = Math.floor(settled.length * 0.6);
    const calibration = settled.slice(0, split);
    const holdout = settled.slice(split);
    return {
      key,
      rows: cohort.length,
      settled: settled.length,
      calibration: summarize(calibration),
      holdout: summarize(holdout),
      currentBoard: summarize(cohort.filter((row) => row.result === "pending")),
      transition: transition(cohort),
      sufficientIndependentHoldout: holdout.length >= 30,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    contract: "daily_edge_confidence_execution_r2_outcome_blind_frozen_bands",
    chronologicalSplit: "first_60_percent_calibration_last_40_percent_holdout",
    recordsLoaded: rows.length,
    evaluated: evaluated.length,
    skipped,
    activationRule: "No live activation from this release-pure audit unless the independent chronological holdout has at least 30 settled binary outcomes and no hidden board collapse.",
    cohorts,
  }, null, 2));
}

function summarize(rows: Evaluated[]) {
  const actionableRows = rows.filter((row) => actionable(row.candidateGrade));
  const bets = actionableRows.filter((row) => row.recommendation === "bet");
  const shops = actionableRows.filter((row) => row.recommendation === "shop");
  return {
    rows: rows.length,
    grades: counts(rows, (row) => row.candidateGrade),
    confidenceActionable: outcome(actionableRows),
    displayedQuoteBets: outcome(bets),
    shops: outcome(shops),
  };
}

function transition(rows: Evaluated[]) {
  const changed = rows.filter((row) => row.incumbentGrade !== row.candidateGrade);
  return {
    incumbent: counts(rows, (row) => row.incumbentGrade),
    candidate: counts(rows, (row) => row.candidateGrade),
    promotions: changed.filter((row) => rank(row.candidateGrade) > rank(row.incumbentGrade)).length,
    demotions: changed.filter((row) => rank(row.candidateGrade) < rank(row.incumbentGrade)).length,
  };
}

function outcome(rows: Evaluated[]) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  return { rows: rows.length, wins, losses, winPct: wins + losses > 0 ? 100 * wins / (wins + losses) : null };
}

function counts<T>(rows: T[], key: (row: T) => string) {
  const values: Record<string, number> = {};
  for (const row of rows) values[key(row)] = (values[key(row)] ?? 0) + 1;
  return values;
}

function expectedValue(probability: number, americanPrice: number | null): number | null {
  if (!finite(americanPrice) || americanPrice === 0) return null;
  const profit = americanPrice > 0 ? americanPrice / 100 : 100 / -americanPrice;
  return probability * profit - (1 - probability);
}

function result(value: Row["prediction_grades"]): Evaluated["result"] {
  const row = Array.isArray(value) ? value[0] : value;
  const candidate = String(row?.result ?? "pending").toLowerCase();
  return candidate === "win" || candidate === "loss" || candidate === "push" || candidate === "void" ? candidate : "pending";
}

function normalizeGrade(value: string | null): string {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "bestangle") return "Best Angle";
  if (normalized === "lean") return "Lean";
  if (normalized === "watch" || normalized === "watchlist" || normalized === "marketaligned") return "Watchlist";
  return "No Play";
}

function actionable(grade: string): boolean { return grade === "Best Angle" || grade === "Lean"; }
function rank(grade: string): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
