/**
 * SELECT-only, release-pure MLB FI independent-probability calibration audit.
 *
 * The cohort, partitions, and candidate family were frozen in
 * docs/model-audits/2026-09-04-mlb-fi-independent-uncertainty-r85.md before
 * this program joined any outcomes. This program has no mutation mode.
 */
import { createClient } from "@supabase/supabase-js";

type DbRow = Record<string, unknown>;
type Pick = "NRFI" | "YRFI" | "Toss-Up";
type Partition = "train" | "validation" | "untouched";

const START = "2026-06-07";
const END = "2026-08-19";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase credentials");
const db = createClient(url, key, { auth: { persistSession: false } });

function partition(date: string): Partition {
  if (date <= "2026-07-10") return "train";
  if (date <= "2026-07-31") return "validation";
  return "untouched";
}
function clamp(p: number): number { return Math.max(0.001, Math.min(0.999, p)); }
function logit(p: number): number { const q = clamp(p); return Math.log(q / (1 - q)); }
function logistic(x: number): number { return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)); }
function profit(odds: number, won: boolean): number { return won ? (odds > 0 ? odds / 100 : 100 / -odds) : -1; }
function asObject(value: unknown): DbRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DbRow : {};
}

type AuditRow = {
  id: number;
  gameId: number;
  date: string;
  lockedAt: string;
  release: string;
  independent: number;
  storedPosterior: number;
  storedPick: Pick;
  storedOdds: number | null;
  outcomeNrfi: boolean;
};

function classify(pNrfi: number, halfWidth = 0.02): Pick {
  if (pNrfi >= 0.5 + halfWidth) return "NRFI";
  if (pNrfi <= 0.5 - halfWidth) return "YRFI";
  return "Toss-Up";
}

function fitPlatt(rows: AuditRow[]): { intercept: number; slope: number } {
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 30; iteration++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const row of rows) {
      const x = logit(row.independent);
      const y = row.outcomeNrfi ? 1 : 0;
      const p = logistic(intercept + slope * x);
      const residual = y - p;
      const weight = p * (1 - p);
      g0 += residual;
      g1 += residual * x;
      h00 += weight;
      h01 += weight * x;
      h11 += weight * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const d0 = (g0 * h11 - g1 * h01) / det;
    const d1 = (g1 * h00 - g0 * h01) / det;
    intercept += d0;
    slope += d1;
    if (Math.max(Math.abs(d0), Math.abs(d1)) < 1e-10) break;
  }
  return { intercept, slope };
}

function metrics(rows: AuditRow[], probability: (row: AuditRow) => number, halfWidth = 0.02) {
  let brier = 0, logLoss = 0, sumP = 0, sumY = 0;
  let directional = 0, correct = 0, nrfi = 0, nrfiCorrect = 0, yrfi = 0, yrfiCorrect = 0, toss = 0;
  let sameSidePriced = 0, sameSideUnits = 0;
  const zeroTossDates = new Map<string, number>();
  for (const row of rows) {
    const p = clamp(probability(row));
    const y = row.outcomeNrfi ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    sumP += p; sumY += y;
    const pick = classify(p, halfWidth);
    zeroTossDates.set(row.date, (zeroTossDates.get(row.date) ?? 0) + (pick === "Toss-Up" ? 1 : 0));
    if (pick === "Toss-Up") { toss++; continue; }
    directional++;
    const won = pick === "NRFI" ? row.outcomeNrfi : !row.outcomeNrfi;
    if (won) correct++;
    if (pick === "NRFI") { nrfi++; if (won) nrfiCorrect++; }
    else { yrfi++; if (won) yrfiCorrect++; }
    if (pick === row.storedPick && row.storedOdds !== null && Number.isFinite(row.storedOdds)) {
      sameSidePriced++;
      sameSideUnits += profit(row.storedOdds, won);
    }
  }
  return {
    rows: rows.length,
    brier: +(brier / rows.length).toFixed(5),
    logLoss: +(logLoss / rows.length).toFixed(5),
    calibrationGapPp: +((sumP - sumY) / rows.length * 100).toFixed(2),
    decisions: { NRFI: nrfi, YRFI: yrfi, TossUp: toss, tossUpPct: +(toss / rows.length * 100).toFixed(1), directionalAccuracyPct: directional ? +(correct / directional * 100).toFixed(1) : null, nrfiAccuracyPct: nrfi ? +(nrfiCorrect / nrfi * 100).toFixed(1) : null, yrfiAccuracyPct: yrfi ? +(yrfiCorrect / yrfi * 100).toFixed(1) : null, zeroTossDates: [...zeroTossDates.values()].filter((count) => count === 0).length },
    economics: { scope: "same_candidate_and_stored_side_with_exact_locked_price_only", priced: sameSidePriced, units: +sameSideUnits.toFixed(3), roiPct: sameSidePriced ? +(sameSideUnits / sameSidePriced * 100).toFixed(1) : null },
  };
}

