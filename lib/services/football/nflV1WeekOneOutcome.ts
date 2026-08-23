import artifactJson from "./modelArtifacts/nflV1WeekOneOutcome.json";

export const NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE =
  "nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint" as const;
export const NFL_V1_OUTCOME_MODEL_RELEASE =
  "nfl_v1_discrete_drive_outcome_2026_08_23_r2" as const;
export const NFL_V1_OUTCOME_DISTRIBUTION_RELEASE =
  "nfl_discrete_drive_score_distribution_2026_08_23_r5" as const;
export const NFL_V1_OUTCOME_PROBABILITY_RELEASE =
  "nfl_v1_discrete_joint_probability_2026_08_23_r2" as const;
export const NFL_V1_REPRESENTATIVE_SCORE_POLICY_RELEASE =
  "nfl_v1_representative_score_2026_08_23_r2" as const;

type DiscreteDistribution = {
  values: number[];
  probabilities: number[];
};

export type NflV1WeekOneOutcomeForecast = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  expectedAwayScore: number;
  expectedHomeScore: number;
  representativeAwayScore: number;
  representativeHomeScore: number;
  representativeScoreProbability: number;
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  marginDistribution: DiscreteDistribution;
  totalDistribution: DiscreteDistribution;
  sourceExpectedAwayScore: number;
  sourceExpectedHomeScore: number;
};

type Artifact = {
  artifactRelease: string;
  modelRelease: string;
  distributionRelease: string;
  probabilityRelease: string;
  representativeScorePolicyRelease: string;
  tournamentRelease: string;
  source: {
    featureRelease: string;
    featureSha256: string;
    forwardEvidenceRelease: string;
    forwardEvidenceSha256: string;
    pbpManifestSha256: string;
    r10ReportSha256: string;
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
    representativeScorePolicyRelease: artifact.representativeScorePolicyRelease,
    tournamentRelease: artifact.tournamentRelease,
    source: { ...artifact.source },
    games: artifact.games.length,
  };
}

export function nflV1WeekOneLineProbabilities(args: {
  forecast: NflV1WeekOneOutcomeForecast;
  homeSpread: number;
  totalLine: number;
}) {
  const spread = splitDistribution(args.forecast.marginDistribution, (margin) => margin + args.homeSpread);
  const total = splitDistribution(args.forecast.totalDistribution, (points) => points - args.totalLine);
  return {
    spread: {
      homeCoverProbability: spread.positive / Math.max(spread.positive + spread.negative, 1e-12),
      awayCoverProbability: spread.negative / Math.max(spread.positive + spread.negative, 1e-12),
      pushProbability: spread.push,
    },
    total: {
      overProbability: total.positive / Math.max(total.positive + total.negative, 1e-12),
      underProbability: total.negative / Math.max(total.positive + total.negative, 1e-12),
      pushProbability: total.push,
    },
  };
}

function validateArtifact(value: Artifact): void {
  if (value.artifactRelease !== NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE) {
    throw new Error(`NFL v1 outcome artifact release mismatch: ${value.artifactRelease}.`);
  }
  if (value.modelRelease !== NFL_V1_OUTCOME_MODEL_RELEASE ||
      value.distributionRelease !== NFL_V1_OUTCOME_DISTRIBUTION_RELEASE ||
      value.probabilityRelease !== NFL_V1_OUTCOME_PROBABILITY_RELEASE ||
      value.representativeScorePolicyRelease !== NFL_V1_REPRESENTATIVE_SCORE_POLICY_RELEASE) {
    throw new Error("NFL v1 outcome artifact model release mismatch.");
  }
  if (value.games.length !== 16 || new Set(value.games.map((game) => game.providerGameId)).size !== 16) {
    throw new Error(`NFL v1 Week 1 artifact must contain 16 unique games; found ${value.games.length}.`);
  }
  for (const game of value.games) {
    const numbers = [
      game.expectedAwayScore,
      game.expectedHomeScore,
      game.representativeAwayScore,
      game.representativeHomeScore,
      game.representativeScoreProbability,
      game.awayWinProbability,
      game.homeWinProbability,
      game.tieProbability,
      game.sourceExpectedAwayScore,
      game.sourceExpectedHomeScore,
    ];
    if (numbers.some((number) => !Number.isFinite(number))) {
      throw new Error(`NFL v1 outcome artifact contains a non-finite value for ${game.providerGameId}.`);
    }
    if (game.expectedAwayScore < 0 || game.expectedHomeScore < 0 ||
        !Number.isInteger(game.representativeAwayScore) || !Number.isInteger(game.representativeHomeScore) ||
        game.representativeAwayScore < 0 || game.representativeHomeScore < 0 ||
        game.representativeAwayScore === game.representativeHomeScore ||
        game.representativeScoreProbability <= 0 || game.representativeScoreProbability >= 1 ||
        game.awayWinProbability <= 0 || game.awayWinProbability >= 1 ||
        game.homeWinProbability <= 0 || game.homeWinProbability >= 1 ||
        game.tieProbability < 0 || game.tieProbability >= 1 ||
        Math.abs(game.awayWinProbability + game.homeWinProbability - 1) > 0.000002 ||
        (game.homeWinProbability > game.awayWinProbability) !== (game.representativeHomeScore > game.representativeAwayScore)) {
      throw new Error(`NFL v1 outcome artifact contains an invalid forecast for ${game.providerGameId}.`);
    }
    validateDistribution(game.marginDistribution, `${game.providerGameId} margin`);
    validateDistribution(game.totalDistribution, `${game.providerGameId} total`);
  }
}

function validateDistribution(value: DiscreteDistribution, label: string): void {
  if (value.values.length === 0 || value.values.length !== value.probabilities.length) {
    throw new Error(`NFL v1 ${label} distribution is incomplete.`);
  }
  if (value.values.some((entry, index) => !Number.isInteger(entry) || (index > 0 && entry <= value.values[index - 1]!)) ||
      value.probabilities.some((entry) => !Number.isFinite(entry) || entry < 0) ||
      Math.abs(value.probabilities.reduce((sum, entry) => sum + entry, 0) - 1) > 0.000002) {
    throw new Error(`NFL v1 ${label} distribution is invalid.`);
  }
}

function splitDistribution(
  distribution: DiscreteDistribution,
  difference: (value: number) => number,
): { positive: number; push: number; negative: number } {
  let positive = 0;
  let push = 0;
  let negative = 0;
  distribution.values.forEach((value, index) => {
    const probability = distribution.probabilities[index]!;
    const result = difference(value);
    if (result > 0) positive += probability;
    else if (result < 0) negative += probability;
    else push += probability;
  });
  return { positive, push, negative };
}

function normalizeTeam(team: string): string {
  const value = team.toUpperCase();
  return value === "WAS" ? "WSH" : value;
}
