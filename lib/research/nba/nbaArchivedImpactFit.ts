import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
import { qualifyNbaArchivedRotation, type NbaArchivedRotationSnapshot } from "./nbaArchivedRotationLedger";
import { scoreNbaPortableModel, type NbaPortableModelArtifact, type NbaPortableFeatureRow } from "../../automodel/nba/nbaPortableScoreModel";

export const NBA_ARCHIVED_IMPACT_FIT_RELEASE = "nba_archived_impact_fit_2026_11_23_r1_fixed_chronological" as const;
export const NBA_ARCHIVED_BASELINE_RECIPE = "nba_archived_portable_recipe_2026_11_23_r1_train_only_ridge1000" as const;
const dimensions = 6, alpha = 1000;
const instant = (s: string) => { const t = Date.parse(s); if (!Number.isFinite(t)) throw Error("invalid_fit_clock"); return t; };
function solve(a: number[][], y: number[]): number[] {
  const n = y.length, l = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let v = a[i]![j]!; for (let k = 0; k < j; k++) v -= l[i]![k]! * l[j]![k]!;
    l[i]![j] = i === j ? Math.sqrt(v) : v / l[j]![j]!;
    if (!Number.isFinite(l[i]![j]) || i === j && l[i]![j]! <= 0) throw Error("non_positive_fit_system");
  }
  const f = Array<number>(n).fill(0), result = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) { let v = y[i]!; for (let k = 0; k < i; k++) v -= l[i]![k]! * f[k]!; f[i] = v / l[i]![i]!; }
  for (let i = n - 1; i >= 0; i--) { let v = f[i]!; for (let k = i + 1; k < n; k++) v -= l[k]![i]! * result[k]!; result[i] = v / l[i]![i]!; }
  if (!result.every(Number.isFinite)) throw Error("nonfinite_fit"); return result;
}
function ridge(x: number[][], ys: number[][], intercept: boolean) {
  const n = x[0]!.length + Number(intercept), a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j && (!intercept || i !== n - 1) ? alpha : 0));
  const b = ys.map(() => Array<number>(n).fill(0));
  for (let r = 0; r < x.length; r++) {
    const v = intercept ? [...x[r]!, 1] : x[r]!;
    for (let i = 0; i < n; i++) { for (let j = 0; j <= i; j++) a[i]![j]! += v[i]! * v[j]!; for (let t = 0; t < ys.length; t++) b[t]![i]! += v[i]! * ys[t]![r]!; }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) a[i]![j] = a[j]![i]!;
  return b.map(y => solve(a, y));
}
export type ArchivedBaselineRow = { gameId: string; season: number; cutoff: string; finalAvailableAt: string; features: NbaPortableFeatureRow; actualMargin: number; actualTotal: number };
export function fitNbaArchivedBaseline(rows: readonly ArchivedBaselineRow[], featureNames: readonly string[], featureRelease: string, selectionStart: string) {
  if (rows.length < 10 || rows.length > 10000 || !featureNames.length || featureNames.length > 150 || new Set(featureNames).size !== featureNames.length || new Set(rows.map(r => r.gameId)).size !== rows.length) throw Error("invalid_baseline_training_budget");
  const sorted = [...rows].sort((a, b) => a.gameId.localeCompare(b.gameId));
  if (sorted.some(r => instant(r.finalAvailableAt) >= instant(selectionStart) || instant(r.finalAvailableAt) <= instant(r.cutoff) || ![r.actualMargin, r.actualTotal].every(Number.isFinite) || r.actualTotal <= 0)) throw Error("baseline_training_crosses_boundary");
  const missing = (v: number | null | undefined): v is null | undefined => v == null || !Number.isFinite(v);
  const raw = sorted.map(r => featureNames.map(f => r.features[f]));
  const medians = featureNames.map((_, i) => { const values = raw.flatMap(r => missing(r[i]) ? [] : [r[i]!]).sort((a, b) => a - b); const m = Math.floor(values.length / 2); return values.length ? values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2 : 0; });
  const missingIndexes = featureNames.flatMap((_, i) => raw.some(r => missing(r[i])) ? [i] : []);
  const filled = raw.map(r => [...r.map((v, i) => missing(v) ? medians[i]! : v), ...missingIndexes.map(i => Number(missing(r[i])))]);
  const n = filled[0]!.length, means = Array.from({ length: n }, (_, i) => filled.reduce((s, r) => s + r[i]!, 0) / filled.length);
  const deviations = means.map((mean, i) => { const sd = Math.sqrt(filled.reduce((s, r) => s + (r[i]! - mean) ** 2, 0) / filled.length); return sd > 1e-12 ? sd : 1; });
  const x = filled.map(r => r.map((v, i) => (v - means[i]!) / deviations[i]!));
  const [margin, total] = ridge(x, [sorted.map(r => r.actualMargin), sorted.map(r => r.actualTotal)], true);
  const artifact: NbaPortableModelArtifact = { release: NBA_ARCHIVED_BASELINE_RECIPE, featureRelease, architecture: "margin_total", model: { family: "ridge", alpha },
    design: { features: [...featureNames], missingIndicatorColumns: missingIndexes.map(i => featureNames[i]!), rawFeatureMedians: medians, designMeans: means, designStandardDeviations: deviations, designColumns: n, splineKnots: [] }, coefficients: { target_home_margin: margin!, target_total: total! } };
  const core = { recipe: NBA_ARCHIVED_BASELINE_RECIPE, artifact, trainingRows: sorted.length, trainingEnd: new Date(Math.max(...sorted.map(r => instant(r.finalAvailableAt)))).toISOString(), trainingHash: nbaPlayerStateHash(sorted) };
  return { ...core, hash: nbaPlayerStateHash(core) };
}
export type NbaArchivedBaselineHead = ReturnType<typeof fitNbaArchivedBaseline>;
type Baseline = NbaArchivedBaselineHead;
export function fitNbaFixedSixResidual(x: number[][], margin: number[], total: number[]) {
  if (x.length <= dimensions || x.length > 10000 || margin.length !== x.length || total.length !== x.length || x.some(r => r.length !== dimensions || !r.every(Number.isFinite)) || ![...margin, ...total].every(Number.isFinite)) throw Error("invalid_fixed_six_system");
  const [m, t] = ridge(x, [margin, total], false); return { margin: m!, total: t! };
}
type Proof = NonNullable<Parameters<typeof qualifyNbaArchivedRotation>[1]>;
export type ArchivedResidualTrainingRow = { snapshotHash: string; baseline: Baseline; features: NbaPortableFeatureRow; actualMargin: number; actualTotal: number; finalAvailableAt: string };
export function fitNbaArchivedImpact(args: { snapshots: readonly NbaArchivedRotationSnapshot[]; proof: Proof; training: readonly ArchivedResidualTrainingRow[] }) {
  // Must precede reading training outcomes, even for an empty/invalid cohort.
  const qualified = qualifyNbaArchivedRotation(args.snapshots, args.proof);
  if (!qualified.mayFit) throw Error("archival_data_gate_closed:" + qualified.issues.join(","));
  if (args.training.length <= dimensions || args.training.length > 10000) throw Error("invalid_archival_training_budget");
  const snapshots = new Map(args.snapshots.map(s => [s.hash, s])), ids = new Set<string>(), baselineHashes = new Set<string>();
  let trainingEnd = -Infinity;
  const x: number[][] = [], margin: number[] = [], total: number[] = [];
  for (const row of [...args.training].sort((a, b) => a.snapshotHash.localeCompare(b.snapshotHash))) {
    const s = snapshots.get(row.snapshotHash); if (!s || s.status !== "complete" || !s.features || s.target.season >= 2023 || ids.has(s.target.gameId)) throw Error("invalid_archival_training_snapshot");
    const { hash, ...core } = row.baseline;
    if (hash !== nbaPlayerStateHash(core) || row.baseline.recipe !== NBA_ARCHIVED_BASELINE_RECIPE || instant(row.baseline.trainingEnd) >= instant(s.target.cutoff)) throw Error("in_sample_or_incompatible_baseline");
    if (![row.actualMargin, row.actualTotal].every(Number.isFinite) || row.actualTotal <= 0 || instant(row.finalAvailableAt) <= instant(s.target.startAt)) throw Error("invalid_archival_training_outcome");
    const prediction = scoreNbaPortableModel(row.baseline.artifact, row.features);
    x.push([...s.features]); margin.push(row.actualMargin - prediction.marginHome); total.push(row.actualTotal - prediction.total);
    ids.add(s.target.gameId); baselineHashes.add(hash); trainingEnd = Math.max(trainingEnd, instant(row.finalAvailableAt));
  }
  if (baselineHashes.size !== 1 || args.snapshots.some(s => [2023, 2024].includes(s.target.season) && instant(s.target.cutoff) <= trainingEnd)) throw Error("mixed_fit_or_selection_boundary");
  const [marginCoefficients, totalCoefficients] = ridge(x, [margin, total], false);
  const core = { release: NBA_ARCHIVED_IMPACT_FIT_RELEASE, baselineRecipe: NBA_ARCHIVED_BASELINE_RECIPE, baselineTrainingHashes: [...baselineHashes], alpha, intercept: 0, margin: marginCoefficients!, total: totalCoefficients!, trainingRows: x.length, trainingEnd: new Date(trainingEnd).toISOString(), ledgerHash: qualified.ledgerHash, trainingHash: nbaPlayerStateHash(args.training.map(r => ({ ...r, baseline: r.baseline.hash })).sort((a,b) => a.snapshotHash.localeCompare(b.snapshotHash))) };
  return { ...core, hash: nbaPlayerStateHash(core) };
}
export function applyNbaArchivedImpact(head: ReturnType<typeof fitNbaArchivedImpact>, snapshot: NbaArchivedRotationSnapshot, baseline: Baseline, row: NbaPortableFeatureRow) {
  const { hash, ...core } = head, { hash: snapshotHash, ...snapshotCore } = snapshot, { hash: baselineHash, ...baselineCore } = baseline;
  if (hash !== nbaPlayerStateHash(core) || snapshotHash !== nbaPlayerStateHash(snapshotCore) || baselineHash !== nbaPlayerStateHash(baselineCore) || head.release !== NBA_ARCHIVED_IMPACT_FIT_RELEASE || head.alpha !== alpha || head.intercept !== 0 || head.baselineRecipe !== baseline.recipe || snapshot.status !== "complete" || snapshot.features?.length !== dimensions || !snapshot.features.every(Number.isFinite) || instant(snapshot.target.cutoff) <= Math.max(instant(head.trainingEnd), instant(baseline.trainingEnd))) throw Error("incompatible_archival_application");
  const score = scoreNbaPortableModel(baseline.artifact, row);
  const marginCorrection = snapshot.features.reduce((n, v, i) => n + v * head.margin[i]!, 0), totalCorrection = snapshot.features.reduce((n, v, i) => n + v * head.total[i]!, 0);
  const margin = score.marginHome + marginCorrection, total = score.total + totalCorrection;
  if (![margin, total].every(Number.isFinite) || total <= 0) throw Error("invalid_archival_score");
  return { marginCorrection, totalCorrection, margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 };
}
