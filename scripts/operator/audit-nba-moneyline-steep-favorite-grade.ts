/** Read-only same-input audit of the NBA steep-favorite Best Angle tier. */

import {
  NBA_GRADE_POLICY_RELEASE,
  NBA_MARKET_MARRIAGE_RELEASE,
  NBA_MODEL_RELEASE,
} from "../../lib/automodel/nba/nbaChampionRuntime";
import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { NbaMoneylineDirectionalSignal } from "../../lib/services/nba/nbaMarketIntelligence";
import {
  gradeNbaMarket,
  NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE,
  type RecommendationGrade,
} from "../../lib/services/nba/nbaMarketReview";

const dates = process.argv.slice(2);
if (dates.length === 0) throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");

function actionable(grade: RecommendationGrade): boolean {
  return grade === "best_angle" || grade === "lean";
}

function expectedReturn(probability: number | null, price: number | null): number | null {
  if (probability === null || price === null || price === 0) return null;
  const profit = price > 0 ? price / 100 : 100 / Math.abs(price);
  return probability * profit - (1 - probability);
}

type AuditRow = {
  date: string;
  gameExternalId: number;
  matchup: string;
  pick: string | null;
  price: number | null;
  modelProbability: number | null;
  marketNoVigProbability: number | null;
  expectedReturn: number | null;
  legacyGrade: RecommendationGrade;
  candidateGrade: RecommendationGrade;
  marketDirection: NbaMoneylineDirectionalSignal | null;
  score: [number, number];
  side: string | null;
  rationale: string[];
};

async function main(): Promise<void> {
  const rows: AuditRow[] = [];
  for (const date of dates) {
    const { nbaDto } = await buildNbaDailyEdgePipeline(date);
    for (const game of nbaDto.games) {
      const intel = game.intelligence.ml;
      const grounding = game.grounding_audit as {
        market_reader?: { reads?: {
          moneyline?: { status?: string; side?: string | null };
          spread?: { status?: string; side?: string | null };
        } };
        market_reader_decision?: { spreadCorrectionApplied?: boolean };
      } | null;
      const direct = grounding?.market_reader?.reads?.moneyline;
      const spread = grounding?.market_reader?.reads?.spread;
      const legacy = gradeNbaMarket({
        pick: intel.pick_side,
        confidence: intel.model_confidence,
        band: intel.conflict_band,
        edge: (intel.edge_prob_pp ?? 0) / 100,
        dataQualityTier: game.data_quality_tier,
        injuriesKnown: game.injuries.home_known && game.injuries.away_known,
        market: "moneyline",
        currentPriceAmerican: intel.current_price.odds_american,
        modelProbabilityOnPick: intel.model_prob_on_pick,
        moneylineEvidence: {
          directReadQualified: direct?.status === "qualified",
          directReadSide: direct?.side === "home" || direct?.side === "away" ? direct.side : null,
          spreadReadQualified: spread?.status === "qualified",
          spreadReadSide: spread?.side === "home" || spread?.side === "away" ? spread.side : null,
          spreadCorrectionApplied: grounding?.market_reader_decision?.spreadCorrectionApplied === true,
        },
        enforceSteepMoneylineBestAngleTier: false,
      });
      rows.push({
        date,
        gameExternalId: game.game_external_id,
        matchup: game.matchup,
        pick: intel.pick_label,
        price: intel.current_price.odds_american,
        modelProbability: intel.model_prob_on_pick,
        marketNoVigProbability: intel.market_no_vig_prob_pick,
        expectedReturn: expectedReturn(intel.model_prob_on_pick, intel.current_price.odds_american),
        legacyGrade: legacy.grade,
        candidateGrade: intel.grade,
        marketDirection: intel.qualified_market_direction ?? null,
        score: [game.projection.away_score, game.projection.home_score],
        side: intel.pick_side,
        rationale: intel.rationale,
      });
    }
  }

  const grades: RecommendationGrade[] = ["best_angle", "lean", "watch", "caution", "no_market", "held"];
  const counts = (key: "legacyGrade" | "candidateGrade") => Object.fromEntries(
    grades.map((grade) => [grade, rows.filter((row) => row[key] === grade).length]),
  );
  const changed = rows.filter((row) => row.legacyGrade !== row.candidateGrade);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    apply: false,
    dates,
    boundary: {
      americanPrice: NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE,
      breakEvenProbability: Math.abs(NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE) /
        (Math.abs(NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE) + 100),
    },
    candidateReleases: {
      model: NBA_MODEL_RELEASE,
      marketMarriage: NBA_MARKET_MARRIAGE_RELEASE,
      grade: NBA_GRADE_POLICY_RELEASE,
    },
    summary: {
      games: rows.length,
      legacyGrades: counts("legacyGrade"),
      candidateGrades: counts("candidateGrade"),
      legacyActionables: rows.filter((row) => actionable(row.legacyGrade)).length,
      candidateActionables: rows.filter((row) => actionable(row.candidateGrade)).length,
      actionablePromotions: rows.filter((row) => !actionable(row.legacyGrade) && actionable(row.candidateGrade)).length,
      actionableDemotions: rows.filter((row) => actionable(row.legacyGrade) && !actionable(row.candidateGrade)).length,
      bestAngleToLean: changed.filter((row) => row.legacyGrade === "best_angle" && row.candidateGrade === "lean").length,
      scoreChanges: 0,
      sideChanges: 0,
      probabilityChanges: 0,
      selectedPriceChanges: 0,
    },
    changes: changed,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
