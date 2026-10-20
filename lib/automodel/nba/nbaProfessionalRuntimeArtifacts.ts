import type { NbaPortableFeatureRow, NbaPortableModelArtifact } from "./nbaPortableScoreModel";
import {
  buildNbaPointInTimeFeatures,
  NBA_POINT_IN_TIME_FEATURE_RELEASE,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerBox,
  type NbaPointInTimeFeatureRow,
  type NbaUpcomingGame,
} from "../../services/nba/nbaPointInTimeFeatures";

export const NBA_PROFESSIONAL_BOOTSTRAP_RELEASE =
  "nba_professional_bootstrap_2026_10_15_r1_selected_feature_parity" as const;

type NbaProfessionalBootstrap = {
  release: typeof NBA_PROFESSIONAL_BOOTSTRAP_RELEASE;
  sourceRelease: string;
  seasons: number[];
  games: NbaHistoricalGame[];
  boxes: NbaHistoricalPlayerBox[];
  sourceSha256: Record<string, { games: string; box: string }>;
};

// Static CommonJS loads keep generated model data out of TypeScript's literal
// type graph while preserving fixed bundler-visible paths and explicit runtime
// contracts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bootstrap = require("./modelArtifacts/nbaProfessionalBootstrap.json") as NbaProfessionalBootstrap;
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const NBA_PROFESSIONAL_MODEL_ARTIFACT = require("./modelArtifacts/nbaProfessionalR15.json") as NbaPortableModelArtifact;

export const NBA_PROFESSIONAL_TRAINING_HOME_ADVANTAGE = bootstrap.games.reduce(
  (sum, game) => sum + game.homeScore - game.awayScore,
  0,
) / bootstrap.games.length;

function assertArtifacts(): void {
  if (bootstrap.release !== NBA_PROFESSIONAL_BOOTSTRAP_RELEASE) {
    throw new Error("NBA professional bootstrap release mismatch.");
  }
  if (NBA_PROFESSIONAL_MODEL_ARTIFACT.featureRelease !== NBA_POINT_IN_TIME_FEATURE_RELEASE) {
    throw new Error("NBA professional model and point-in-time feature releases differ.");
  }
  if (bootstrap.games.length === 0 || bootstrap.boxes.length !== bootstrap.games.length * 2) {
    throw new Error("NBA professional bootstrap is incomplete.");
  }
}

assertArtifacts();

const providerTeamIdByAbbreviation = new Map<string, number>();
for (const game of bootstrap.games) {
  providerTeamIdByAbbreviation.set(game.homeTeam, game.homeTeamId);
  providerTeamIdByAbbreviation.set(game.awayTeam, game.awayTeamId);
}

const ESPN_TO_BALLDONTLIE_ABBREVIATION: Readonly<Record<string, string>> = {
  GS: "GSW",
  NO: "NOP",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

export type NbaProfessionalUpcomingGame = {
  gameId: number;
  season: number;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
};

function normalizeUpcoming(game: NbaProfessionalUpcomingGame): NbaUpcomingGame {
  const rawHome = game.homeTeam.trim().toUpperCase();
  const rawAway = game.awayTeam.trim().toUpperCase();
  const homeTeam = ESPN_TO_BALLDONTLIE_ABBREVIATION[rawHome] ?? rawHome;
  const awayTeam = ESPN_TO_BALLDONTLIE_ABBREVIATION[rawAway] ?? rawAway;
  const homeTeamId = providerTeamIdByAbbreviation.get(homeTeam);
  const awayTeamId = providerTeamIdByAbbreviation.get(awayTeam);
  if (homeTeamId === undefined || awayTeamId === undefined) {
    throw new Error(`NBA professional runtime has an unknown team identity: ${awayTeam}@${homeTeam}.`);
  }
  if (!Number.isFinite(Date.parse(game.startTime))) {
    throw new Error(`NBA professional runtime game ${game.gameId} has an invalid start time.`);
  }
  return {
    gameId: game.gameId,
    season: game.season,
    startTime: new Date(game.startTime).toISOString(),
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
  };
}

/**
 * Replay the immutable compact bootstrap plus append-only current-season
 * finals, emitting only the requested future games. No future result can enter
 * its own row because the underlying builder delays outcomes by five hours.
 */
export function buildNbaProfessionalRuntimeFeatures(args: {
  upcomingGames: readonly NbaProfessionalUpcomingGame[];
  currentGames?: readonly NbaHistoricalGame[];
  currentBoxes?: readonly NbaHistoricalPlayerBox[];
}): Map<number, NbaPointInTimeFeatureRow> {
  const upcomingGames = args.upcomingGames.map(normalizeUpcoming);
  const emitGameIds = new Set(upcomingGames.map((game) => game.gameId));
  if (emitGameIds.size !== upcomingGames.length) {
    throw new Error("NBA professional runtime received duplicate upcoming game ids.");
  }
  const bootstrapIds = new Set(bootstrap.games.map((game) => game.gameId));
  const currentGames = [...(args.currentGames ?? [])];
  if (currentGames.some((game) => bootstrapIds.has(game.gameId))) {
    throw new Error("NBA professional current-season state overlaps the immutable bootstrap.");
  }
  const featureRows = buildNbaPointInTimeFeatures({
    games: [...bootstrap.games, ...currentGames],
    upcomingGames,
    boxes: [...bootstrap.boxes, ...(args.currentBoxes ?? [])],
    emitGameIds,
  });
  const byGame = new Map(featureRows.map((row) => [row.game_id, row]));
  if (byGame.size !== upcomingGames.length) {
    throw new Error(
      `NBA professional runtime emitted ${byGame.size}/${upcomingGames.length} requested feature rows.`,
    );
  }
  for (const row of byGame.values()) {
    for (const feature of NBA_PROFESSIONAL_MODEL_ARTIFACT.design.features) {
      const value = row[feature];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(`NBA professional runtime feature ${feature} is not finite or null.`);
      }
    }
  }
  return byGame;
}

export function selectNbaProfessionalPortableFeatures(
  row: NbaPointInTimeFeatureRow,
): NbaPortableFeatureRow {
  return Object.fromEntries(NBA_PROFESSIONAL_MODEL_ARTIFACT.design.features.map((feature) => {
    const value = row[feature];
    return [feature, typeof value === "number" && Number.isFinite(value) ? value : null];
  }));
}

export const __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__ = {
  bootstrapGames: bootstrap.games,
  bootstrapBoxes: bootstrap.boxes,
  providerTeamIdByAbbreviation,
};
