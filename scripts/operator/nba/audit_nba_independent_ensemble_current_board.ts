/**
 * Read-only opening-board impact for the research-only independent ensemble.
 *
 * This uses the same immutable bootstrap and point-in-time feature builder as
 * production, but it never calls a provider or writes model/market data.
 */

import {
  __NBA_PROFESSIONAL_RUNTIME_ARTIFACT_TEST__,
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";
import { writeFileSync } from "node:fs";

const RELEASE = "nba_independent_ensemble_shadow_2026_10_20_r1_current_board";
const MARGIN_RATING_WEIGHT = 0.30;
const TOTAL_RATING_WEIGHT = 0.20;

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

function finiteMean(values: Array<number | null | undefined>): number {
  const finite = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  if (finite.length === 0) return 99;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

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
  const league = Number(row.league_off_rating);
  const pace = finiteMean([
    typeof row.home_pace_15 === "number" ? row.home_pace_15 : null,
    typeof row.away_pace_15 === "number" ? row.away_pace_15 : null,
    typeof row.home_pace_prior === "number" ? row.home_pace_prior : null,
    typeof row.away_pace_prior === "number" ? row.away_pace_prior : null,
  ]);
  const ratingHome = (
    Number(row.home_adjusted_offense)
    + Number(row.away_adjusted_defense)
    - league
  ) * pace / 100 + homeAdvantage / 2;
  const ratingAway = (
    Number(row.away_adjusted_offense)
    + Number(row.home_adjusted_defense)
    - league
  ) * pace / 100 - homeAdvantage / 2;
  const incumbentMargin = incumbent.homeScore - incumbent.awayScore;
  const incumbentTotal = incumbent.homeScore + incumbent.awayScore;
  const ratingMargin = ratingHome - ratingAway;
  const ratingTotal = ratingHome + ratingAway;
  const candidateMargin = (
    (1 - MARGIN_RATING_WEIGHT) * incumbentMargin
    + MARGIN_RATING_WEIGHT * ratingMargin
  );
  const candidateTotal = (
    (1 - TOTAL_RATING_WEIGHT) * incumbentTotal
    + TOTAL_RATING_WEIGHT * ratingTotal
  );
  const candidateHome = (candidateTotal + candidateMargin) / 2;
  const candidateAway = (candidateTotal - candidateMargin) / 2;
  return {
    gameId: game.gameId,
    matchup: `${game.awayTeam}@${game.homeTeam}`,
    incumbent: {
      awayScore: incumbent.awayScore,
      homeScore: incumbent.homeScore,
      marginHome: incumbentMargin,
      total: incumbentTotal,
    },
    rating: {
      awayScore: ratingAway,
      homeScore: ratingHome,
      marginHome: ratingMargin,
      total: ratingTotal,
    },
    candidate: {
      awayScore: candidateAway,
      homeScore: candidateHome,
      marginHome: candidateMargin,
      total: candidateTotal,
    },
    delta: {
      marginHome: candidateMargin - incumbentMargin,
      total: candidateTotal - incumbentTotal,
    },
  };
});

console.log(JSON.stringify({
  release: RELEASE,
  status: "research_only_no_production_authority",
  modelArtifact: NBA_PROFESSIONAL_MODEL_ARTIFACT.release,
  weights: {
    marginRating: MARGIN_RATING_WEIGHT,
    totalRating: TOTAL_RATING_WEIGHT,
  },
  homeAdvantage,
  rows,
}, null, 2));
