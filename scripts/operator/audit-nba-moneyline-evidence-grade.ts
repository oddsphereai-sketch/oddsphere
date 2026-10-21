/** Read-only same-input audit of the NBA Moneyline Best Angle evidence guard. */

import {
  NBA_GRADE_POLICY_RELEASE,
  NBA_MARKET_MARRIAGE_RELEASE,
  NBA_MODEL_RELEASE,
} from "../../lib/automodel/nba/nbaChampionRuntime";
import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";
import { gradeNbaMarket, type RecommendationGrade } from "../../lib/services/nba/nbaMarketReview";

const dates = process.argv.slice(2);
if (dates.length === 0) throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");

function actionable(grade: RecommendationGrade): boolean {
  return grade === "best_angle" || grade === "lean";
}

function expectedReturn(probability: number | null, american: number | null): number | null {
  if (probability === null || american === null || american === 0) return null;
  const profit = american > 0 ? american / 100 : 100 / Math.abs(american);
  return probability * profit - (1 - probability);
}

function slimRead(read: {
  status?: string;
  side?: string | null;
  reason?: string;
  resistance?: string;
} | null): Record<string, unknown> | null {
  if (read === null) return null;
  return {
    status: read.status ?? null,
    side: read.side ?? null,
    reason: read.reason ?? null,
    resistance: read.resistance ?? null,
  };
}

async function main(): Promise<void> {
  const slates = [];
  for (const date of dates) {
    const { nbaDto } = await buildNbaDailyEdgePipeline(date);
    slates.push({ date, nbaDto });
  }

  const rows = slates.flatMap(({ date, nbaDto }) => nbaDto.games.map((game) => {
    const intel = game.intelligence.ml;
    const audit = game.grounding_audit as {
      market_reader?: {
        evidenceStatus?: string;
        reads?: {
          moneyline?: { status?: string; side?: string | null; reason?: string; resistance?: string };
          spread?: { status?: string; side?: string | null; reason?: string; resistance?: string };
        };
      };
      market_reader_decision?: {
        independentPicks?: { moneyline?: string };
        finalPicks?: { moneyline?: string };
        spreadCorrectionApplied?: boolean;
      };
    } | null;
    const incumbent = gradeNbaMarket({
      pick: intel.pick_side,
      confidence: intel.model_confidence,
      band: intel.conflict_band,
      edge: (intel.edge_prob_pp ?? 0) / 100,
      dataQualityTier: game.data_quality_tier,
      injuriesKnown: game.injuries.home_known && game.injuries.away_known,
      market: "moneyline",
      currentPriceAmerican: intel.current_price.odds_american,
      modelProbabilityOnPick: intel.model_prob_on_pick,
      enforceMoneylineEvidenceGuard: false,
    });
    const directRead = audit?.market_reader?.reads?.moneyline ?? null;
    const spreadRead = audit?.market_reader?.reads?.spread ?? null;
    return {
      date,
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      pick: intel.pick_label,
      incumbentGrade: incumbent.grade,
      candidateGrade: intel.grade,
      incumbentActionable: actionable(incumbent.grade),
      candidateActionable: actionable(intel.grade),
      modelProbability: intel.model_prob_on_pick,
      marketNoVigProbability: intel.market_no_vig_prob_pick,
      exactPrice: intel.current_price.odds_american,
      modelExpectedReturn: expectedReturn(intel.model_prob_on_pick, intel.current_price.odds_american),
      readerEvidenceStatus: audit?.market_reader?.evidenceStatus ?? null,
      directRead: slimRead(directRead),
      spreadRead: slimRead(spreadRead),
      spreadCorrectionApplied: audit?.market_reader_decision?.spreadCorrectionApplied ?? false,
      independentPick: audit?.market_reader_decision?.independentPicks?.moneyline ?? null,
      finalPick: audit?.market_reader_decision?.finalPicks?.moneyline ?? null,
      rationale: intel.rationale,
    };
  }));

  const gradeCounts = (key: "incumbentGrade" | "candidateGrade") => Object.fromEntries(
    (["best_angle", "lean", "watch", "caution", "no_market", "held"] as const)
      .map((grade) => [grade, rows.filter((row) => row[key] === grade).length]),
  );
  const changed = rows.filter((row) => row.incumbentGrade !== row.candidateGrade);
  const incumbentMlByGame = new Map(rows.map((row) => [row.gameExternalId, row.incumbentGrade]));
  const boardRows = slates.flatMap(({ nbaDto }) => nbaDto.games.flatMap((game) =>
    (["ml", "spread", "total"] as const).map((slot) => ({
      gameExternalId: game.game_external_id,
      market: game.intelligence[slot].market,
      candidateGrade: game.intelligence[slot].grade,
      incumbentGrade: slot === "ml"
        ? incumbentMlByGame.get(game.game_external_id) ?? game.intelligence[slot].grade
        : game.intelligence[slot].grade,
    })),
  ));
  const boardGradeCounts = (key: "incumbentGrade" | "candidateGrade") => Object.fromEntries(
    (["best_angle", "lean", "watch", "caution", "no_market", "held"] as const)
      .map((grade) => [grade, boardRows.filter((row) => row[key] === grade).length]),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    apply: false,
    productionChanged: false,
    dates,
    candidateReleases: {
      model: NBA_MODEL_RELEASE,
      marketMarriage: NBA_MARKET_MARRIAGE_RELEASE,
      grade: NBA_GRADE_POLICY_RELEASE,
    },
    summary: {
      games: rows.length,
      incumbentGrades: gradeCounts("incumbentGrade"),
      candidateGrades: gradeCounts("candidateGrade"),
      incumbentActionables: rows.filter((row) => row.incumbentActionable).length,
      candidateActionables: rows.filter((row) => row.candidateActionable).length,
      bestAnglePromotions: changed.filter((row) => row.candidateGrade === "best_angle").length,
      bestAngleDemotions: changed.filter((row) => row.incumbentGrade === "best_angle").length,
      actionablePromotions: changed.filter((row) => !row.incumbentActionable && row.candidateActionable).length,
      actionableDemotions: changed.filter((row) => row.incumbentActionable && !row.candidateActionable).length,
      negativeModelEvCandidateActionables: rows.filter((row) =>
        row.candidateActionable && !(row.modelExpectedReturn !== null && row.modelExpectedReturn > 0)
      ).length,
      fullBoardIncumbentGrades: boardGradeCounts("incumbentGrade"),
      fullBoardCandidateGrades: boardGradeCounts("candidateGrade"),
      fullBoardIncumbentActionables: boardRows.filter((row) => actionable(row.incumbentGrade)).length,
      fullBoardCandidateActionables: boardRows.filter((row) => actionable(row.candidateGrade)).length,
      scoreChanges: 0,
      sideChanges: 0,
      probabilityChanges: 0,
      selectedPriceChanges: 0,
    },
    changes: changed,
    rows,
  };

  console.log(JSON.stringify(report, null, 2));
}

void main();
