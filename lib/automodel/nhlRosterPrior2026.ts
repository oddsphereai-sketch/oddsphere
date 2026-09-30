import artifactJson from "../../nhl-research/nhl_roster_player_priors_2026_09_30_r1.json";

export const NHL_ROSTER_PRIOR_RELEASE = "nhl_roster_player_priors_2026_09_30_r1" as const;

export type NhlRosterPlayer = {
  fullName: string;
  positionCode: string;
};

export type NhlRosterPrior = {
  gameScore: number;
  ixg: number;
  points: number;
  onIceXgDiff: number;
  knownSkaters: number;
  totalSkaters: number;
  coverage: number;
  release: typeof NHL_ROSTER_PRIOR_RELEASE;
};

type PlayerPrior = {
  icePerGame: number;
  gameScore: number;
  ixg: number;
  points: number;
  onIceXgDiff: number;
};

const artifact = artifactJson as {
  release: string;
  neutral: { gameScore: number; ixg: number; points: number; onIceXgDiff: number };
  players: Record<string, PlayerPrior>;
};

if (artifact.release !== NHL_ROSTER_PRIOR_RELEASE) {
  throw new Error(`NHL roster prior release mismatch: ${artifact.release}`);
}

export function normalizeNhlPlayerName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

const playerPriorsByNormalizedName = new Map<string, PlayerPrior>(
  Object.entries(artifact.players).map(([name, prior]) => [normalizeNhlPlayerName(name), prior]),
);

export function aggregateNhlRosterPrior(players: readonly NhlRosterPlayer[]): NhlRosterPrior | null {
  const skaters = players.filter((player) => player.positionCode.trim().toUpperCase() !== "G");
  if (skaters.length < 8) return null;
  let totalWeight = 0;
  let knownSkaters = 0;
  const sums = { gameScore: 0, ixg: 0, points: 0, onIceXgDiff: 0 };
  for (const skater of skaters) {
    const prior = playerPriorsByNormalizedName.get(normalizeNhlPlayerName(skater.fullName));
    const weight = prior ? Math.max(6, Math.min(24, prior.icePerGame)) : 12;
    const values = prior ?? artifact.neutral;
    totalWeight += weight;
    if (prior) knownSkaters += 1;
    sums.gameScore += values.gameScore * weight;
    sums.ixg += values.ixg * weight;
    sums.points += values.points * weight;
    sums.onIceXgDiff += values.onIceXgDiff * weight;
  }
  if (totalWeight <= 0) return null;
  return {
    gameScore: sums.gameScore / totalWeight,
    ixg: sums.ixg / totalWeight,
    points: sums.points / totalWeight,
    onIceXgDiff: sums.onIceXgDiff / totalWeight,
    knownSkaters,
    totalSkaters: skaters.length,
    coverage: knownSkaters / skaters.length,
    release: NHL_ROSTER_PRIOR_RELEASE,
  };
}
