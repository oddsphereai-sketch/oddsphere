import type {
  NbaPortableFeatureRow,
  NbaPortableScore,
} from "./nbaPortableScoreModel";

export const NBA_INDEPENDENT_SCORE_SHADOW_RELEASE =
  "nba_independent_score_shadow_2026_10_20_r2_alpha300_rating_30_total_20" as const;

const MARGIN_RATING_WEIGHT = 0.30;
const TOTAL_RATING_WEIGHT = 0.20;
const REQUIRED = [
  "home_adjusted_offense",
  "home_adjusted_defense",
  "away_adjusted_offense",
  "away_adjusted_defense",
  "league_off_rating",
] as const;

export type NbaIndependentScoreShadow = {
  release: typeof NBA_INDEPENDENT_SCORE_SHADOW_RELEASE;
  productionAuthority: false;
  available: boolean;
  unavailableReason: string | null;
  weights: {
    ratingMargin: typeof MARGIN_RATING_WEIGHT;
    ratingTotal: typeof TOTAL_RATING_WEIGHT;
  };
  ridgeBase: NbaPortableScore;
  rating: NbaPortableScore | null;
  candidate: NbaPortableScore | null;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteMean(values: Array<number | null | undefined>): number | null {
  const observed = values.filter(finite);
  if (observed.length === 0) return null;
  return observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

export function buildNbaIndependentScoreShadow(args: {
  featureRow: NbaPortableFeatureRow;
  ridgeBase: NbaPortableScore;
  trainingHomeAdvantage: number;
}): NbaIndependentScoreShadow {
  const missing = REQUIRED.filter((feature) => !finite(args.featureRow[feature]));
  const pace = finiteMean([
    args.featureRow.home_pace_15,
    args.featureRow.away_pace_15,
    args.featureRow.home_pace_prior,
    args.featureRow.away_pace_prior,
  ]);
  if (missing.length > 0 || pace === null || !finite(args.trainingHomeAdvantage)) {
    return {
      release: NBA_INDEPENDENT_SCORE_SHADOW_RELEASE,
      productionAuthority: false,
      available: false,
      unavailableReason: missing.length > 0
        ? `missing_rating_inputs:${missing.join(",")}`
        : pace === null
          ? "missing_pace_inputs"
          : "invalid_training_home_advantage",
      weights: { ratingMargin: MARGIN_RATING_WEIGHT, ratingTotal: TOTAL_RATING_WEIGHT },
      ridgeBase: args.ridgeBase,
      rating: null,
      candidate: null,
    };
  }

  const league = args.featureRow.league_off_rating!;
  const homePer100 = args.featureRow.home_adjusted_offense!
    + args.featureRow.away_adjusted_defense! - league;
  const awayPer100 = args.featureRow.away_adjusted_offense!
    + args.featureRow.home_adjusted_defense! - league;
  const ratingHome = homePer100 * pace / 100 + args.trainingHomeAdvantage / 2;
  const ratingAway = awayPer100 * pace / 100 - args.trainingHomeAdvantage / 2;
  const rating: NbaPortableScore = {
    homeScore: ratingHome,
    awayScore: ratingAway,
    marginHome: ratingHome - ratingAway,
    total: ratingHome + ratingAway,
  };
  const candidateMargin = (1 - MARGIN_RATING_WEIGHT) * args.ridgeBase.marginHome
    + MARGIN_RATING_WEIGHT * rating.marginHome;
  const candidateTotal = (1 - TOTAL_RATING_WEIGHT) * args.ridgeBase.total
    + TOTAL_RATING_WEIGHT * rating.total;
  const candidate: NbaPortableScore = {
    homeScore: (candidateTotal + candidateMargin) / 2,
    awayScore: (candidateTotal - candidateMargin) / 2,
    marginHome: candidateMargin,
    total: candidateTotal,
  };
  return {
    release: NBA_INDEPENDENT_SCORE_SHADOW_RELEASE,
    productionAuthority: false,
    available: true,
    unavailableReason: null,
    weights: { ratingMargin: MARGIN_RATING_WEIGHT, ratingTotal: TOTAL_RATING_WEIGHT },
    ridgeBase: args.ridgeBase,
    rating,
    candidate,
  };
}
