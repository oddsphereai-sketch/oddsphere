import { nbaPlayerStateHash, qualifyNbaPlayerStateLedger, type NbaPlayerStateSnapshot } from "./nbaPlayerStateLedger";

export const NBA_EXPECTED_ROTATION_RESIDUAL_RELEASE = "nba_expected_rotation_residual_2026_11_20_r1_fixed_shadow" as const;
const ALPHA = 1000, DIMENSIONS = 6, SELECTION_START_SEASON = 2023;
type Proof = NonNullable<Parameters<typeof qualifyNbaPlayerStateLedger>[1]>;
export type NbaRotationResidualTrainingRow = {
  snapshotHash: string; baselineRelease: string; baselineInputCutoff: string; baselineTrainingEnd: string;
  baselineGeneratedAt: string; baselineMargin: number; baselineTotal: number;
  actualMargin: number; actualTotal: number; finalAvailableAt: string;
};
export type NbaRotationResidualHead = { release: typeof NBA_EXPECTED_ROTATION_RESIDUAL_RELEASE; alpha: 1000; intercept: 0;
  baselineRelease: string; margin: readonly number[]; total: readonly number[]; trainingRows: number;
  trainingEnd: string; ledgerHash: string; trainingHash: string; hash: string };
const instant = (s: string) => { const t = Date.parse(s); if (!Number.isFinite(t)) throw Error("invalid_residual_clock"); return t; };
function features(snapshot: NbaPlayerStateSnapshot): readonly number[] {
  const { hash, ...core } = snapshot;
  if (hash !== nbaPlayerStateHash(core) || snapshot.status !== "complete" || snapshot.features?.length !== DIMENSIONS || !snapshot.features.every(Number.isFinite)) throw Error("unqualified_residual_snapshot");
  if (instant(snapshot.target.cutoff) !== instant(snapshot.target.startAt) - 3600000) throw Error("residual_requires_exact_T60");
  if (snapshot.teams.length !== 2 || snapshot.teams.some(t => t.status !== "complete" || !t.players.length ||
    t.players.some(p => !Number.isFinite(p.expectedMinutes) || p.expectedMinutes < 0 || p.expectedMinutes > 48 || p.status === "out" && p.expectedMinutes !== 0) ||
    Math.abs(t.players.reduce((n, p) => n + p.expectedMinutes, 0) - 240) > 1e-7)) throw Error("incoherent_residual_rotation");
  return snapshot.features;
}
/** Fixed positive-definite ridge system. No intercept, feature search, market
 * price, cap, activation threshold or questionable-player probability. */
function solve(matrix: number[][], target: number[]): number[] {
  const lower = Array.from({ length: DIMENSIONS }, () => Array(DIMENSIONS).fill(0));
  for (let i = 0; i < DIMENSIONS; i++) for (let j = 0; j <= i; j++) {
    let value = matrix[i][j]; for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
    lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
    if (!Number.isFinite(lower[i][j]) || i === j && lower[i][j] <= 0) throw Error("invalid_residual_system");
  }
  const forward = Array(DIMENSIONS).fill(0), result = Array(DIMENSIONS).fill(0);
  for (let i = 0; i < DIMENSIONS; i++) { let v = target[i]; for (let k = 0; k < i; k++) v -= lower[i][k] * forward[k]; forward[i] = v / lower[i][i]; }
  for (let i = DIMENSIONS - 1; i >= 0; i--) { let v = forward[i]; for (let k = i + 1; k < DIMENSIONS; k++) v -= lower[k][i] * result[k]; result[i] = v / lower[i][i]; }
  if (!result.every(Number.isFinite)) throw Error("nonfinite_residual_head"); return result;
}
/** The October 29 source gate is checked BEFORE any training outcome is read.
 * Selection/replication/current outcomes are not accepted by this interface. */
