import artifactJson from "./modelArtifacts/nflV1WeekOneOutcome.json";

export const NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE =
  "nfl_v1_week_one_outcome_artifact_2026_08_23_r1" as const;
export const NFL_V1_OUTCOME_MODEL_RELEASE =
  "nfl_v1_comprehensive_outcome_2026_08_23_r1" as const;
export const NFL_V1_OUTCOME_DISTRIBUTION_RELEASE =
  "nfl_v1_bivariate_score_distribution_2026_08_23_r1" as const;
export const NFL_V1_OUTCOME_PROBABILITY_RELEASE =
  "nfl_v1_beta_calibrated_win_ensemble_2026_08_23_r1" as const;

export type NflV1WeekOneOutcomeForecast = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  projectedAwayScore: number;
  projectedHomeScore: number;
  awayWinProbability: number;
  homeWinProbability: number;
};

type Artifact = {
  artifactRelease: string;
  modelRelease: string;
  distributionRelease: string;
  probabilityRelease: string;
  tournamentRelease: string;
  source: {
    featureRelease: string;
    featureSha256: string;
    forwardEvidenceRelease: string;
    forwardEvidenceSha256: string;
  };
  games: NflV1WeekOneOutcomeForecast[];
};

const artifact = artifactJson as Artifact;
validateArtifact(artifact);
const forecasts = new Map(
  artifact.games.map((game) => [game.providerGameId, Object.freeze({ ...game })] as const),
);

export function getNflV1WeekOneOutcomeForecast(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
}): NflV1WeekOneOutcomeForecast {
  const forecast = forecasts.get(args.providerGameId);
  if (!forecast) throw new Error(`NFL v1 outcome forecast is missing game ${args.providerGameId}.`);
  if (forecast.awayTeam !== normalizeTeam(args.awayTeam) || forecast.homeTeam !== normalizeTeam(args.homeTeam)) {
    throw new Error(
      `NFL v1 outcome identity mismatch for ${args.providerGameId}: ` +
      `${forecast.awayTeam}@${forecast.homeTeam} versus ${args.awayTeam}@${args.homeTeam}.`,
    );
  }
  return forecast;
}

export function nflV1WeekOneOutcomeArtifactMetadata() {
  return {
    artifactRelease: artifact.artifactRelease,
    modelRelease: artifact.modelRelease,
    distributionRelease: artifact.distributionRelease,
    probabilityRelease: artifact.probabilityRelease,
    tournamentRelease: artifact.tournamentRelease,
    source: { ...artifact.source },
    games: artifact.games.length,
  };
}

function validateArtifact(value: Artifact): void {
  if (value.artifactRelease !== NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE) {
    throw new Error(`NFL v1 outcome artifact release mismatch: ${value.artifactRelease}.`);
  }
  if (value.modelRelease !== NFL_V1_OUTCOME_MODEL_RELEASE ||
      value.distributionRelease !== NFL_V1_OUTCOME_DISTRIBUTION_RELEASE ||
      value.probabilityRelease !== NFL_V1_OUTCOME_PROBABILITY_RELEASE) {
    throw new Error("NFL v1 outcome artifact model release mismatch.");
  }
  if (value.games.length !== 16 || new Set(value.games.map((game) => game.providerGameId)).size !== 16) {
    throw new Error(`NFL v1 Week 1 artifact must contain 16 unique games; found ${value.games.length}.`);
  }
  for (const game of value.games) {
    const numbers = [
      game.projectedAwayScore,
      game.projectedHomeScore,
      game.awayWinProbability,
      game.homeWinProbability,
    ];
    if (numbers.some((number) => !Number.isFinite(number))) {
      throw new Error(`NFL v1 outcome artifact contains a non-finite value for ${game.providerGameId}.`);
    }
    if (game.projectedAwayScore < 0 || game.projectedHomeScore < 0 ||
        game.awayWinProbability <= 0 || game.awayWinProbability >= 1 ||
        game.homeWinProbability <= 0 || game.homeWinProbability >= 1 ||
        Math.abs(game.awayWinProbability + game.homeWinProbability - 1) > 0.000002) {
      throw new Error(`NFL v1 outcome artifact contains an invalid forecast for ${game.providerGameId}.`);
    }
  }
}

function normalizeTeam(team: string): string {
  const value = team.toUpperCase();
  return value === "WAS" ? "WSH" : value;
}
