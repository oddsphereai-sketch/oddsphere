/**
 * Daily Edge cushion/error and wager-economics audit.
 *
 * Read-only. This script never mutates a prediction, grade, result, or model.
 * It keeps release families separate and uses the same eligibility/dedupe rules
 * as public Tracking before computing discovery metrics.
 */
import { supabase } from "@/lib/db/supabase";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import {
  dedupePredictionRecordsForTracking,
  effectiveTrackingPlayGrade,
  filterCompleteUclTrackingCohorts,
  isCurrentUclTrackingRelease,
  isTrackingRecordEligible,
  trackingDisplaySport,
} from "@/lib/services/trackingAggregateService";
import type { PredictionGradeRow, PredictionRecordRow } from "@/lib/types/domain/Tracking";

type Settled = "win" | "loss" | "push";
type AuditRow = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow;
  sport: string;
  gradeLabel: string;
  result: Settled;
  outcome: 0 | 1 | null;
  units: number | null;
  signedLineResult: number | null;
  projectedAway: number | null;
  projectedHome: number | null;
  independentAway: number | null;
  independentHome: number | null;
};

type Summary = ReturnType<typeof summarize>;

const PAGE = 1000;
const GRADE_CHUNK = 500;
const ACTIONABLE = new Set(["best_angle", "lean"]);
const CUSHIONS: Record<string, [number, number]> = {
  nfl: [3, 6], cfb: [3, 6], nba: [3, 6], wnba: [3, 6], cbb: [3, 6],
  mlb: [1, 2], nhl: [1, 2], epl: [0.5, 1], ucl: [0.5, 1],
};

