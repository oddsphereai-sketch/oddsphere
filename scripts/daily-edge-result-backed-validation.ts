import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import { sanitizeDailyEdgeAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import type { MarketIntelligenceInterpretation } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import type { PredictionEvidenceReview } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

type ResultValue = "win" | "loss" | "push" | "void" | "pending" | "unknown";

type JoinedResult = {
  result: ResultValue;
  units: number;
  oddsAmerican: number | null;
  predictionRecordId: string | null;
};

type Alignment = {
  originalGrade: string | null;
  suggestedGrade: string | null;
  action: "hold" | "promote" | "downgrade";
  classification: "aligned" | "overgraded" | "undergraded" | "copy_only" | "risk_only";
  supportedPromotion: boolean;
  supportedDowngrade: boolean;
  copyOnlyImprovement: boolean;
  riskOnlyImprovement: boolean;
  reasons: string[];
};

type AnalyzedRow = {
  evidence: PredictionEvidenceObject;
  evidenceReview: PredictionEvidenceReview;
  marketIntelligence: MarketIntelligenceInterpretation;
  alignment: Alignment;
  result: JoinedResult;
};

type RawPredictionRow = {
  id: string;
  external_id: number | null;
  game_id: string | number | null;
  market: string | null;
  odds_american: number | null;
  prediction_grades?: { result?: string | null } | Array<{ result?: string | null }> | null;
};

const GRADE_ORDER = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", date: "2026-06-29", markets: "ML,TOTAL,FI", json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    if (key === "date") out.date = value;
    if (key === "markets") out.markets = value;
  }
  return out;
}

function normalizeResult(value: string | null | undefined): ResultValue {
  const text = String(value ?? "unknown").toLowerCase();
  if (text === "win" || text === "loss" || text === "push" || text === "void" || text === "pending") return text;
  return "unknown";
}

function americanUnits(odds: number | null, result: ResultValue): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (odds === null || odds === 0 || !Number.isFinite(odds)) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function keyFor(row: Pick<PredictionEvidenceObject, "identity">): string {
  return `${row.identity.externalId}:${row.identity.normalizedMarket}`;
}

function gradeRank(grade: string | null): number {
  return GRADE_ORDER.indexOf(grade ?? "");
}

function isActionable(grade: string | null): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function moveGrade(grade: string | null, delta: number): string | null {
  const rank = gradeRank(grade);
  if (rank < 0) return grade;
  return GRADE_ORDER[Math.max(0, Math.min(GRADE_ORDER.length - 1, rank + delta))];
}

function direction(original: string | null, suggested: string | null): "hold" | "promote" | "downgrade" {
  const a = gradeRank(original);
  const b = gradeRank(suggested);
  if (a < 0 || b < 0 || a === b) return "hold";
  return b > a ? "promote" : "downgrade";
}