export function fitNbaExpectedRotationResidual(args: { snapshots: readonly NbaPlayerStateSnapshot[]; proof: Proof;
  training: readonly NbaRotationResidualTrainingRow[] }): NbaRotationResidualHead {
  const qualification = qualifyNbaPlayerStateLedger(args.snapshots, args.proof);
  if (!qualification.mayFit) throw Error("player_state_data_gate_closed:" + qualification.issues.join(","));
  const byHash = new Map(args.snapshots.map(s => [s.hash, s]));
  const matrix = Array.from({ length: DIMENSIONS }, (_, i) => Array.from({ length: DIMENSIONS }, (_, j) => i === j ? ALPHA : 0));
  const margin = Array(DIMENSIONS).fill(0), total = Array(DIMENSIONS).fill(0), games = new Set<number>(), baselineReleases = new Set<string>();
  let trainingEnd = -Infinity;
  if (args.training.length <= DIMENSIONS || args.training.length > 10000) throw Error("invalid_residual_training_budget");
  // Sort before summation so replay is independent of supplied row order.
  const training = [...args.training].sort((a, b) => a.snapshotHash.localeCompare(b.snapshotHash));
  for (const row of training) {
    const s = byHash.get(row.snapshotHash); if (!s) throw Error("training_snapshot_not_in_frozen_ledger");
    if (s.target.season >= SELECTION_START_SEASON || games.has(s.target.gameId)) throw Error("selection_leakage_or_duplicate_training_game");
    const x = features(s), cutoff = instant(s.target.cutoff), start = instant(s.target.startAt);
    if (instant(row.baselineInputCutoff) > cutoff || instant(row.baselineTrainingEnd) >= cutoff || instant(row.baselineGeneratedAt) < instant(row.baselineInputCutoff) ||
      instant(row.finalAvailableAt) <= start) throw Error("invalid_training_asof_or_final_clock");
    if (![row.baselineMargin, row.baselineTotal, row.actualMargin, row.actualTotal].every(Number.isFinite) || row.baselineTotal <= 0 || row.actualTotal <= 0 || !row.baselineRelease) throw Error("invalid_residual_training_values");
    games.add(s.target.gameId); baselineReleases.add(row.baselineRelease); trainingEnd = Math.max(trainingEnd, instant(row.finalAvailableAt));
    const yMargin = row.actualMargin - row.baselineMargin, yTotal = row.actualTotal - row.baselineTotal;
    for (let i = 0; i < DIMENSIONS; i++) { margin[i] += x[i] * yMargin; total[i] += x[i] * yTotal; for (let j = 0; j < DIMENSIONS; j++) matrix[i][j] += x[i] * x[j]; }
  }
  if (baselineReleases.size !== 1) throw Error("mixed_baseline_releases");
  const selection = args.snapshots.filter(s => [2023, 2024].includes(s.target.season));
  if (selection.some(s => instant(s.target.cutoff) <= trainingEnd)) throw Error("training_result_crosses_selection_boundary");
  const core = { release: NBA_EXPECTED_ROTATION_RESIDUAL_RELEASE, alpha: ALPHA as 1000, intercept: 0 as const,
    baselineRelease: [...baselineReleases][0], margin: solve(matrix, margin), total: solve(matrix, total), trainingRows: training.length,
    trainingEnd: new Date(trainingEnd).toISOString(), ledgerHash: qualification.ledgerHash, trainingHash: nbaPlayerStateHash(training) };
  return { ...core, hash: nbaPlayerStateHash(core) };
}
export function applyNbaExpectedRotationResidual(head: NbaRotationResidualHead, snapshot: NbaPlayerStateSnapshot, baseline: { release: string; margin: number; total: number }) {
  const { hash, ...core } = head;
  if (hash !== nbaPlayerStateHash(core) || head.release !== NBA_EXPECTED_ROTATION_RESIDUAL_RELEASE || head.alpha !== ALPHA || head.intercept !== 0 ||
    head.margin.length !== DIMENSIONS || head.total.length !== DIMENSIONS || ![...head.margin, ...head.total].every(Number.isFinite)) throw Error("invalid_frozen_residual_head");
  const x = features(snapshot);
  if (instant(snapshot.target.cutoff) <= instant(head.trainingEnd) || baseline.release !== head.baselineRelease || ![baseline.margin, baseline.total].every(Number.isFinite)) throw Error("incompatible_residual_baseline_or_cutoff");
  const marginCorrection = x.reduce((n, v, i) => n + v * head.margin[i], 0), totalCorrection = x.reduce((n, v, i) => n + v * head.total[i], 0);
  const margin = baseline.margin + marginCorrection, total = baseline.total + totalCorrection;
  return { release: head.release, headHash: head.hash, snapshotHash: snapshot.hash, marginCorrection, totalCorrection, margin, total,
    homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 };
}
