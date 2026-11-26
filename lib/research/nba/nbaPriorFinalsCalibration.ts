import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";

/** Offline only: no production import, source request, database or grade. */
export const NBA_PRIOR_FINALS_CALIBRATION_RELEASE = "nba_prior_finals_calibration_2026_11_24_r1_exponential" as const;
export const NBA_PRIOR_FINALS_SOURCE_RECIPE = "nba_original_team_feature_source_2026_11_23_r1_native_box_counts" as const;
export type NbaClimateParameters = { signalVariance: number; noiseVariance: number; lengthDays: number };
export type NbaClimateObservation = {
  gameId: string; season: number; startAt: string; finalAvailableAt: string;
  sourceSha256: string; sourceRecipe: string; baselineHash: string;
  baselineMargin: number; baselineTotal: number; homeScore: number; awayScore: number;
};
export type NbaClimateTarget = {
  gameId: string; season: number; startAt: string; cutoff: string;
  baselineHash: string; baselineRecipe: string; baselineTrainingEnd: string; sourceRecipe: string;
};
export type NbaClimateHead = {
  release: typeof NBA_PRIOR_FINALS_CALIBRATION_RELEASE; sourceRecipe: string; baselineRecipe: string;
  clockMode: "verified_original_publication_only"; trainingSeason: number; trainingEnd: string;
  trainingHash: string; trainingBaselineHash: string; rawFitSha256: string;
  margin: NbaClimateParameters; total: NbaClimateParameters; hash: string;
};
const MAX_GAMES = 10000, MAX_DAYS = 256;
const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const instant = (s: string) => { const n = Date.parse(s); if (!Number.isFinite(n)) throw Error("invalid_climate_clock"); return n; };
const sha = (s: string) => /^[a-f0-9]{64}$/.test(s);
export function nbaClimateDay(startAt: string): number { return Date.parse(etDate.format(new Date(instant(startAt))) + "T00:00:00Z") / 86400000; }
function validateParameters(p: NbaClimateParameters) {
  if (![p.signalVariance, p.noiseVariance, p.lengthDays].every(v => Number.isFinite(v) && v > 0)) throw Error("invalid_climate_parameters");
}
export type NbaClimateGroup = { day: number; count: number; marginMean: number; totalMean: number; marginSse: number; totalSse: number };
export function groupNbaClimateResiduals(observations: readonly NbaClimateObservation[], target: NbaClimateTarget) {
  if (observations.length > MAX_GAMES || !/^\d{10}$/.test(target.gameId) || !Number.isInteger(target.season) || !sha(target.baselineHash)) throw Error("invalid_climate_target_or_budget");
  const cutoff = instant(target.cutoff), start = instant(target.startAt);
  if (cutoff > start || instant(target.baselineTrainingEnd) >= cutoff || target.sourceRecipe !== NBA_PRIOR_FINALS_SOURCE_RECIPE) throw Error("incompatible_climate_target");
  const admitted = new Map<string, NbaClimateObservation>();
  for (const row of observations) {
    // Target and genuinely unavailable/future outcomes are not calibration
    // observations. Their values must be filtered before any aggregation.
    if (row.gameId === target.gameId || row.season !== target.season) continue;
    const rowStart = instant(row.startAt), available = instant(row.finalAvailableAt);
    if (rowStart >= start || available > cutoff) continue;
    if (!/^\d{10}$/.test(row.gameId) || available <= rowStart || !sha(row.sourceSha256) ||
        row.sourceRecipe !== target.sourceRecipe || row.baselineHash !== target.baselineHash ||
        ![row.baselineMargin, row.baselineTotal].every(Number.isFinite) || row.baselineTotal <= 0 ||
        ![row.homeScore, row.awayScore].every(v => Number.isSafeInteger(v) && v >= 0) || row.homeScore === row.awayScore) throw Error("invalid_climate_observation");
    const old = admitted.get(row.gameId);
    if (old && nbaPlayerStateHash(old) !== nbaPlayerStateHash(row)) throw Error("conflicting_climate_observation");
    admitted.set(row.gameId, row);
  }
  const byDay = new Map<number, NbaClimateGroup>();
  for (const row of [...admitted.values()].sort((a,b) => a.gameId.localeCompare(b.gameId))) {
    const day = nbaClimateDay(row.startAt), g = byDay.get(day) ?? { day, count: 0, marginMean: 0, totalMean: 0, marginSse: 0, totalSse: 0 };
    if (day > nbaClimateDay(target.startAt)) throw Error("future_climate_day");
    const margin = row.homeScore - row.awayScore - row.baselineMargin;
    const total = row.homeScore + row.awayScore - row.baselineTotal;
    g.count++;
    const dm = margin - g.marginMean, dt = total - g.totalMean;
    g.marginMean += dm / g.count; g.totalMean += dt / g.count;
    g.marginSse += dm * (margin - g.marginMean); g.totalSse += dt * (total - g.totalMean);
    byDay.set(day, g);
  }
  if (byDay.size > MAX_DAYS) throw Error("climate_day_budget");
  return { groups: [...byDay.values()].sort((a,b) => a.day - b.day), observations: admitted.size,
    sourceHash: nbaPlayerStateHash([...admitted.values()].sort((a,b) => a.gameId.localeCompare(b.gameId))) };
}
/** Exact exponential-GP posterior for a target at/after all admitted days.
 * The scalar Markov factorization avoids retaining or inverting a matrix. */
