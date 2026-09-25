import artifactJson from "./modelArtifacts/nflSlowStateRuntime.json";
import type { NflPlayerPropsCurrentSeasonState } from "./nflPlayerPropsCurrentSeasonState";

export const NFL_WEEKLY_POSSESSION_MARGIN_RELEASE =
  "nfl_weekly_possession_margin_2026_09_25_r2_production" as const;

type Metric = "points" | "plays" | "sack_rate" | "turnover_rate" | "redzone_td_rate";
type Metrics = Record<Metric, number>;
type TeamState = { offSlow: Metrics; defSlow: Metrics };
type Artifact = {
  release: "nfl_slow_state_runtime_artifact_2026_09_25_r1";
  offseasonCarry: number;
  slowAlpha: number;
  priors: Metrics;
  teams: Record<string, TeamState>;
};

const artifact = artifactJson as Artifact;
const METRICS: Metric[] = ["points", "plays", "sack_rate", "turnover_rate", "redzone_td_rate"];

export type NflWeeklyPossessionMargin = {
  release: typeof NFL_WEEKLY_POSSESSION_MARGIN_RELEASE;
  independentHomeScore: number;
  independentAwayScore: number;
  independentHomeMargin: number;
  calibratedHomeMargin: number;
  completeThroughWeek: number;
};

export function buildNflWeeklyPossessionMargin(args: {
  currentSeasonState: NflPlayerPropsCurrentSeasonState;
  homeTeam: string;
  awayTeam: string;
  marketHomeMargin: number;
}): NflWeeklyPossessionMargin {
  validateArtifact();
  if (args.currentSeasonState.season !== 2026) throw new Error("NFL possession margin requires the 2026 current-season state.");
  if (!Number.isFinite(args.marketHomeMargin)) throw new Error("NFL possession margin market line is invalid.");
  const states = offseasonStates();
  for (let week = 1; week <= args.currentSeasonState.completeThroughWeek; week += 1) {
    applyWeek(states, args.currentSeasonState.teamStats.filter((row) => row.week === week));
  }
  const home = normalizeTeam(args.homeTeam);
  const away = normalizeTeam(args.awayTeam);
  const homeState = states[home];
  const awayState = states[away];
  if (!homeState || !awayState) throw new Error(`NFL possession margin state is missing ${away}@${home}.`);
  const independentHomeScore = expectedScore(homeState.offSlow, awayState.defSlow, true);
  const independentAwayScore = expectedScore(awayState.offSlow, homeState.defSlow, false);
  const independentHomeMargin = independentHomeScore - independentAwayScore;
  return {
    release: NFL_WEEKLY_POSSESSION_MARGIN_RELEASE,
    independentHomeScore,
    independentAwayScore,
    independentHomeMargin,
    calibratedHomeMargin: 0.1 * independentHomeMargin + 0.9 * args.marketHomeMargin,
    completeThroughWeek: args.currentSeasonState.completeThroughWeek,
  };
}

function offseasonStates(): Record<string, TeamState> {
  return Object.fromEntries(Object.entries(artifact.teams).map(([team, state]) => [team, {
    offSlow: regress(state.offSlow),
    defSlow: regress(state.defSlow),
  }]));
}

function regress(values: Metrics): Metrics {
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    artifact.priors[metric] + artifact.offseasonCarry * (values[metric] - artifact.priors[metric]),
  ])) as Metrics;
}

function applyWeek(states: Record<string, TeamState>, rows: NflPlayerPropsCurrentSeasonState["teamStats"]): void {
  if (rows.length === 0) return;
  const observations = new Map(rows.map((row) => [normalizeTeam(row.team), {
    opponent: normalizeTeam(row.opponent),
    values: {
      points: row.pointsFor,
      plays: row.totalOffensivePlays,
      sack_rate: row.sacksAllowed / Math.max(1, row.passingAttempts + row.sacksAllowed),
      turnover_rate: row.turnovers / Math.max(1, row.totalOffensivePlays),
      redzone_td_rate: row.redZoneAttempts > 0 ? row.redZoneScores / row.redZoneAttempts : artifact.priors.redzone_td_rate,
    } satisfies Metrics,
  }]));
  if (observations.size !== rows.length) throw new Error("NFL possession margin has duplicate weekly team stats.");
  for (const [team, observation] of observations) {
    const state = states[team];
    const opponentState = states[observation.opponent];
    const opponent = observations.get(observation.opponent);
    if (!state || !opponentState || !opponent || opponent.opponent !== team) {
      throw new Error(`NFL possession margin has incomplete opponent state for ${team}.`);
    }
    for (const metric of METRICS) {
      state.offSlow[metric] = ewm(state.offSlow[metric], observation.values[metric]);
      state.defSlow[metric] = ewm(state.defSlow[metric], opponent.values[metric]);
    }
  }
}

function expectedScore(offense: Metrics, opposingDefense: Metrics, home: boolean): number {
  const offenseWeight = 0.75;
  const rawPlays = offenseWeight * offense.plays + (1 - offenseWeight) * opposingDefense.plays;
  const offensePointsPerPlay = offense.points / Math.max(40, offense.plays);
  const defensePointsPerPlay = opposingDefense.points / Math.max(40, opposingDefense.plays);
  const rawPointsPerPlay = offenseWeight * offensePointsPerPlay + (1 - offenseWeight) * defensePointsPerPlay;
  const priorPointsPerPlay = artifact.priors.points / artifact.priors.plays;
  const expectedPointsPerPlay = priorPointsPerPlay + 0.5 * (rawPointsPerPlay - priorPointsPerPlay);
  const redzone = offenseWeight * offense.redzone_td_rate + (1 - offenseWeight) * opposingDefense.redzone_td_rate;
  const turnovers = offenseWeight * offense.turnover_rate + (1 - offenseWeight) * opposingDefense.turnover_rate;
  const sacks = offenseWeight * offense.sack_rate + (1 - offenseWeight) * opposingDefense.sack_rate;
  const contextPoints = clamp(
    3 * (redzone - artifact.priors.redzone_td_rate) -
      30 * (turnovers - artifact.priors.turnover_rate) -
      10 * (sacks - artifact.priors.sack_rate),
    -3,
    3,
  );
  return clamp(rawPlays * expectedPointsPerPlay + contextPoints + (home ? 1 : -1), 8, 42);
}

function ewm(previous: number, observed: number): number {
  return artifact.slowAlpha * observed + (1 - artifact.slowAlpha) * previous;
}

function normalizeTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return team === "LAR" ? "LA" : team === "WSH" ? "WAS" : team;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateArtifact(): void {
  if (artifact.release !== "nfl_slow_state_runtime_artifact_2026_09_25_r1" ||
      Object.keys(artifact.teams).length !== 32 || artifact.offseasonCarry !== 0.65 || artifact.slowAlpha !== 0.16) {
    throw new Error("NFL possession margin runtime artifact is invalid.");
  }
}
