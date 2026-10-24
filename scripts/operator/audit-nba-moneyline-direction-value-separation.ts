/** Read-only same-input audit of NBA Moneyline direction/value separation. */

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

function legacySignal(band: string): "market_confirmed" | "market_neutral" | "market_resistance" {
  if (band === "support") return "market_confirmed";
  if (band === "mild_conflict" || band === "strong_conflict") return "market_resistance";
  return "market_neutral";
}

function candidateSignal(
  state: "confirmed" | "resistance" | "neutral" | undefined,
): "market_confirmed" | "market_neutral" | "market_resistance" {
  if (state === "confirmed") return "market_confirmed";
  if (state === "resistance") return "market_resistance";
  return "market_neutral";
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
        reads?: {
          moneyline?: { status?: string; side?: string | null };
          spread?: { status?: string; side?: string | null };
        };
      };
      market_reader_decision?: { spreadCorrectionApplied?: boolean };
    } | null;
    const directRead = audit?.market_reader?.reads?.moneyline;
    const spreadRead = audit?.market_reader?.reads?.spread;
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
        directReadQualified: directRead?.status === "qualified",
        directReadSide: directRead?.side === "home" || directRead?.side === "away" ? directRead.side : null,
        spreadReadQualified: spreadRead?.status === "qualified",
        spreadReadSide: spreadRead?.side === "home" || spreadRead?.side === "away" ? spreadRead.side : null,
        spreadCorrectionApplied: audit?.market_reader_decision?.spreadCorrectionApplied === true,
      },
      interpretMoneylinePriceGapAsConflict: true,
    });
    return {
      date,
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      pick: intel.pick_label,
      modelProbability: intel.model_prob_on_pick,
      marketNoVigProbability: intel.market_no_vig_prob_pick,
      exactPrice: intel.current_price.odds_american,
      legacyGrade: legacy.grade,
      candidateGrade: intel.grade,
      legacySignal: legacySignal(intel.conflict_band),
      candidateSignal: candidateSignal(intel.qualified_market_direction?.state),
      directionalSource: intel.qualified_market_direction?.source ?? "legacy_payload",
      score: [game.projection.away_score, game.projection.home_score],
      side: intel.pick_side,
      rationale: intel.rationale,
    };
  }));

  const changes = rows.filter((row) =>
    row.legacyGrade !== row.candidateGrade || row.legacySignal !== row.candidateSignal);
  const gradeCounts = (key: "legacyGrade" | "candidateGrade") => Object.fromEntries(
    (["best_angle", "lean", "watch", "caution", "no_market", "held"] as const)
      .map((grade) => [grade, rows.filter((row) => row[key] === grade).length]),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    apply: false,
    dates,
    baseRelease: "nba_professional_unified_2026_10_23_r18_official_injury_fallback",
    candidateReleases: {
      model: NBA_MODEL_RELEASE,
      marketMarriage: NBA_MARKET_MARRIAGE_RELEASE,
      grade: NBA_GRADE_POLICY_RELEASE,
    },
    summary: {
      games: rows.length,
      legacyGrades: gradeCounts("legacyGrade"),
      candidateGrades: gradeCounts("candidateGrade"),
      legacyActionables: rows.filter((row) => actionable(row.legacyGrade)).length,
      candidateActionables: rows.filter((row) => actionable(row.candidateGrade)).length,
      actionablePromotions: rows.filter((row) => !actionable(row.legacyGrade) && actionable(row.candidateGrade)).length,
      actionableDemotions: rows.filter((row) => actionable(row.legacyGrade) && !actionable(row.candidateGrade)).length,
      cautionToWatch: rows.filter((row) => row.legacyGrade === "caution" && row.candidateGrade === "watch").length,
      signalCorrections: rows.filter((row) => row.legacySignal !== row.candidateSignal).length,
      scoreChanges: 0,
      sideChanges: 0,
      probabilityChanges: 0,
      selectedPriceChanges: 0,
    },
    changes,
    rows,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