export function nbaClimatePosterior(p: NbaClimateParameters, groups: readonly NbaClimateGroup[], targetDay: number, channel: "margin" | "total") {
  validateParameters(p);
  if (!Number.isSafeInteger(targetDay) || groups.length > MAX_DAYS) throw Error("invalid_climate_posterior_budget");
  let mean = 0, variance = p.signalVariance, previous: number | null = null;
  for (const g of groups) {
    if (!Number.isSafeInteger(g.day) || !Number.isSafeInteger(g.count) || g.count <= 0 || g.day > targetDay || previous !== null && g.day <= previous ||
        !Number.isFinite(channel === "margin" ? g.marginMean : g.totalMean)) throw Error("invalid_climate_group");
    if (previous !== null) {
      const rho = Math.exp(-(g.day - previous) / p.lengthDays), rho2 = rho * rho;
      mean *= rho; variance = rho2 * variance + (1 - rho2) * p.signalVariance;
    }
    const noise = p.noiseVariance / g.count, gain = variance / (variance + noise);
    mean += gain * ((channel === "margin" ? g.marginMean : g.totalMean) - mean);
    variance *= 1 - gain; previous = g.day;
  }
  if (previous !== null) {
    const rho = Math.exp(-(targetDay - previous) / p.lengthDays), rho2 = rho * rho;
    mean *= rho; variance = rho2 * variance + (1 - rho2) * p.signalVariance;
  }
  if (![mean, variance].every(Number.isFinite) || variance < 0) throw Error("nonfinite_climate_posterior");
  return { mean, variance };
}
export function applyNbaPriorFinalsCalibration(args: { head: NbaClimateHead; target: NbaClimateTarget;
  observations: readonly NbaClimateObservation[]; independent: { margin: number; total: number } }) {
  const { hash, ...core } = args.head;
  if (hash !== nbaPlayerStateHash(core) || args.head.release !== NBA_PRIOR_FINALS_CALIBRATION_RELEASE ||
      args.head.clockMode !== "verified_original_publication_only" || args.head.baselineRecipe !== args.target.baselineRecipe ||
      args.head.sourceRecipe !== args.target.sourceRecipe || instant(args.head.trainingEnd) >= instant(args.target.cutoff) ||
      !sha(args.head.trainingHash) || !sha(args.head.trainingBaselineHash) || !sha(args.head.rawFitSha256) ||
      ![args.independent.margin, args.independent.total].every(Number.isFinite)) throw Error("incompatible_climate_application");
  const source = groupNbaClimateResiduals(args.observations, args.target), day = nbaClimateDay(args.target.startAt);
  const margin = nbaClimatePosterior(args.head.margin, source.groups, day, "margin");
  const total = nbaClimatePosterior(args.head.total, source.groups, day, "total");
  const marginHome = args.independent.margin + margin.mean, totalPoints = args.independent.total + total.mean;
  const homeScore = (totalPoints + marginHome) / 2, awayScore = (totalPoints - marginHome) / 2;
  if (![marginHome, totalPoints, homeScore, awayScore].every(Number.isFinite) || homeScore < 0 || awayScore < 0) throw Error("invalid_climate_score");
  return { release: args.head.release, status: source.observations ? "posterior" as const : "no_eligible_prior" as const,
    marginHome, total: totalPoints, homeScore, awayScore, marginCorrection: margin.mean, totalCorrection: total.mean,
    marginStateVariance: margin.variance, totalStateVariance: total.variance,
    observationsUsed: source.observations, daysUsed: source.groups.length, sourceHash: source.sourceHash, headHash: hash };
}
