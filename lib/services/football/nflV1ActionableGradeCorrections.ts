import artifactJson from "./modelArtifacts/nflV1ActionableGradeCorrections.json";

export const NFL_V1_ACTIONABLE_GRADE_ARTIFACT_RELEASE =
  "nfl_v1_actionable_grade_corrections_2026_08_25_r1" as const;
export const NFL_V1_SPREAD_HEAD_RELEASE =
  "nfl_v1_spread_full_state_residual_extra_trees_2026_08_25_r1" as const;
export const NFL_V1_TOTAL_HEAD_RELEASE =
  "nfl_v1_total_score_component_ensemble_2026_08_25_r1" as const;

export type NflV1ActionableGradeCorrection = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  referenceConsensusHomeMargin: number;
  referenceConsensusTotal: number;
  r10HomeCoverProbability: number;
  spreadHeadHomeCoverProbability: number;
  spreadHomeLogitCorrection: number;
  spreadPushProbability: number;
  r10OverProbability: number;
  totalHeadOverProbability: number;
  totalOverLogitCorrection: number;
  totalPushProbability: number;
  predictedTotalResidual: number;
};

type Artifact = {
  artifactRelease: string;
  spreadHeadRelease: string;
  totalHeadRelease: string;
  tournamentRelease: string;
  generatedAt: string;
  source: Record<string, string>;
  games: NflV1ActionableGradeCorrection[];
};

const artifact = artifactJson as Artifact;
validateArtifact(artifact);
const corrections = new Map(
  artifact.games.map((game) => [game.providerGameId, Object.freeze({ ...game })] as const),
);

export function getNflV1ActionableGradeCorrection(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
}): NflV1ActionableGradeCorrection {
  const correction = corrections.get(args.providerGameId);
  if (!correction) throw new Error(`NFL v1 grade correction is missing game ${args.providerGameId}.`);
  if (correction.awayTeam !== normalizeTeam(args.awayTeam) || correction.homeTeam !== normalizeTeam(args.homeTeam)) {
    throw new Error(
      `NFL v1 grade correction identity mismatch for ${args.providerGameId}: ` +
      `${correction.awayTeam}@${correction.homeTeam} versus ${args.awayTeam}@${args.homeTeam}.`,
    );
  }
  return correction;
}

export function hasNflV1ActionableGradeCorrection(providerGameId: string): boolean {
  return corrections.has(providerGameId);
}

export function nflV1ActionableGradeArtifactMetadata() {
  return {
    artifactRelease: artifact.artifactRelease,
    spreadHeadRelease: artifact.spreadHeadRelease,
    totalHeadRelease: artifact.totalHeadRelease,
    tournamentRelease: artifact.tournamentRelease,
    generatedAt: artifact.generatedAt,
    source: { ...artifact.source },
    games: artifact.games.length,
  };
}

export function applyNflV1LogitCorrection(probability: number, correction: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1 || !Number.isFinite(correction)) {
    throw new Error("NFL v1 logit correction requires a finite open-interval probability and correction.");
  }
  const logit = Math.log(probability / (1 - probability)) + correction;
  return Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-logit))));
}

function validateArtifact(value: Artifact): void {
  if (value.artifactRelease !== NFL_V1_ACTIONABLE_GRADE_ARTIFACT_RELEASE ||
      value.spreadHeadRelease !== NFL_V1_SPREAD_HEAD_RELEASE ||
      value.totalHeadRelease !== NFL_V1_TOTAL_HEAD_RELEASE) {
    throw new Error("NFL v1 actionable grade artifact release mismatch.");
  }
  if (value.games.length !== 16 || new Set(value.games.map((game) => game.providerGameId)).size !== 16) {
    throw new Error(`NFL v1 actionable grade artifact must contain 16 unique games; found ${value.games.length}.`);
  }
  for (const game of value.games) {
    const values = [
      game.referenceConsensusHomeMargin,
      game.referenceConsensusTotal,
      game.r10HomeCoverProbability,
      game.spreadHeadHomeCoverProbability,
      game.spreadHomeLogitCorrection,
      game.spreadPushProbability,
      game.r10OverProbability,
      game.totalHeadOverProbability,
      game.totalOverLogitCorrection,
      game.totalPushProbability,
      game.predictedTotalResidual,
    ];
    if (values.some((entry) => !Number.isFinite(entry)) ||
        [game.r10HomeCoverProbability, game.spreadHeadHomeCoverProbability,
          game.r10OverProbability, game.totalHeadOverProbability].some(
          (entry) => entry <= 0 || entry >= 1,
        ) ||
        game.referenceConsensusTotal <= 0 ||
        game.spreadPushProbability < 0 || game.spreadPushProbability >= 1 ||
        game.totalPushProbability < 0 || game.totalPushProbability >= 1 ||
        Math.abs(
          applyNflV1LogitCorrection(game.r10HomeCoverProbability, game.spreadHomeLogitCorrection) -
          game.spreadHeadHomeCoverProbability,
        ) > 0.000002 ||
        Math.abs(
          applyNflV1LogitCorrection(game.r10OverProbability, game.totalOverLogitCorrection) -
          game.totalHeadOverProbability,
        ) > 0.000002) {
      throw new Error(`NFL v1 actionable grade artifact contains an invalid correction for ${game.providerGameId}.`);
    }
  }
}

function normalizeTeam(team: string): string {
  const value = team.toUpperCase();
  return value === "WAS" ? "WSH" : value;
}
