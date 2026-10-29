/** Read-only same-input r4 generic versus r5 market-specific NBA grade audit. */

import { NBA_GRADE_POLICY_RELEASE, NBA_MODEL_RELEASE } from "../../lib/automodel/nba/nbaChampionRuntime";
import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { NbaDailyEdgeGameDto, MarketIntelligence } from "../../lib/services/nba/buildNbaDailyEdgeDto";
import type { RecommendationGrade } from "../../lib/services/nba/nbaMarketReview";

const dates = process.argv.slice(2);
if (dates.length === 0) throw new Error("Pass one or more NBA slate dates (YYYY-MM-DD).");

function incumbentGrade(game: NbaDailyEdgeGameDto, intel: MarketIntelligence): RecommendationGrade {
  if (intel.pick_side === null) return "held";
  if (intel.current_price.odds_american === null || intel.market_no_vig_prob_pick === null) return "no_market";
  if (intel.conflict_band === "strong_conflict") return "caution";
  if (game.data_quality_tier === "fallback" || game.data_quality_tier === "low") return "watch";
  if (intel.model_confidence < 55 || intel.conflict_band === "mild_conflict") return "watch";
  const edge = intel.market === "moneyline"
    ? Math.abs((intel.edge_prob_pp ?? 0) / 100)
    : intel.market === "spread"
      ? Math.abs((intel.edge_points ?? 0) / 10)
      : Math.abs((intel.edge_points ?? 0) / 15);
  const injuriesKnown = game.injuries.home_known && game.injuries.away_known;
  if (intel.model_confidence >= 62 && edge >= 0.04 && injuriesKnown && game.data_quality_tier === "high") {
    return "best_angle";
  }
  return "lean";
}

function actionable(grade: RecommendationGrade): boolean {
  return grade === "best_angle" || grade === "lean";
}

function expectedReturn(probability: number, american: number | null): number | null {
  if (american === null || american === 0) return null;
  const profit = american > 0 ? american / 100 : 100 / Math.abs(american);
  return probability * profit - (1 - probability);
}

async function main(): Promise<void> {
  const slates = [];
  for (const date of dates) {
    const { nbaDto } = await buildNbaDailyEdgePipeline(date);
    slates.push({ date, nbaDto });
  }
  const rows = slates.flatMap(({ date, nbaDto }) => nbaDto.games.flatMap((game) => {
    const audit = game.grounding_audit as {
      market_reader_decision?: unknown;
      market_reader?: { evidenceStatus?: string; reads?: Record<string, { status?: string; side?: string | null }> };
    } | null;
    return (["ml", "spread", "total"] as const).map((slot) => {
      const intel = game.intelligence[slot];
      const oldGrade = incumbentGrade(game, intel);
      const candidateGrade = intel.grade;
      const candidateEv = intel.model_prob_on_pick === null || intel.current_price.odds_american === null
        ? null
        : expectedReturn(intel.model_prob_on_pick, intel.current_price.odds_american);
      return {
        date,
        gameExternalId: game.game_external_id,
        matchup: game.matchup,
        market: intel.market,
        pick: intel.pick_label,
        selectedPrice: intel.current_price.odds_american,
        selectedSportsbook: intel.current_price.sportsbook,
        fairReferenceMode: intel.fair_reference_mode,
        fairReferenceBooks: intel.fair_reference_books,
        rawModelProbability: intel.model_prob_on_pick,
        effectiveProbability: intel.effective_confidence / 100,
        independentEdgePoints: intel.market === "moneyline" ? null : intel.edge_points,
        incumbentGrade: oldGrade,
        candidateGrade,
        promotion: !actionable(oldGrade) && actionable(candidateGrade),
        demotion: actionable(oldGrade) && !actionable(candidateGrade),
        bestAnglePromotion: oldGrade !== "best_angle" && candidateGrade === "best_angle",
        bestAngleDemotion: oldGrade === "best_angle" && candidateGrade !== "best_angle",
        candidateExpectedReturn: candidateEv,
        readerEvidenceStatus: audit?.market_reader?.evidenceStatus ?? null,
        readerRead: audit?.market_reader?.reads?.[intel.market] ?? null,
        readerDecision: audit?.market_reader_decision ?? null,
        rationale: intel.rationale,
      };
    });
  }));
  const grades: RecommendationGrade[] = ["best_angle", "lean", "watch", "caution", "no_market", "held"];
  const markets = ["moneyline", "spread", "total"];
  const counts = (key: "incumbentGrade" | "candidateGrade") => Object.fromEntries(markets.map((market) => [
    market,
    Object.fromEntries(grades.map((grade) => [grade, rows.filter((row) => row.market === market && row[key] === grade).length])),
  ]));
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    apply: false,
    productionChanged: false,
    dates,
    candidateReleases: { model: NBA_MODEL_RELEASE, grade: NBA_GRADE_POLICY_RELEASE },
    summary: {
      games: slates.reduce((sum, slate) => sum + slate.nbaDto.games.length, 0),
      markets: rows.length,
      incumbentCounts: counts("incumbentGrade"),
      candidateCounts: counts("candidateGrade"),
      incumbentActionables: rows.filter((row) => actionable(row.incumbentGrade)).length,
      candidateActionables: rows.filter((row) => actionable(row.candidateGrade)).length,
      promotions: rows.filter((row) => row.promotion).length,
      demotions: rows.filter((row) => row.demotion).length,
      bestAnglePromotions: rows.filter((row) => row.bestAnglePromotion).length,
      bestAngleDemotions: rows.filter((row) => row.bestAngleDemotion).length,
      promotedNonpositiveExpectedReturn: rows.filter((row) =>
        row.promotion && (row.candidateExpectedReturn === null || row.candidateExpectedReturn <= 0)
      ).length,
      completeReaderEvidenceGames: slates.flatMap((slate) => slate.nbaDto.games).filter((game) =>
        (game.grounding_audit as { market_reader?: { evidenceStatus?: string } } | null)
          ?.market_reader?.evidenceStatus === "complete"
      ).length,
    },
    rows,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main();
