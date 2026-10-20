/**
 * Read-only opening-board impact for the research-only independent ensemble.
 *
 * This uses the same immutable bootstrap and point-in-time feature builder as
 * production, but it never calls a provider or writes model/market data.
 */

import {
  __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__,
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_MARGIN_SHADOW_ARTIFACT,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";
import { buildNbaIndependentScoreShadow } from "../../../lib/automodel/nba/nbaIndependentScoreShadow";
import { writeFileSync } from "node:fs";

const RELEASE = "nba_independent_ensemble_shadow_2026_10_20_r2_alpha300_current_board";

const upcoming = [
  {
    gameId: 401_909_088,
    season: 2026,
    startTime: "2026-10-20T23:00:00.000Z",
    awayTeam: "BOS",
    homeTeam: "DET",
  },
  {
    gameId: 401_909_089,
    season: 2026,
    startTime: "2026-10-20T23:30:00.000Z",
    awayTeam: "PHI",
    homeTeam: "NY",
  },
  {
    gameId: 401_909_090,
    season: 2026,
    startTime: "2026-10-21T00:00:00.000Z",
    awayTeam: "OKC",
    homeTeam: "SA",
  },
] as const;

const completed = __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__.bootstrapGames;
const homeAdvantage = completed.reduce(
  (sum, game) => sum + game.homeScore - game.awayScore,
  0,
) / completed.length;
const features = buildNbaProfessionalRuntimeFeatures({ upcomingGames: upcoming });
const featureOutputIndex = process.argv.indexOf("--feature-output");
if (featureOutputIndex >= 0) {
  const output = process.argv[featureOutputIndex + 1];
  if (!output) throw new Error("--feature-output requires a path.");
  writeFileSync(
    output,
    [...features.values()].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

const rows = upcoming.map((game) => {
  const row = features.get(game.gameId);
  if (!row) throw new Error(`Missing feature row for ${game.gameId}.`);
  const incumbent = scoreNbaPortableModel(
    NBA_PROFESSIONAL_MODEL_ARTIFACT,
    selectNbaProfessionalPortableFeatures(row),
  );
  const portable = selectNbaProfessionalPortableFeatures(row);
  const ridgeBase = scoreNbaPortableModel(NBA_PROFESSIONAL_MARGIN_SHADOW_ARTIFACT, portable);
  const shadow = buildNbaIndependentScoreShadow({
    featureRow: portable,
    ridgeBase,
    trainingHomeAdvantage: homeAdvantage,
  });
  if (!shadow.candidate || !shadow.rating) throw new Error(`Unavailable shadow for ${game.gameId}.`);
  const candidate = shadow.candidate;
  return {
    gameId: game.gameId,
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    incumbent: {
      awayScore: incumbent.awayScore,
      homeScore: incumbent.homeScore,
      marginHome: incumbent.marginHome,
      total: incumbent.total,
    },
    ridgeBase,
    rating: shadow.rating,
    candidate,
    delta: {
      marginHome: candidate.marginHome - incumbent.marginHome,
      total: candidate.total - incumbent.total,
    },
  };
});

console.log(JSON.stringify({
  release: RELEASE,
  status: "research_only_no_production_authority",
  incumbentModelArtifact: NBA_PROFESSIONAL_MODEL_ARTIFACT.release,
  shadowModelArtifact: NBA_PROFESSIONAL_MARGIN_SHADOW_ARTIFACT.release,
  weights: { marginRating: 0.30, totalRating: 0.20 },
  homeAdvantage,
  rows,
}, null, 2));