function game(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function edge(row: PredictionEvidenceObject): number {
  return Number(row.modelStatsEvidence.edge ?? 0);
}

function deterministicGradeAlignment(
  evidence: PredictionEvidenceObject,
  evidenceReview: PredictionEvidenceReview,
  market: MarketIntelligenceInterpretation,
): Alignment {
  const reasons: string[] = [];
  const original = evidence.identity.originalPlayGrade;
  let suggested = original;
  let classification: Alignment["classification"] = "aligned";
  let supportedPromotion = false;
  let supportedDowngrade = false;
  let copyOnlyImprovement = false;
  let riskOnlyImprovement = false;

  const e = edge(evidence);
  const price = evidence.priceValueEvidence.priceAmerican;
  const publicGrade = isActionable(original);
  const nonActionable = !publicGrade;
  const highFriction = market.marketFrictionLevel === "high";
  const mediumFriction = market.marketFrictionLevel === "medium";
  const playable = market.currentNumberPlayable !== false && evidence.priceValueEvidence.priceBecameUnplayable !== true;
  const dataRisk = evidenceReview.highMaterialityDataWarnings.length > 0;
  const blocked = evidenceReview.evidenceQuality === "blocked";
  const sourceMissingOnly = evidenceReview.persistenceGaps.every((gap) =>
    gap === "sharp_book_context_not_persisted_at_lock" ||
    gap === "fi_price_missing_locked_snapshot" ||
    gap === "fi_price_missing_current_prelock" ||
    gap === "fi_price_not_offered_or_unavailable" ||
    gap === "fi_price_recovered_from_history" ||
    gap === "fi_price_recovered_from_snapshot" ||
    gap === "fi_market_implied_missing_locked_snapshot" ||
    gap === "fi_market_implied_missing_current_prelock" ||
    gap === "fi_edge_missing_locked_snapshot" ||
    gap === "fi_edge_missing_current_prelock"
  );
  const heavyThin = evidence.priceValueEvidence.heavyJuiceWarning && e < 4;
  const strongEdge = e >= (evidence.identity.marketType === "ML" ? 6 : evidence.identity.marketType === "TOTAL" ? 4 : 3);
  const veryStrongEdge = e >= (evidence.identity.marketType === "ML" ? 9 : evidence.identity.marketType === "TOTAL" ? 6 : 5);
  const frictionOverride = strongEdge && playable && !dataRisk;

  if (blocked) {
    classification = publicGrade ? "overgraded" : "risk_only";
    suggested = publicGrade ? moveGrade(original, -2) : original;
    supportedDowngrade = publicGrade;
    riskOnlyImprovement = !publicGrade;
    reasons.push("blocked_core_evidence");
  } else if (publicGrade && (!playable || heavyThin || dataRisk || (highFriction && !frictionOverride))) {
    classification = "overgraded";
    supportedDowngrade = true;
    suggested = original === "Best Angle" ? "Lean" : "Watchlist";
    if (!playable) reasons.push("current_number_not_playable");
    if (heavyThin) reasons.push("heavy_juice_thin_edge");
    if (dataRisk) reasons.push("material_data_warning");
    if (highFriction && !frictionOverride) reasons.push("high_market_friction_without_override");
  } else if (nonActionable && playable && evidenceReview.gradeChangeAllowed && veryStrongEdge && !highFriction && !dataRisk) {
    classification = "undergraded";
    supportedPromotion = true;
    suggested = original === "No Play" ? "Watchlist" : "Lean";
    reasons.push("strong_edge_playable_price_low_friction");
  } else if (nonActionable && playable && evidenceReview.gradeChangeAllowed && strongEdge && (market.modelMarketRelationship === "model_confirmed_by_market" || market.consensusVsSharpRelationship === "both_support")) {
    classification = "undergraded";
    supportedPromotion = true;
    suggested = original === "No Play" ? "Watchlist" : "Lean";
    reasons.push("model_value_supported_by_market_context");
  } else if (publicGrade && (mediumFriction || evidence.priceValueEvidence.heavyJuiceWarning)) {
    classification = "risk_only";
    riskOnlyImprovement = true;
    reasons.push(mediumFriction ? "market_friction_needs_reader_thesis" : "price_risk_needs_reader_thesis");
  } else if (!sourceMissingOnly && evidenceReview.persistenceGaps.length > 0) {
    classification = "copy_only";
    copyOnlyImprovement = true;
    reasons.push("persistence_gap_should_be_explained_without_grade_change");
  } else if (evidence.identity.marketType !== "FI" && evidence.marketEvidence.sourceConflict) {
    classification = "copy_only";
    copyOnlyImprovement = true;
    reasons.push("source_conflict_needs_clear_market_read_copy");
  }

  return {
    originalGrade: original,
    suggestedGrade: suggested,
    action: direction(original, suggested),
    classification,
    supportedPromotion,
    supportedDowngrade,
    copyOnlyImprovement,
    riskOnlyImprovement,
    reasons,
  };
}

async function loadResults(args: { sport: Sport; date: string; markets: AiAuditorMarketKey[] }): Promise<Map<string, JoinedResult>> {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,external_id,game_id,market,odds_american,prediction_grades(result)")
    .eq("sport", args.sport)
    .eq("slate_date", args.date)
    .in("market", args.markets)
    .limit(10000);
  if (error) throw new Error(`prediction_records result join failed: ${error.message}`);
  const map = new Map<string, JoinedResult>();
  for (const row of (data ?? []) as RawPredictionRow[]) {
    const result = normalizeResult(one(row.prediction_grades)?.result);
    const joined: JoinedResult = {
      result,
      units: americanUnits(row.odds_american, result),
      oddsAmerican: row.odds_american,
      predictionRecordId: row.id,
    };
    if (row.external_id !== null && row.market) map.set(`${row.external_id}:${row.market}`, joined);
    if (row.game_id !== null && row.market) map.set(`${row.game_id}:${row.market}`, joined);
  }
  return map;
}

function emptyResult(): JoinedResult {
  return { result: "unknown", units: 0, oddsAmerican: null, predictionRecordId: null };
}

function summarize(rows: AnalyzedRow[]) {
  const wins = rows.filter((row) => row.result.result === "win").length;
  const losses = rows.filter((row) => row.result.result === "loss").length;
  const pushes = rows.filter((row) => row.result.result === "push").length;
  const settled = wins + losses;
  const units = +rows.reduce((sum, row) => sum + row.result.units, 0).toFixed(4);
  return {
    count: rows.length,
    settled,
    wins,
    losses,
    pushes,
    pending: rows.filter((row) => row.result.result === "pending").length,
    unknown: rows.filter((row) => row.result.result === "unknown").length,
    units,
    roi: settled > 0 ? +(units / settled).toFixed(4) : null,
    winRate: settled > 0 ? +(wins / settled).toFixed(4) : null,
  };
}

function groupSummary(rows: AnalyzedRow[], keyFn: (row: AnalyzedRow) => string | null | undefined): Record<string, ReturnType<typeof summarize>> {
  const groups = new Map<string, AnalyzedRow[]>();
  for (const row of rows) {
    const key = String(keyFn(row) ?? "null");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)]));
}