function parseArgs() {
  const out = { from: "2026-06-07", to: todayEt(), json: false, sport: null as string | null, release: null as string | null, calibration: null as string | null, summaryOnly: false, releasesOnly: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") out.json = true;
    if (arg === "--summary-only") out.summaryOnly = true;
    if (arg === "--releases-only") out.releasesOnly = true;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? todayEt() : value;
    if (key === "sport") out.sport = value.toLowerCase();
    if (key === "release") out.release = value;
    if (key === "calibration") out.calibration = value;
  }
  return out;
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function at(value: unknown, path: string): unknown {
  let cursor = value;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function numberAt(value: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const number = finite(at(value, path));
    if (number !== null) return number;
  }
  return null;
}

function scorePair(snapshot: unknown, independent: boolean): { away: number | null; home: number | null } {
  const prefix = independent ? [
    "independent_forecast", "footballOnlyProjection", "wnba_forward_evidence_capture_v1.independent_model",
  ] : [
    "forecast", "model_output", "projected_score", "predicted_scores_at_lock", "member_projection_at_capture",
  ];
  const awaySuffixes = ["expectedAwayPoints", "projected_away_goals", "away", "predicted_away_score"];
  const homeSuffixes = ["expectedHomePoints", "projected_home_goals", "home", "predicted_home_score"];
  const awayPaths = prefix.flatMap((root) => awaySuffixes.map((suffix) => `${root}.${suffix}`));
  const homePaths = prefix.flatMap((root) => homeSuffixes.map((suffix) => `${root}.${suffix}`));
  if (!independent) {
    awayPaths.push("predicted_away_score", "review_v1.reviewed.away_score", "total_projection_reconciliation.reconciled_away_score");
    homePaths.push("predicted_home_score", "review_v1.reviewed.home_score", "total_projection_reconciliation.reconciled_home_score");
  }
  return { away: numberAt(snapshot, awayPaths), home: numberAt(snapshot, homePaths) };
}

function settled(grade: PredictionGradeRow): Settled | null {
  if (grade.result === "win" || grade.win) return "win";
  if (grade.result === "loss" || grade.loss) return "loss";
  if (grade.result === "push" || grade.push) return "push";
  return null;
}

function americanUnits(price: number | null, result: Settled): number | null {
  if (result === "push") return 0;
  if (result === "loss") return price === null ? null : -1;
  if (price === null || price === 0) return null;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function signedLineResult(record: PredictionRecordRow, grade: PredictionGradeRow): number | null {
  const line = record.line_value;
  const home = grade.actual_home_score;
  const away = grade.actual_away_score;
  if (line === null || home === null || away === null) return null;
  const side = String(record.side ?? "").toLowerCase();
  if (record.market === "spread" && (side === "home" || side === "away")) {
    return (side === "home" ? home - away : away - home) + line;
  }
  if (record.market === "total" && (side === "over" || side === "under")) {
    const actual = grade.actual_total ?? home + away;
    return side === "over" ? actual - line : line - actual;
  }
  return null;
}

function probability(record: PredictionRecordRow): number | null {
  const value = record.model_probability;
  if (value === null || !Number.isFinite(value)) return null;
  const p = value > 1 ? value / 100 : value;
  return p > 0 && p < 1 ? p : null;
}

function normalizedEv(record: PredictionRecordRow): number | null {
  const raw = record.expected_value;
  if (raw === null || !Number.isFinite(raw)) return null;
  return Math.abs(raw) <= 1 ? raw : raw / 100;
}

function priceBand(price: number | null): string {
  if (price === null) return "missing";
  if (price <= -300) return "<=-300";
  if (price <= -200) return "-299_to_-200";
  if (price <= -150) return "-199_to_-150";
  if (price < 100) return "-149_to_-101";
  if (price <= 150) return "+100_to_+150";
  return ">+150";
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function rounded(value: number | null, digits = 4): number | null {
  return value === null ? null : +value.toFixed(digits);
}

function projectionMetrics(rows: AuditRow[], independent = false) {
  const errors = rows.flatMap((row) => {
    const away = independent ? row.independentAway : row.projectedAway;
    const home = independent ? row.independentHome : row.projectedHome;
    if (away === null || home === null || row.grade.actual_away_score === null || row.grade.actual_home_score === null) return [];
    return [{ away: away - row.grade.actual_away_score, home: home - row.grade.actual_home_score }];
  });
  const teamErrors = errors.flatMap((error) => [error.away, error.home]);
  const totalErrors = errors.map((error) => error.away + error.home);
  const marginErrors = errors.map((error) => error.home - error.away);
  return {
    games: errors.length,
    teamMae: rounded(average(teamErrors.map(Math.abs))),
    teamBias: rounded(average(teamErrors)),
    totalMae: rounded(average(totalErrors.map(Math.abs))),
    totalBias: rounded(average(totalErrors)),
    marginMae: rounded(average(marginErrors.map(Math.abs))),
    marginBiasHome: rounded(average(marginErrors)),
  };
}

function calibration(rows: AuditRow[]) {
  const binary = rows.flatMap((row) => {
    const p = probability(row.record);
    return p === null || row.outcome === null ? [] : [{ p, y: row.outcome }];
  });
  if (!binary.length) return { count: 0, brier: null, logLoss: null, ece: null };
  const brier = average(binary.map(({ p, y }) => (p - y) ** 2));
  const logLoss = average(binary.map(({ p, y }) => {
    const bounded = Math.max(1e-9, Math.min(1 - 1e-9, p));
    return -(y * Math.log(bounded) + (1 - y) * Math.log(1 - bounded));
  }));
  const bins = new Map<number, Array<{ p: number; y: number }>>();
  for (const item of binary) {
    const key = Math.min(9, Math.floor(item.p * 10));
    bins.set(key, [...(bins.get(key) ?? []), item]);
  }
  const ece = [...bins.values()].reduce((sum, bin) => {
    const confidence = average(bin.map((item) => item.p)) ?? 0;
    const accuracy = average(bin.map((item) => item.y)) ?? 0;
    return sum + (bin.length / binary.length) * Math.abs(confidence - accuracy);
  }, 0);
  return { count: binary.length, brier: rounded(brier), logLoss: rounded(logLoss), ece: rounded(ece) };
}

function summarize(rows: AuditRow[]) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const pushes = rows.filter((row) => row.result === "push").length;
  const priced = rows.filter((row) => row.units !== null);
  const units = priced.reduce((sum, row) => sum + (row.units ?? 0), 0);
  const actionable = rows.filter((row) => ACTIONABLE.has(row.gradeLabel));
  const executable = actionable.filter((row) => row.record.no_bet !== true);
  const actionablePriced = executable.filter((row) => row.units !== null);
  const actionableUnits = actionablePriced.reduce((sum, row) => sum + (row.units ?? 0), 0);
  const signed = rows.map((row) => row.signedLineResult).filter((value): value is number => value !== null);
  const cushions = CUSHIONS[rows[0]?.sport ?? ""];
  const lossesSigned = signed.filter((value) => value < 0);
  const gradeCounts: Record<string, number> = {};
  const actionablePriceBands: Record<string, { rows: number; wins: number; losses: number; units: number; negativeEv: number }> = {};
  for (const row of rows) gradeCounts[row.gradeLabel] = (gradeCounts[row.gradeLabel] ?? 0) + 1;
  for (const row of executable) {
    const key = priceBand(row.record.odds_american);
    const bucket = actionablePriceBands[key] ?? { rows: 0, wins: 0, losses: 0, units: 0, negativeEv: 0 };
    bucket.rows++;
    if (row.result === "win") bucket.wins++;
    if (row.result === "loss") bucket.losses++;
    if (row.units !== null) bucket.units += row.units;
    if ((normalizedEv(row.record) ?? 0) < 0) bucket.negativeEv++;
    actionablePriceBands[key] = bucket;
  }
  for (const bucket of Object.values(actionablePriceBands)) bucket.units = +bucket.units.toFixed(4);
  return {
    rows: rows.length,
    wins,
    losses,
    pushes,
    winPct: wins + losses ? rounded(wins / (wins + losses)) : null,
    pricedRows: priced.length,
    units: rounded(units),
    roi: priced.length ? rounded(units / priced.length) : null,
    actionable: {
      rows: actionable.length,
      wins: actionable.filter((row) => row.result === "win").length,
      losses: actionable.filter((row) => row.result === "loss").length,
      executableRows: executable.length,
      shopOrNoBetRows: actionable.length - executable.length,
      pricedRows: actionablePriced.length,
      units: rounded(actionableUnits),
      roi: actionablePriced.length ? rounded(actionableUnits / actionablePriced.length) : null,
      negativeEvRows: executable.filter((row) => (normalizedEv(row.record) ?? 0) < 0).length,
      labelNegativeEvRows: actionable.filter((row) => (normalizedEv(row.record) ?? 0) < 0).length,
      priceBands: actionablePriceBands,
    },
    gradeCounts,
    calibration: calibration(rows),
    lineError: signed.length ? {
      rows: signed.length,
      meanSigned: rounded(average(signed)),
      meanAbsolute: rounded(average(signed.map(Math.abs))),
      hardLossRate: cushions ? rounded(lossesSigned.filter((value) => value < -cushions[1]).length / signed.length) : null,
      firstCushionRecoveryOfLosses: cushions && lossesSigned.length
        ? rounded(lossesSigned.filter((value) => value >= -cushions[0]).length / lossesSigned.length)
        : null,
      secondCushionRecoveryOfLosses: cushions && lossesSigned.length
        ? rounded(lossesSigned.filter((value) => value >= -cushions[1]).length / lossesSigned.length)
        : null,
      cushions: cushions ?? null,
    } : null,
    finalProjection: projectionMetrics(rows),
    independentProjection: projectionMetrics(rows, true),
  };
}

async function loadRows(args: ReturnType<typeof parseArgs>): Promise<AuditRow[]> {
  const records: PredictionRecordRow[] = [];
  for (let start = 0; ; start += PAGE) {
    let query = supabase.from("prediction_records").select("*")
      .gte("slate_date", args.from).lte("slate_date", args.to)
      .order("id", { ascending: true }).range(start, start + PAGE - 1);
    if (args.sport && args.sport !== "epl" && args.sport !== "ucl") query = query.eq("sport", args.sport);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    const page = (data ?? []) as PredictionRecordRow[];
    records.push(...page);
    if (page.length < PAGE) break;
  }
  const eligible = filterCompleteUclTrackingCohorts(records.filter((record) =>
    record.launch_day !== true &&
    isPublicallyTracked(record.sport, record.slate_date) &&
    isCurrentUclTrackingRelease(record) &&
    isTrackingRecordEligible(record)
  ));
  const deduped = dedupePredictionRecordsForTracking(eligible).filter((record) =>
    (!args.sport || trackingDisplaySport(record) === args.sport) &&
    (!args.release || record.model_version === args.release) &&
    (!args.calibration || record.calibration_version === args.calibration)
  );
  const ids = deduped.map((record) => record.id).filter((id): id is number => id !== undefined);
  const grades: PredictionGradeRow[] = [];
  for (let index = 0; index < ids.length; index += GRADE_CHUNK) {
    const { data, error } = await supabase.from("prediction_grades").select("*")
      .in("prediction_record_id", ids.slice(index, index + GRADE_CHUNK));
    if (error) throw new Error(`prediction_grades load failed: ${error.message}`);
    grades.push(...((data ?? []) as PredictionGradeRow[]));
  }
  const gradeById = new Map(grades.map((grade) => [grade.prediction_record_id, grade]));
  return deduped.flatMap((record): AuditRow[] => {
    const grade = record.id === undefined ? null : gradeById.get(record.id) ?? null;
    const result = grade ? settled(grade) : null;
    if (!grade || !result) return [];
    const finalScore = scorePair(record.snapshot_json, false);
    const independentScore = scorePair(record.snapshot_json, true);
    return [{
      record,
      grade,
      sport: trackingDisplaySport(record),
      gradeLabel: effectiveTrackingPlayGrade(record),
      result,
      outcome: result === "push" ? null : result === "win" ? 1 : 0,
      units: americanUnits(record.odds_american, result),
      signedLineResult: signedLineResult(record, grade),
      projectedAway: finalScore.away,
      projectedHome: finalScore.home,
      independentAway: independentScore.away,
      independentHome: independentScore.home,
    }];
  });
}

function grouped(rows: AuditRow[], key: (row: AuditRow) => string): Record<string, Summary> {
  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, summarize(values)]));
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  if (args.releasesOnly) {
    const releases = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.sport}::${row.record.model_version ?? "null"}::${row.record.calibration_version ?? "null"}`;
      releases.set(key, (releases.get(key) ?? 0) + 1);
    }
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      range: { from: args.from, to: args.to },
      releases: Object.fromEntries([...releases.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }, null, 2));
    return;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    releaseSeparated: true,
    range: { from: args.from, to: args.to },
    rows: rows.length,
    methodology: {
      officialEligibility: true,
      publicTrackingDedupe: true,
      uclCompleteCohortsOnly: true,
      note: "Cushion recovery is diagnostic only; it is not treated as proof of betting value without exact-line accuracy, calibration, price ROI, projection error, and board impact.",
    },
    bySportMarket: grouped(rows, (row) => `${row.sport}::${row.record.market}`),
    ...(!args.summaryOnly ? {
      byReleaseMarket: grouped(rows, (row) => `${row.sport}::${row.record.market}::${row.record.model_version ?? "null"}::${row.record.calibration_version ?? "null"}`),
    } : {}),
  };
  console.log(JSON.stringify(report, null, args.json ? 2 : 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
