#!/usr/bin/env tsx

/** SELECT-only replay of the CFB Moneyline market-confirmation grade repair. */

import { createClient } from "@supabase/supabase-js";
import {
  applyCfbBalancedPositiveValueRule,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { CFB_V1_DECISION_RELEASE, type CfbV1Grade } from "../../lib/services/football/cfbV1Decision";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Outcome = "win" | "loss";
type AuditRow = {
  date: string;
  release: string;
  currentGrade: CfbV1Grade;
  candidateGrade: CfbV1Grade;
  result: Outcome;
  price: number;
  modelProbability: number;
};

const from = process.argv.find((value) => value.startsWith("--from="))?.slice(7) ?? "2026-09-01";
const through = process.argv.find((value) => value.startsWith("--through="))?.slice(10) ?? "2026-10-03";

function normalizedGrade(value: unknown): CfbV1Grade | null {
  const normalized = String(value ?? "").toLowerCase().replaceAll("_", " ");
  if (normalized === "best angle") return "Best Angle";
  if (normalized === "lean") return "Lean";
  if (normalized === "watchlist") return "Watchlist";
  if (normalized === "no play") return "No Play";
  return null;
}

function resultFor(row: Json): Outcome | null {
  const nested = Array.isArray(row.prediction_grades) ? row.prediction_grades[0] : row.prediction_grades;
  return nested?.result === "win" || nested?.result === "loss" ? nested.result : null;
}

function actionable(grade: CfbV1Grade): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function summarize(rows: AuditRow[]): Record<string, number | null> {
  const wins = rows.filter((row) => row.result === "win").length;
  const units = rows.reduce((sum, row) => sum + (row.result === "loss"
    ? -1
    : row.price > 0 ? row.price / 100 : 100 / Math.abs(row.price)), 0);
  const brier = rows.length === 0 ? null : rows.reduce((sum, row) =>
    sum + (row.modelProbability - (row.result === "win" ? 1 : 0)) ** 2, 0) / rows.length;
  const logLoss = rows.length === 0 ? null : rows.reduce((sum, row) => {
    const probability = Math.max(1e-6, Math.min(1 - 1e-6, row.modelProbability));
    return sum - (row.result === "win" ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / rows.length;
  return {
    rows: rows.length,
    wins,
    losses: rows.length - wins,
    hitRatePct: rows.length === 0 ? null : Number((100 * wins / rows.length).toFixed(2)),
    units: Number(units.toFixed(3)),
    roiPct: rows.length === 0 ? null : Number((100 * units / rows.length).toFixed(2)),
    brier: brier === null ? null : Number(brier.toFixed(4)),
    logLoss: logLoss === null ? null : Number(logLoss.toFixed(4)),
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.from("prediction_records")
    .select("slate_date,play_grade,snapshot_json,prediction_grades(result)")
    .eq("sport", "cfb")
    .eq("market", "moneyline")
    .gte("slate_date", from)
    .lte("slate_date", through)
    .order("slate_date");
  if (error) throw new Error(error.message);

  const rows = (data ?? []).flatMap((stored: Json): AuditRow[] => {
    const decision = stored.snapshot_json?.decision_tuple;
    const currentGrade = normalizedGrade(stored.play_grade);
    const result = resultFor(stored);
    if (!decision || !currentGrade || !result || decision.market !== "moneyline") return [];
    const adjustment = decision.gradeAdjustment ?? {};
    const candidate = applyCfbBalancedPositiveValueRule({
      market: "moneyline",
      finalGrade: currentGrade,
      probabilityGrade: decision.probabilityGrade,
      executionStatus: adjustment.executionStatus ?? "shop",
      expectedValue: decision.expectedValue,
      modelProbability: decision.modelProbability,
      marketFairProbability: decision.marketFairProbability,
      evaluatedPrice: decision.evaluatedQuote.price,
      evaluatedLine: null,
      sharpDirection: adjustment.sharpDirection ?? "unknown",
      publicDirection: adjustment.publicDirection ?? "unknown",
      movementDirection: adjustment.movementDirection ?? "unknown",
      reasonCodes: adjustment.reasonCodes ?? [],
      calibrationFamily: decision.calibrationFamily,
    });
    return [{
      date: stored.slate_date,
      release: decision.decisionRelease,
      currentGrade,
      candidateGrade: candidate.finalGrade,
      result,
      price: decision.evaluatedQuote.price,
      modelProbability: decision.modelProbability,
    }];
  });
  const releases = [...new Set(rows.map((row) => row.release))].sort();
  const current = rows.filter((row) => actionable(row.currentGrade));
  const candidate = rows.filter((row) => actionable(row.candidateGrade));
  const promotions = rows.filter((row) => !actionable(row.currentGrade) && actionable(row.candidateGrade));
  const demotions = rows.filter((row) => actionable(row.currentGrade) && !actionable(row.candidateGrade));
  console.log(JSON.stringify({
    auditRelease: "cfb_moneyline_market_confirmation_audit_2026_10_04_r1",
    readOnly: true,
    writes: 0,
    from,
    through,
    candidateDecisionRelease: CFB_V1_DECISION_RELEASE,
    candidateMarketGradeRelease: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
    current: summarize(current),
    candidate: summarize(candidate),
    promotions: summarize(promotions),
    demotions: summarize(demotions),
    boardImpact: { current: current.length, candidate: candidate.length, net: candidate.length - current.length },
    byDecisionRelease: Object.fromEntries(releases.map((release) => {
      const cohort = rows.filter((row) => row.release === release);
      return [release, {
        allSettled: summarize(cohort),
        current: summarize(cohort.filter((row) => actionable(row.currentGrade))),
        candidate: summarize(cohort.filter((row) => actionable(row.candidateGrade))),
        promotions: summarize(cohort.filter((row) => !actionable(row.currentGrade) && actionable(row.candidateGrade))),
        demotions: summarize(cohort.filter((row) => actionable(row.currentGrade) && !actionable(row.candidateGrade))),
      }];
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
