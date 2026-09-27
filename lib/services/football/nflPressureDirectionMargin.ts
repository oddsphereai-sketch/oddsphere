import artifactJson from "./modelArtifacts/nflPressureDirectionRuntime.json";
import type { NflPlayerPropsCurrentSeasonState } from "./nflPlayerPropsCurrentSeasonState";

export const NFL_PRESSURE_DIRECTION_MARGIN_RELEASE =
  "nfl_pressure_direction_margin_2026_09_27_r1" as const;

type Metric = "sack_rate" | "turnover_rate";
type Metrics = Record<Metric, number>;
type Bucket = "offFast" | "offSlow" | "defFast" | "defSlow";
type TeamState = Record<Bucket, Metrics>;
type Artifact = {
  artifactRelease: "nfl_pressure_direction_runtime_artifact_2026_09_27_r1";
  modelRelease: typeof NFL_PRESSURE_DIRECTION_MARGIN_RELEASE;
  trainedThrough: 2025;
  recipe: {
    regularizationC: 0.03;
    halfLifeWeeks: 128;
    correctionScale: 0.5;
    correctionCap: 3;
    residualSd: number;
    offseasonCarry: 0.65;
    fastAlpha: 0.35;
    slowAlpha: 0.16;
    priors: Metrics;
  };
  features: string[];
  imputer: { statistics: number[]; indicatorFeatures: number[] };
  scaler: { mean: number[]; scale: number[] };
  logistic: { coefficients: number[]; intercept: number };
  teams: Record<string, TeamState>;
};

const artifact = artifactJson as Artifact;
const METRICS: Metric[] = ["sack_rate", "turnover_rate"];

export type NflPressureDirectionMargin = {
  release: typeof NFL_PRESSURE_DIRECTION_MARGIN_RELEASE;
  homeCoverProbability: number;
  homeMarginCorrection: number;
};

export function buildNflPressureDirectionMargin(args: {
  currentSeasonState: NflPlayerPropsCurrentSeasonState;
  homeTeam: string;
  awayTeam: string;
}): NflPressureDirectionMargin {
  validateArtifact();
  if (args.currentSeasonState.season !== 2026) throw new Error("NFL pressure direction requires the 2026 state.");
  const states = offseasonStates();
  for (let week = 1; week <= args.currentSeasonState.completeThroughWeek; week += 1) {
    applyWeek(states, args.currentSeasonState.teamStats.filter((row) => row.week === week));
  }
  const home = normalizeTeam(args.homeTeam);
  const away = normalizeTeam(args.awayTeam);
  if (!states[home] || !states[away]) throw new Error(`NFL pressure direction state is missing ${away}@${home}.`);
  const values = matchupFeatures(states[home], states[away]);
  const raw = artifact.features.map((feature, index) => {
    const value = values[feature];
    return Number.isFinite(value) ? value! : artifact.imputer.statistics[index]!;
  });
  const imputed = [
    ...raw,
    ...artifact.imputer.indicatorFeatures.map((index) => Number(!Number.isFinite(values[artifact.features[index]!]))),
  ];
  const standardized = imputed.map((value, index) =>
    (value - artifact.scaler.mean[index]!) / artifact.scaler.scale[index]!);
  const logit = artifact.logistic.intercept + standardized.reduce(
    (sum, value, index) => sum + value * artifact.logistic.coefficients[index]!, 0,
  );
  const homeCoverProbability = 1 / (1 + Math.exp(-logit));
  const homeMarginCorrection = clamp(
    artifact.recipe.correctionScale * artifact.recipe.residualSd * inverseStandardNormal(homeCoverProbability),
    -artifact.recipe.correctionCap,
    artifact.recipe.correctionCap,
  );
  return { release: NFL_PRESSURE_DIRECTION_MARGIN_RELEASE, homeCoverProbability, homeMarginCorrection };
}

function offseasonStates(): Record<string, TeamState> {
  return Object.fromEntries(Object.entries(artifact.teams).map(([team, state]) => [team, Object.fromEntries(
    (["offFast", "offSlow", "defFast", "defSlow"] as Bucket[]).map((bucket) => [bucket, Object.fromEntries(
      METRICS.map((metric) => [
        metric,
        artifact.recipe.priors[metric]
          + artifact.recipe.offseasonCarry * (state[bucket][metric] - artifact.recipe.priors[metric]),
      ]),
    ) as Metrics]),
  ) as TeamState]));
}

function applyWeek(states: Record<string, TeamState>, rows: NflPlayerPropsCurrentSeasonState["teamStats"]): void {
  if (rows.length === 0) return;
  const observations = new Map(rows.map((row) => [normalizeTeam(row.team), {
    opponent: normalizeTeam(row.opponent),
    values: {
      sack_rate: row.sacksAllowed / Math.max(1, row.passingAttempts + row.sacksAllowed),
      turnover_rate: row.turnovers / Math.max(1, row.totalOffensivePlays),
    } satisfies Metrics,
  }]));
  if (observations.size !== rows.length) throw new Error("NFL pressure direction has duplicate weekly team stats.");
  for (const [team, observation] of observations) {
    const state = states[team];
    const opponent = observations.get(observation.opponent);
    if (!state || !opponent || opponent.opponent !== team) {
      throw new Error(`NFL pressure direction has incomplete opponent state for ${team}.`);
    }
    for (const metric of METRICS) {
      state.offFast[metric] = ewm(state.offFast[metric], observation.values[metric], artifact.recipe.fastAlpha);
      state.offSlow[metric] = ewm(state.offSlow[metric], observation.values[metric], artifact.recipe.slowAlpha);
      state.defFast[metric] = ewm(state.defFast[metric], opponent.values[metric], artifact.recipe.fastAlpha);
      state.defSlow[metric] = ewm(state.defSlow[metric], opponent.values[metric], artifact.recipe.slowAlpha);
    }
  }
}

function matchupFeatures(home: TeamState, away: TeamState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [speed, suffix] of [["fast", "Fast"], ["slow", "Slow"]] as const) {
    for (const metric of METRICS) {
      result[`home_matchup_${speed}_${metric}`] =
        home[`off${suffix}`][metric] - (away[`def${suffix}`][metric] - artifact.recipe.priors[metric]);
      result[`away_matchup_${speed}_${metric}`] =
        away[`off${suffix}`][metric] - (home[`def${suffix}`][metric] - artifact.recipe.priors[metric]);
    }
  }
  return result;
}

function inverseStandardNormal(probability: number): number {
  // Peter J. Acklam's rational approximation; absolute error is below 1.2e-9 in this runtime range.
  const p = clamp(probability, 0.01, 0.99);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function ewm(previous: number, observed: number, alpha: number): number {
  return alpha * observed + (1 - alpha) * previous;
}

function normalizeTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return team === "LAR" ? "LA" : team === "WSH" ? "WAS" : team;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateArtifact(): void {
  const dimensions = artifact.features.length + artifact.imputer.indicatorFeatures.length;
  if (artifact.artifactRelease !== "nfl_pressure_direction_runtime_artifact_2026_09_27_r1" ||
      artifact.modelRelease !== NFL_PRESSURE_DIRECTION_MARGIN_RELEASE || artifact.trainedThrough !== 2025 ||
      artifact.features.length !== 8 || Object.keys(artifact.teams).length !== 32 ||
      artifact.imputer.statistics.length !== artifact.features.length ||
      artifact.scaler.mean.length !== dimensions || artifact.scaler.scale.length !== dimensions ||
      artifact.logistic.coefficients.length !== dimensions) {
    throw new Error("NFL pressure direction runtime artifact is invalid.");
  }
}