async function loadPredictionRows(): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("prediction_records")
      .select("id,game_id,slate_date,locked_at,pick,odds_american,launch_day,snapshot_json")
      .eq("sport", "mlb").eq("market", "first_inning")
      .gte("slate_date", START).lte("slate_date", END)
      .not("locked_at", "is", null).order("id", { ascending: true }).range(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 500) return rows;
  }
}

async function main() {
  if (process.argv.some((arg) => /--apply|--write|--mutate/i.test(arg))) throw new Error("Refusing mutation flag: SELECT-only audit");
  const raw = await loadPredictionRows();
  const unique = new Map<string, DbRow>();
  for (const row of raw) {
    const snapshot = asObject(row.snapshot_json);
    const versions = asObject(snapshot.model_layer_versions);
    const release = String(
      versions.active_probability_head ??
      snapshot.first_inning_release_id ??
      "legacy",
    );
    unique.set(`${row.game_id}|${row.locked_at}|${release}`, row);
  }
  const gameIds = [...new Set([...unique.values()].map((row) => Number(row.game_id)))];
  const gameMap = new Map<number, DbRow>();
  for (let index = 0; index < gameIds.length; index += 200) {
    const { data, error } = await db.from("games").select("id,first_inning_runs").in("id", gameIds.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const game of data ?? []) gameMap.set(Number(game.id), game);
  }
  const rows: AuditRow[] = [];
  for (const row of unique.values()) {
    if (row.launch_day === true) continue;
    const snapshot = asObject(row.snapshot_json);
    const versions = asObject(snapshot.model_layer_versions);
    const audit = asObject(snapshot.fi_v2_audit);
    const independent = Number(audit.independent_p_nrfi);
    const storedPosterior = Number(audit.posterior_p_nrfi);
    const runs = Number(gameMap.get(Number(row.game_id))?.first_inning_runs);
    const storedPick = String(audit.fi_pick ?? row.pick ?? "");
    if (!Number.isFinite(independent) || !Number.isFinite(storedPosterior) || !Number.isFinite(runs)) continue;
    if (storedPick !== "NRFI" && storedPick !== "YRFI" && storedPick !== "Toss-Up") continue;
    rows.push({ id:Number(row.id), gameId:Number(row.game_id), date:String(row.slate_date), lockedAt:String(row.locked_at), release:String(versions.active_probability_head ?? snapshot.first_inning_release_id ?? "legacy"), independent, storedPosterior, storedPick, storedOdds:typeof row.odds_american === "number" ? row.odds_american : null, outcomeNrfi:runs === 0 });
  }
  const train = rows.filter((row) => partition(row.date) === "train");
  const platt = fitPlatt(train);
  const candidates = {
    identity_existing_band: { probability: (row: AuditRow) => row.independent, halfWidth: 0.02 },
    train_only_platt_existing_band: { probability: (row: AuditRow) => logistic(platt.intercept + platt.slope * logit(row.independent)), halfWidth: 0.02 },
    ...Object.fromEntries([0.025,0.03,0.035,0.04,0.05].map((halfWidth) => [`identity_band_${halfWidth}`, { probability: (row: AuditRow) => row.independent, halfWidth }])),
  };
  const report = Object.fromEntries(Object.entries(candidates).map(([name, candidate]) => [name, Object.fromEntries((["train","validation","untouched"] as Partition[]).map((part) => [part, metrics(rows.filter((row) => partition(row.date) === part), candidate.probability, candidate.halfWidth)]))]));
  console.log(JSON.stringify({ mode:"select_only_release_pure_fi_independent_uncertainty_r85", mutationMode:false, outcomeJoinAfterPredeclarationCommit:"4e89d44f", bounds:{start:START,end:END}, uniqueness:{raw:raw.length,uniqueGameLocks:unique.size,eligible:rows.length}, partitions:{train:"2026-06-07..2026-07-10",validation:"2026-07-11..2026-07-31",untouched:"2026-08-01..2026-08-19"}, trainOnlyPlatt:platt, report }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
