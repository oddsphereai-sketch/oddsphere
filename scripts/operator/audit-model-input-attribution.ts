/**
 * Read-only model input attribution audit.
 *
 * Answers the operator question: "Which model inputs / context flags are
 * actually helping win rate, ROI, and CLV?" It does not rerun the model and
 * does not change thresholds. It groups already-tracked picks by the inputs
 * persisted on prediction_records + snapshot_json.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-model-input-attribution.ts \
 *     --sport mlb --date-from 2026-06-01 --date-to 2026-06-24 [--markets moneyline,total] [--min-sample 10]
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";
import { profitMultiplier } from "../../lib/utils/odds";

type Opts = {
  sport: Sport;
  dateFrom: string;
  dateTo: string;
  markets: Set<string> | null;
  minSample: number;
  verbose: boolean;
};

type PredictionRecord = {
  id: number;
  sport: Sport;
  slate_date: string;
  market: string | null;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  model_used: string | null;
  model_version: string | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  data_quality_tier: string | null;
  snapshot_json: unknown;
  held: boolean | null;
};

type GradeRow = {
  prediction_record_id: number;
  result: string | null;
  win: boolean | null;
  loss: boolean | null;
  push: boolean | null;
  void: boolean | null;
  pending: boolean | null;
};

type Row = PredictionRecord & {
  result: string | null;
};

type Bucket = {
  key: string;
  label: string;
  total: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  units: number;
  roiEligible: number;
  clvCount: number;
  clvSum: number;
  beatClose: number;
  modelProbSum: number;
  modelProbCount: number;
  edgeSum: number;
  edgeCount: number;
};

function parseArgs(argv: string[]): Opts {
  let sport: Sport = "mlb";
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let markets: Set<string> | null = null;
  let minSample = 10;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply" || a === "--write") {
      console.error("READ-ONLY. --apply/--write are not supported.");
      process.exit(2);
    }
    if (a === "--sport" && argv[i + 1]) {
      sport = argv[++i] as Sport;
      continue;
    }
    if (a === "--date-from" && argv[i + 1]) {
      dateFrom = argv[++i]!;
      continue;
    }
    if (a === "--date-to" && argv[i + 1]) {
      dateTo = argv[++i]!;
      continue;
    }
    if (a === "--markets" && argv[i + 1]) {
      markets = new Set(argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (a === "--min-sample" && argv[i + 1]) {
      minSample = Number(argv[++i]!);
      continue;
    }
    if (a === "--verbose") {
      verbose = true;
      continue;
    }
  }

  if (!dateFrom || !dateTo) {
    console.error(
      "Usage: audit-model-input-attribution.ts --sport mlb --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--markets moneyline,total] [--min-sample N]",
    );
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error("date-from/date-to must be YYYY-MM-DD");
  }
  if (!Number.isFinite(minSample) || minSample < 1) minSample = 10;

  return { sport, dateFrom, dateTo, markets, minSample, verbose };
}

function snapshotObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nested(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function boolish(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (["true", "yes", "1"].includes(v.toLowerCase())) return true;
    if (["false", "no", "0"].includes(v.toLowerCase())) return false;
  }
  return null;
}

function numberish(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringish(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function gradeResult(g: GradeRow | undefined): string | null {
  if (!g) return null;
  if (typeof g.result === "string") return g.result.toLowerCase();
  if (g.win) return "win";
  if (g.loss) return "loss";
  if (g.push) return "push";
  if (g.void) return "void";
  if (g.pending) return "pending";
  return null;
}

function newBucket(key: string, label = key): Bucket {
  return {
    key,
    label,
    total: 0,
    graded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    pending: 0,
    units: 0,
    roiEligible: 0,
    clvCount: 0,
    clvSum: 0,
    beatClose: 0,
    modelProbSum: 0,
    modelProbCount: 0,
    edgeSum: 0,
    edgeCount: 0,
  };
}

function resultUnits(row: Row): number | null {
  if (row.odds_american === null) return null;
  if (row.result === "win") return profitMultiplier(row.odds_american);
  if (row.result === "loss") return -1;
  if (row.result === "push" || row.result === "void") return 0;
  return null;
}

function addRow(bucket: Bucket, row: Row): void {
  bucket.total++;
  const result = row.result;
  if (result === "win") {
    bucket.graded++;
    bucket.wins++;
  } else if (result === "loss") {
    bucket.graded++;
    bucket.losses++;
  } else if (result === "push") {
    bucket.graded++;
    bucket.pushes++;
  } else if (result === "void") {
    bucket.voids++;
  } else {
    bucket.pending++;
  }

  const units = resultUnits(row);
  if (units !== null) {
    bucket.units += units;
    bucket.roiEligible++;
  }
  if (typeof row.model_probability === "number") {
    bucket.modelProbSum += row.model_probability;
    bucket.modelProbCount++;
  }
  if (typeof row.edge === "number") {
    bucket.edgeSum += row.edge;
    bucket.edgeCount++;
  }

  const snap = snapshotObj(row.snapshot_json);
  const clvObj = snapshotObj(nested(snap, "clv"));
  const clv =
    numberish(clvObj.clv_pct) ??
    numberish(nested(snap, "clv_pct")) ??
    numberish(nested(snap, "closing.clv_pct"));
  const beat =
    boolish(clvObj.beat_closing_line) ??
    boolish(nested(snap, "beat_closing_line")) ??
    boolish(nested(snap, "closing.beat_closing_line"));
  if (clv !== null) {
    bucket.clvCount++;
    bucket.clvSum += clv;
  }
  if (beat === true) bucket.beatClose++;
}

function pct(n: number, d: number): string {
  if (d <= 0) return "-";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function avg(sum: number, n: number): string {
  return n > 0 ? (sum / n).toFixed(2) : "-";
}

function bucketLine(b: Bucket, minSample: number): string {
  const wl = b.wins + b.losses;
  const roi = b.roiEligible > 0 ? `${((b.units / b.roiEligible) * 100).toFixed(1)}%` : "-";
  const units = b.units >= 0 ? `+${b.units.toFixed(2)}` : b.units.toFixed(2);
  const flag = wl > 0 && wl < minSample ? " small" : "";
  return [
    b.label.padEnd(34),
    String(b.total).padStart(5),
    String(wl).padStart(5),
    `${b.wins}-${b.losses}`.padStart(8),
    pct(b.wins, wl).padStart(8),
    units.padStart(9),
    roi.padStart(8),
    avg(b.clvSum, b.clvCount).padStart(8),
    pct(b.beatClose, b.clvCount).padStart(8),
    avg(b.modelProbSum * 100, b.modelProbCount).padStart(8),
    avg(b.edgeSum, b.edgeCount).padStart(8),
    flag,
  ].join("  ");
}

function edgeBucket(edge: number | null): string {
  if (edge === null) return "edge:missing";
  if (edge < 0) return "edge:negative";
  if (edge < 2) return "edge:0-2pp";
  if (edge < 4) return "edge:2-4pp";
  if (edge < 6) return "edge:4-6pp";
  if (edge < 10) return "edge:6-10pp";
  return "edge:10pp+";
}

function probabilityBucket(p: number | null): string {
  if (p === null) return "prob:missing";
  if (p < 0.5) return "prob:<50";
  if (p < 0.55) return "prob:50-55";
  if (p < 0.6) return "prob:55-60";
  if (p < 0.65) return "prob:60-65";
  if (p < 0.7) return "prob:65-70";
  return "prob:70+";
}

function snapshotFlags(row: Row): string[] {
  const snap = snapshotObj(row.snapshot_json);
  const flags: string[] = [];

  const directKeys = [
    "line_movement_vs_pick",
    "edge_strength",
    "public_money_context",
    "public_split_agreement_state",
    "public_split_model_confidence",
    "data_quality_tier",
    "market_signal",
    "source",
  ];
  for (const key of directKeys) {
    const v = stringish(snap[key]);
    if (v) flags.push(`${key}:${v}`);
  }

  const clvObj = snapshotObj(nested(snap, "clv"));
  const beat = boolish(clvObj.beat_closing_line) ?? boolish(nested(snap, "beat_closing_line"));
  if (beat !== null) flags.push(`beat_close:${beat}`);

  const playbookWeather = snapshotObj(nested(snap, "playbook_venue_weather"));
  const pbWeatherApplied = boolish(playbookWeather.applied);
  if (pbWeatherApplied !== null) flags.push(`playbook_weather_applied:${pbWeatherApplied}`);
  const pbWeatherReason = stringish(playbookWeather.reason);
  if (pbWeatherReason) flags.push(`playbook_weather_reason:${pbWeatherReason}`);

  const v22 = snapshotObj(nested(snap, "v2_2_audit"));
  const workloadApplied = boolish(v22.workload_pitching_applied);
  if (workloadApplied !== null) flags.push(`workload_pitching_applied:${workloadApplied}`);
  const homeWorkload = stringish(nested(v22, "home_starter_workload.role"));
  const awayWorkload = stringish(nested(v22, "away_starter_workload.role"));
  if (homeWorkload) flags.push(`home_workload:${homeWorkload}`);
  if (awayWorkload) flags.push(`away_workload:${awayWorkload}`);
  const featureTier = stringish(v22.data_quality_tier);
  if (featureTier) flags.push(`v22_tier:${featureTier}`);
  const featureReasons = nested(v22, "feature_reason_codes");
  if (Array.isArray(featureReasons)) {
    for (const reason of featureReasons.slice(0, 8)) {
      if (typeof reason === "string") flags.push(`feature:${reason}`);
    }
  }

  const publicCtx = snapshotObj(nested(snap, "public_market_context"));
  const publicSource = stringish(publicCtx.source);
  if (publicSource) flags.push(`public_source:${publicSource}`);
  const publicAgreement = stringish(publicCtx.agreement_state);
  if (publicAgreement) flags.push(`public_agreement:${publicAgreement}`);

  return [...new Set(flags)];
}

function addToGroup(groups: Map<string, Bucket>, key: string, row: Row): void {
  const b = groups.get(key) ?? newBucket(key);
  addRow(b, row);
  groups.set(key, b);
}

function printGroup(title: string, groups: Map<string, Bucket>, minSample: number, limit = 80): void {
  console.log(`\n━━━ ${title} ━━━`);
  console.log(
    `${"bucket".padEnd(34)}  total     WL       W-L  hit-rate      units      ROI   avgCLV  beatCL   avgProb  avgEdge`,
  );
  console.log("─".repeat(138));
  const rows = [...groups.values()]
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.label.localeCompare(b.label))
    .slice(0, limit);
  for (const b of rows) console.log(bucketLine(b, minSample));
}

async function loadRows(opts: Opts): Promise<Row[]> {
  const { data: records, error: rErr } = await supabase
    .from("prediction_records")
    .select(
      "id, sport, slate_date, market, pick, side, odds_american, model_used, model_version, model_probability, market_probability, edge, play_grade, best_angle, data_quality_tier, snapshot_json, held",
    )
    .eq("sport", opts.sport)
    .gte("slate_date", opts.dateFrom)
    .lte("slate_date", opts.dateTo);
  if (rErr) throw new Error(`prediction_records query failed: ${rErr.message}`);
  const recs = (records ?? []) as PredictionRecord[];
  if (recs.length === 0) return [];

  const ids = recs.map((r) => r.id);
  const gradeRows: GradeRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase
      .from("prediction_grades")
      .select("prediction_record_id, result, win, loss, push, void, pending")
      .in("prediction_record_id", ids.slice(i, i + 500));
    if (error) throw new Error(`prediction_grades query failed: ${error.message}`);
    gradeRows.push(...((data ?? []) as GradeRow[]));
  }
  const gradeById = new Map(gradeRows.map((g) => [g.prediction_record_id, g]));
  return recs.map((r) => ({ ...r, result: gradeResult(gradeById.get(r.id)) }));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const rowsAll = await loadRows(opts);
  const rows = rowsAll.filter((r) => {
    if (opts.markets && (!r.market || !opts.markets.has(r.market))) return false;
    const pg = (r.play_grade ?? "").toLowerCase();
    if (r.held === true || pg === "held" || pg === "toss_up") return false;
    return true;
  });

  console.log(`\n━━━ MODEL INPUT ATTRIBUTION · ${opts.sport.toUpperCase()} ${opts.dateFrom}..${opts.dateTo} ━━━`);
  console.log(`READ-ONLY · records=${rowsAll.length} actionable=${rows.length} minSample=${opts.minSample}`);
  if (opts.markets) console.log(`markets=${[...opts.markets].join(",")}`);

  const top = new Map<string, Bucket>();
  for (const row of rows) addToGroup(top, "ALL", row);
  printGroup("Top Line", top, opts.minSample);

  const standard = new Map<string, Bucket>();
  const flags = new Map<string, Bucket>();
  for (const row of rows) {
    addToGroup(standard, `market:${row.market ?? "unknown"}`, row);
    addToGroup(standard, `grade:${row.play_grade ?? "unknown"}`, row);
    addToGroup(standard, `best_angle:${row.best_angle === true}`, row);
    addToGroup(standard, `model:${row.model_used ?? "unknown"}:${row.model_version ?? "unknown"}`, row);
    addToGroup(standard, `tier:${row.data_quality_tier ?? "unknown"}`, row);
    addToGroup(standard, probabilityBucket(row.model_probability), row);
    addToGroup(standard, edgeBucket(row.edge), row);
    for (const flag of snapshotFlags(row)) addToGroup(flags, flag, row);
  }

  printGroup("Core Inputs", standard, opts.minSample);
  printGroup("Snapshot / Provider Flags", flags, opts.minSample);

  const candidates = [...standard.values(), ...flags.values()]
    .filter((b) => b.wins + b.losses >= opts.minSample)
    .map((b) => {
      const wl = b.wins + b.losses;
      const hit = wl > 0 ? b.wins / wl : 0;
      const roi = b.roiEligible > 0 ? b.units / b.roiEligible : 0;
      const clv = b.clvCount > 0 ? b.clvSum / b.clvCount : null;
      return { b, hit, roi, clv };
    })
    .sort((a, b) => b.roi - a.roi || b.hit - a.hit);

  console.log("\n━━━ Candidate Signals To Investigate ━━━");
  if (candidates.length === 0) {
    console.log("No buckets reached min sample. Lower --min-sample or widen the date range.");
  } else {
    console.log("These are NOT automatic tuning changes. They are the first shortlist for replay/counterfactual testing.");
    for (const c of candidates.slice(0, 12)) {
      const wl = c.b.wins + c.b.losses;
      console.log(
        `  ${c.b.label}: ${c.b.wins}-${c.b.losses} (${pct(c.b.wins, wl)}), ROI=${(c.roi * 100).toFixed(1)}%, avgCLV=${c.clv === null ? "-" : c.clv.toFixed(2)}`,
      );
    }
  }

  if (opts.verbose) {
    console.log("\nVerbose mode note: add per-pick dumps here after a shortlist is chosen, to keep default output readable.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