function example(row: AnalyzedRow) {
  return {
    game: game(row.evidence),
    market: row.evidence.identity.normalizedMarket,
    pick: row.evidence.identity.pick,
    originalGrade: row.alignment.originalGrade,
    suggestedGrade: row.alignment.suggestedGrade,
    action: row.alignment.action,
    classification: row.alignment.classification,
    reasons: row.alignment.reasons,
    result: row.result.result,
    units: row.result.units,
    price: row.evidence.priceValueEvidence.priceAmerican,
    edge: row.evidence.modelStatsEvidence.edge,
    marketFriction: row.marketIntelligence.marketFrictionLevel,
    modelMarketRelationship: row.marketIntelligence.modelMarketRelationship,
    evidenceSource: row.evidence.evidenceSource.kind,
  };
}

function actionabilityImpact(rows: AnalyzedRow[]) {
  const changed = rows.filter((row) => isActionable(row.alignment.originalGrade) !== isActionable(row.alignment.suggestedGrade));
  const winnersRemoved = changed.filter((row) => isActionable(row.alignment.originalGrade) && !isActionable(row.alignment.suggestedGrade) && row.result.result === "win");
  const losersRemoved = changed.filter((row) => isActionable(row.alignment.originalGrade) && !isActionable(row.alignment.suggestedGrade) && row.result.result === "loss");
  const winnersPromoted = changed.filter((row) => !isActionable(row.alignment.originalGrade) && isActionable(row.alignment.suggestedGrade) && row.result.result === "win");
  const losersPromoted = changed.filter((row) => !isActionable(row.alignment.originalGrade) && isActionable(row.alignment.suggestedGrade) && row.result.result === "loss");
  const unitsImpact = +changed.reduce((sum, row) => {
    if (isActionable(row.alignment.originalGrade) && !isActionable(row.alignment.suggestedGrade)) return sum - row.result.units;
    if (!isActionable(row.alignment.originalGrade) && isActionable(row.alignment.suggestedGrade)) return sum + row.result.units;
    return sum;
  }, 0).toFixed(4);
  return {
    actionabilityChanged: changed.length,
    winnersRemoved: winnersRemoved.length,
    losersRemoved: losersRemoved.length,
    winnersPromoted: winnersPromoted.length,
    losersPromoted: losersPromoted.length,
    unitsImpact,
    helpedExamples: [...losersRemoved, ...winnersPromoted].slice(0, 8).map(example),
    hurtExamples: [...winnersRemoved, ...losersPromoted].slice(0, 8).map(example),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets(args.markets);
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const selection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets,
    response,
  });

  const deterministicRows = selection.evidence.map((evidence) => {
    const evidenceReview = reviewPredictionEvidence(evidence);
    const marketIntelligence = interpretMarketIntelligence(evidence);
    const healed = selfHealDailyEdgePrediction({ evidence, evidenceReview, marketIntelligence, sanitizerResult: null });
    sanitizeDailyEdgeAiOutput(evidence, {
      marketReadLabel: healed.repairedReaderFields.marketReadLabel,
      marketReadCopy: healed.repairedReaderFields.marketReadCopy,
      supportingEvidenceCopy: healed.repairedReaderFields.supportingEvidenceCopy,
      riskCopy: healed.repairedReaderFields.riskCopy,
      originalPlayGrade: evidence.identity.originalPlayGrade,
      suggestedPlayGrade: evidence.identity.originalPlayGrade,
      gradeChangeRecommended: false,
      gradeChangeDirection: "hold",
      validationErrors: [],
    });
    return {
      evidence,
      evidenceReview,
      marketIntelligence,
      alignment: deterministicGradeAlignment(evidence, evidenceReview, marketIntelligence),
    };
  });

  const results = await loadResults({ sport: args.sport, date: args.date, markets });
  const rows: AnalyzedRow[] = deterministicRows.map((row) => ({
    ...row,
    result: results.get(keyFor(row.evidence)) ?? results.get(`${row.evidence.identity.gameId}:${row.evidence.identity.normalizedMarket}`) ?? emptyResult(),
  }));

  const supportedDowngrades = rows.filter((row) => row.alignment.supportedDowngrade);
  const supportedPromotions = rows.filter((row) => row.alignment.supportedPromotion);
  const copyOnly = rows.filter((row) => row.alignment.copyOnlyImprovement);
  const riskOnly = rows.filter((row) => row.alignment.riskOnlyImprovement);
  const impact = actionabilityImpact(rows);
  const originalActionable = rows.filter((row) => isActionable(row.alignment.originalGrade));
  const suggestedActionable = rows.filter((row) => isActionable(row.alignment.suggestedGrade));
  const report = {
    mode: "result_backed_daily_edge_validation",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    appliedRows: 0,
    sport: args.sport,
    date: args.date,
    markets,
    leakageBoundary: {
      lockedEvidenceBuiltBeforeResultJoin: true,
      postgameResultsJoinedAfterDeterministicOutputs: true,
      postgameFieldsIncludedInEvidence: false,
    },
    evidenceSource: selection.selectionSummary,
    cards: new Set(rows.map((row) => row.evidence.identity.gameId)).size,
    predictionRows: rows.length,
    resultJoin: {
      rowsWithResultRecord: rows.filter((row) => row.result.predictionRecordId !== null).length,
      winLossPushRows: rows.filter((row) => row.result.result === "win" || row.result.result === "loss" || row.result.result === "push").length,
      unknownRows: rows.filter((row) => row.result.result === "unknown").length,
      byMarket: groupSummary(rows, (row) => row.evidence.identity.normalizedMarket),
    },
    originalGradeResultProfile: groupSummary(rows, (row) => row.alignment.originalGrade),
    suggestedGradeResultProfile: groupSummary(rows, (row) => row.alignment.suggestedGrade),
    originalBestAngle: summarize(rows.filter((row) => row.alignment.originalGrade === "Best Angle")),
    originalLean: summarize(rows.filter((row) => row.alignment.originalGrade === "Lean")),
    originalWatchlistCautionNoPlay: {
      Watchlist: summarize(rows.filter((row) => row.alignment.originalGrade === "Watchlist")),
      Caution: summarize(rows.filter((row) => row.alignment.originalGrade === "Caution")),
      "No Play": summarize(rows.filter((row) => row.alignment.originalGrade === "No Play")),
    },
    originalActionable: summarize(originalActionable),
    suggestedActionable: summarize(suggestedActionable),
    gradeAlignment: {
      byClassification: groupSummary(rows, (row) => row.alignment.classification),
      byAction: groupSummary(rows, (row) => row.alignment.action),
      overgradedCandidates: summarize(rows.filter((row) => row.alignment.classification === "overgraded")),
      undergradedCandidates: summarize(rows.filter((row) => row.alignment.classification === "undergraded")),
      supportedDowngradeCandidates: summarize(supportedDowngrades),
      supportedPromotionCandidates: summarize(supportedPromotions),
      copyOnlyRiskOnly: {
        copyOnly: summarize(copyOnly),
        riskOnly: summarize(riskOnly),
      },
    },
    unitsRoiCounterfactual: impact,
    marketBreakdown: {
      moneyline: {
        original: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline"), (row) => row.alignment.originalGrade),
        suggested: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline"), (row) => row.alignment.suggestedGrade),
        impact: actionabilityImpact(rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline")),
      },
      total: {
        original: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "total"), (row) => row.alignment.originalGrade),
        suggested: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "total"), (row) => row.alignment.suggestedGrade),
        impact: actionabilityImpact(rows.filter((row) => row.evidence.identity.normalizedMarket === "total")),
      },
      first_inning: {
        deterministicOnly: true,
        original: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning"), (row) => row.alignment.originalGrade),
        suggested: groupSummary(rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning"), (row) => row.alignment.suggestedGrade),
        impact: actionabilityImpact(rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning")),
      },
    },
    examples: {
      overgraded: rows.filter((row) => row.alignment.classification === "overgraded").slice(0, 10).map(example),
      undergraded: rows.filter((row) => row.alignment.classification === "undergraded").slice(0, 10).map(example),
      copyOnlyOrRiskOnly: [...copyOnly, ...riskOnly].slice(0, 10).map(example),
      helped: impact.helpedExamples,
      hurt: impact.hurtExamples,
    },
    judgmentInputs: {
      improvedActionableUnits: impact.unitsImpact > 0,
      onlyReducedVolume: impact.actionabilityChanged > 0 && impact.winnersPromoted === 0 && impact.losersPromoted === 0,
      preservedVolume: impact.actionabilityChanged === 0,
      unsupportedProfitabilityTuningWarning: "This is deterministic validation over one completed slate only; do not tune live profitability from this sample alone.",
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Daily Edge Result-Backed Validation — ${args.sport} ${args.date}`);
  console.log(JSON.stringify({
    leakageBoundary: report.leakageBoundary,
    evidenceSource: report.evidenceSource,
    predictionRows: report.predictionRows,
    resultJoin: report.resultJoin,
    originalBestAngle: report.originalBestAngle,
    originalLean: report.originalLean,
    originalActionable: report.originalActionable,
    suggestedActionable: report.suggestedActionable,
    gradeAlignment: report.gradeAlignment,
    unitsRoiCounterfactual: report.unitsRoiCounterfactual,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
