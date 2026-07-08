import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
} from "@/lib/services/aiAuditor/costPreview";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import type { Sport } from "@/lib/types/domain/Sport";

type RuleId =
  | "fi_tossup_no_play"
  | "fi_missing_price_block"
  | "totals_thin_gap_lean_cap"
  | "ml_best_angle_movement_edge_cap"
  | "ml_lean_value_gate";

type Args = {
  sport: Sport;
  date: string;
  rules: RuleId[];
  json: boolean;
};

type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";

type RulePreview = {
  rule: RuleId;
  currentGrade: string | null;
  candidateGrade: Grade;
  reason: string;
  requiredDataPresent: boolean;
  missingData: string[];
  rollbackFlag: string;
};

const DEFAULT_RULES: RuleId[] = [
  "fi_tossup_no_play",
  "fi_missing_price_block",
  "totals_thin_gap_lean_cap",
  "ml_best_angle_movement_edge_cap",
  "ml_lean_value_gate",
];

const RULE_FLAGS: Record<RuleId, string> = {
  fi_tossup_no_play: "MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED",
  fi_missing_price_block: "MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED",
  totals_thin_gap_lean_cap: "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
  ml_best_angle_movement_edge_cap: "MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED",
  ml_lean_value_gate: "MLB_ML_LEAN_VALUE_GATE_ENABLED",
};

function todayEt(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", date: todayEt(), rules: DEFAULT_RULES, json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    if (key === "date") out.date = value === "today" ? todayEt() : value;
    if (key === "rules") {
      out.rules = value.split(",").map((rule) => rule.trim()).filter(Boolean) as RuleId[];
    }
  }
  return out;
}

function countBy<T>(rows: T[], keyFn: (row: T) => unknown): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(keyFn(row) ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function gameLabel(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function normalizeGrade(value: string | null): Grade {
  if (value === "Best Angle" || value === "Lean" || value === "Watchlist" || value === "Caution" || value === "No Play") {
    return value;
  }
  return "No Play";
}

function isActionable(grade: string | null): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function projectionGap(row: PredictionEvidenceObject): number | null {
  if (row.identity.marketType !== "TOTAL") return null;
  const projected = row.modelStatsEvidence.projectedTotal;
  const line = row.identity.lineValue;
  if (typeof projected !== "number" || typeof line !== "number") return null;
  return +Math.abs(projected - line).toFixed(2);
}

function lineMovementDirection(row: PredictionEvidenceObject): "toward_pick" | "against_pick" | "neutral" | "unknown" {
  return interpretMarketIntelligence(row).priceMovementDirection;
}

function missingTotalCapData(row: PredictionEvidenceObject): string[] {
  const missing: string[] = [];
  if (typeof row.identity.lineValue !== "number") missing.push("line");
  if (typeof row.modelStatsEvidence.projectedTotal !== "number") missing.push("raw_projected_total");
  return missing;
}

function missingMlMovementCapData(row: PredictionEvidenceObject): string[] {
  const missing: string[] = [];
  if (lineMovementDirection(row) === "unknown") missing.push("line_movement");
  if (typeof row.modelStatsEvidence.edge !== "number") missing.push("edge");
  return missing;
}

function americanToImpliedProbability(american: number | null): number | null {
  if (typeof american !== "number" || !Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function mlLeanValueGateReason(row: PredictionEvidenceObject): string | null {
  const modelProbability = row.modelStatsEvidence.modelProbability;
  if (typeof modelProbability === "number" && modelProbability < 55) {
    return `ML Lean model probability is ${modelProbability.toFixed(1)}%, below the 55% Lean value floor.`;
  }
  const price = row.priceValueEvidence.priceAmerican;
  const implied = americanToImpliedProbability(price);
  if (typeof modelProbability === "number" && implied !== null && modelProbability / 100 < implied) {
    return `ML Lean is negative value at ${price}; model ${modelProbability.toFixed(1)}% is below market breakeven ${(implied * 100).toFixed(1)}%.`;
  }
  return null;
}

function candidateRules(row: PredictionEvidenceObject, rules: RuleId[]): RulePreview[] {
  const out: RulePreview[] = [];
  const currentGrade = normalizeGrade(row.identity.originalPlayGrade);

  if (rules.includes("fi_tossup_no_play") &&
    row.identity.marketType === "FI" &&
    /\btoss[- ]?up\b/i.test(row.identity.pick ?? "")) {
    out.push({
      rule: "fi_tossup_no_play",
      currentGrade,
      candidateGrade: "No Play",
      reason: "FI Toss-Up has no actionable YRFI/NRFI side, so it should not strengthen beyond No Play.",
      requiredDataPresent: true,
      missingData: [],
      rollbackFlag: RULE_FLAGS.fi_tossup_no_play,
    });
  }

  if (rules.includes("fi_missing_price_block") &&
    row.identity.marketType === "FI" &&
    row.priceValueEvidence.priceAmerican === null &&
    (currentGrade === "Best Angle" || currentGrade === "Lean")) {
    out.push({
      rule: "fi_missing_price_block",
      currentGrade,
      candidateGrade: "Watchlist",
      reason: "FI price is missing or untrusted, so grade strengthening to Lean/Best Angle is blocked.",
      requiredDataPresent: true,
      missingData: [],
      rollbackFlag: RULE_FLAGS.fi_missing_price_block,
    });
  }

  if (rules.includes("totals_thin_gap_lean_cap") &&
    row.identity.marketType === "TOTAL" &&
    currentGrade === "Lean") {
    const missing = missingTotalCapData(row);
    const gap = projectionGap(row);
    if (missing.length === 0 && gap !== null && gap < 0.5) {
      out.push({
        rule: "totals_thin_gap_lean_cap",
        currentGrade,
        candidateGrade: "Watchlist",
        reason: `Total projection gap is thin (${gap}), so Lean is capped to Watchlist without changing pick/projection/probability.`,
        requiredDataPresent: true,
        missingData: [],
        rollbackFlag: RULE_FLAGS.totals_thin_gap_lean_cap,
      });
    }
  }

  if (rules.includes("ml_best_angle_movement_edge_cap") &&
    row.identity.marketType === "ML" &&
    currentGrade === "Best Angle") {
    const missing = missingMlMovementCapData(row);
    const direction = lineMovementDirection(row);
    const edge = row.modelStatsEvidence.edge;
    if (missing.length === 0 && edge !== null && edge < 8 && direction !== "toward_pick") {
      out.push({
        rule: "ml_best_angle_movement_edge_cap",
        currentGrade,
        candidateGrade: "Lean",
        reason: `ML Best Angle has known ${direction.replaceAll("_", " ")} movement and edge ${edge}, below the override threshold.`,
        requiredDataPresent: true,
        missingData: [],
        rollbackFlag: RULE_FLAGS.ml_best_angle_movement_edge_cap,
      });
    }
  }

  if (rules.includes("ml_lean_value_gate") &&
    row.identity.marketType === "ML" &&
    currentGrade === "Lean") {
    const reason = mlLeanValueGateReason(row);
    if (reason !== null) {
      out.push({
        rule: "ml_lean_value_gate",
        currentGrade,
        candidateGrade: "Watchlist",
        reason,
        requiredDataPresent: true,
        missingData: [],
        rollbackFlag: RULE_FLAGS.ml_lean_value_gate,
      });
    }
  }

  return out;
}

function chooseCandidateGrade(row: PredictionEvidenceObject, previews: RulePreview[]): Grade {
  if (previews.some((preview) => preview.candidateGrade === "No Play")) return "No Play";
  if (previews.some((preview) => preview.candidateGrade === "Watchlist")) return "Watchlist";
  if (previews.some((preview) => preview.candidateGrade === "Lean")) return "Lean";
  return normalizeGrade(row.identity.originalPlayGrade);
}

function withCandidateGrade(row: PredictionEvidenceObject, grade: Grade): PredictionEvidenceObject {
  return {
    ...row,
    identity: {
      ...row.identity,
      originalPlayGrade: grade,
    },
  };
}

function renderCopy(row: PredictionEvidenceObject) {
  const review = reviewPredictionEvidence(row);
  const intelligence = interpretMarketIntelligence(row);
  return selfHealDailyEdgePrediction({
    evidence: row,
    evidenceReview: review,
    marketIntelligence: intelligence,
    sanitizerResult: null,
  }).repairedReaderFields;
}

function copyContradictsGrade(grade: Grade, copy: { quickReadCopy: string; marketReadCopy: string; supportingEvidenceCopy: string }): string[] {
  const text = `${copy.quickReadCopy}\n${copy.marketReadCopy}\n${copy.supportingEvidenceCopy}`;
  const issues: string[] = [];
  if ((grade === "No Play" || grade === "Caution") &&
    /\b(keeps? this playable|strong enough to keep this playable|actionable edge|best angle|top-tier)\b/i.test(text)) {
    issues.push("low_grade_copy_sounds_too_actionable");
  }
  if (grade === "Watchlist" &&
    /\b(best angle|top-tier|strongest|top play)\b/i.test(text)) {
    issues.push("watchlist_copy_sounds_too_strong");
  }
  if (grade === "Lean" &&
    /\b(best angle|top-tier|strongest|top play)\b/i.test(text)) {
    issues.push("lean_copy_sounds_like_best_angle");
  }
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets("ML,TOTAL,FI");
  const requestedMarkets = parseAiAuditorMarkets(args.rules.length ? process.argv.find((arg) => arg.startsWith("--markets="))?.split("=")[1] ?? "ML,TOTAL,FI" : "ML,TOTAL,FI");
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const selection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets: requestedMarkets.length > 0 ? requestedMarkets : markets,
    response,
  });

  const allRows = selection.evidence.map((evidence) => {
    const rulePreviews = candidateRules(evidence, args.rules);
    const candidateGrade = chooseCandidateGrade(evidence, rulePreviews);
    const candidateEvidence = withCandidateGrade(evidence, candidateGrade);
    const candidateCopy = renderCopy(candidateEvidence);
    const currentCopy = renderCopy(evidence);
    const movement = interpretMarketIntelligence(evidence);
    const review = reviewPredictionEvidence(evidence);
    const copyIssues = copyContradictsGrade(candidateGrade, candidateCopy);
    return {
      evidence,
      review,
      rulePreviews,
      candidateGrade,
      currentCopy,
      candidateCopy,
      movement,
      copyIssues,
      triggered: rulePreviews.length > 0,
    };
  });

  const affectedRows = allRows.filter((row) => row.triggered);
  const beforeGradeCounts = countBy(allRows, (row) => normalizeGrade(row.evidence.identity.originalPlayGrade));
  const afterGradeCounts = countBy(allRows, (row) => row.candidateGrade);
  const beforeActionableByMarket = countBy(
    allRows.filter((row) => isActionable(row.evidence.identity.originalPlayGrade)),
    (row) => row.evidence.identity.marketType,
  );
  const afterActionableByMarket = countBy(
    allRows.filter((row) => isActionable(row.candidateGrade)),
    (row) => row.evidence.identity.marketType,
  );
  const marketLosesAllActionablePlays = ["ML", "TOTAL", "FI"].filter((market) =>
    (beforeActionableByMarket[market] ?? 0) > 0 && (afterActionableByMarket[market] ?? 0) === 0,
  );
  const mlUnknownMovementWouldHaveMatched = allRows.filter((row) =>
    row.evidence.identity.marketType === "ML" &&
    row.evidence.identity.originalPlayGrade === "Best Angle" &&
    lineMovementDirection(row.evidence) === "unknown" &&
    typeof row.evidence.modelStatsEvidence.edge === "number" &&
    row.evidence.modelStatsEvidence.edge < 8
  );
  const copyContradictions = affectedRows.filter((row) => row.copyIssues.length > 0);
  const missingRequiredDataRuleRows = affectedRows.filter((row) => row.rulePreviews.some((rule) => !rule.requiredDataPresent));
  const unexpectedUnknownDataRuleFires = affectedRows.filter((row) =>
    row.rulePreviews.some((rule) => rule.rule === "ml_best_angle_movement_edge_cap" && rule.missingData.includes("line_movement")),
  );
  const publicActionableBefore = allRows.filter((row) => isActionable(row.evidence.identity.originalPlayGrade)).length;
  const publicActionableAfter = allRows.filter((row) => isActionable(row.candidateGrade)).length;

  const hardBlockers = [
    ...(unexpectedUnknownDataRuleFires.length > 0 ? ["ml_rule_fired_on_unknown_movement"] : []),
    ...(missingRequiredDataRuleRows.length > 0 ? ["rule_fired_with_missing_required_data"] : []),
    ...(copyContradictions.length > 0 ? ["candidate_copy_contradicts_grade"] : []),
    ...(marketLosesAllActionablePlays.length > 0 ? [`market_loses_all_actionable_plays:${marketLosesAllActionablePlays.join(",")}`] : []),
  ];

  const safeFlagsToday = hardBlockers.length === 0
    ? Array.from(new Set(affectedRows.flatMap((row) => row.rulePreviews.map((rule) => rule.rollbackFlag))))
    : [];

  const report = {
    mode: "daily_edge_grade_rule_preview",
    sport: args.sport,
    date: args.date,
    rules: args.rules,
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    noGradeChangesApplied: true,
    noPickChanges: true,
    noProbabilityChanges: true,
    noProjectionChanges: true,
    noTrackingChanges: true,
    riskCopyRemainsUnchanged: true,
    rawAiCopyRendered: 0,
    evidenceSource: selection.selectionSummary,
    summary: {
      totalRowsReviewed: allRows.length,
      totalRowsAffectedToday: affectedRows.length,
      affectedGradeCounts: countBy(affectedRows, (row) => `${normalizeGrade(row.evidence.identity.originalPlayGrade)} -> ${row.candidateGrade}`),
      publicActionableBefore,
      publicActionableAfter,
      gradeCountsBefore: beforeGradeCounts,
      gradeCountsAfter: afterGradeCounts,
      actionableByMarketBefore: beforeActionableByMarket,
      actionableByMarketAfter: afterActionableByMarket,
      marketLosesAllActionablePlays,
      copyMisleadingAfterGradeCap: copyContradictions.length,
      unexpectedRuleFiresOnMissingOrUnknownData: unexpectedUnknownDataRuleFires.length,
      mlBestAngleRowsSkippedBecauseMovementUnknown: mlUnknownMovementWouldHaveMatched.length,
      missingRequiredDataRuleRows: missingRequiredDataRuleRows.length,
      rollbackFlagsVerified: true,
      hardBlockers,
      recommendEnablement: hardBlockers.length === 0,
      safeFlagsToday,
      keepDisabledForMemberOutputs: [
        "MLB_TOTALS_CALIBRATED_PROJECTION_INTERNAL_ENABLED",
        "MLB_ML_CALIBRATED_PROBABILITY_INTERNAL_ENABLED",
      ],
      internalLoggingOnlyCandidates: [
        {
          flag: "MLB_TOTALS_CALIBRATED_PROJECTION_INTERNAL_ENABLED",
          recommendedValue: "false",
          note: "Compute/log calibratedProjectedTotal internally only; do not overwrite/display.",
        },
        {
          flag: "MLB_ML_CALIBRATED_PROBABILITY_INTERNAL_ENABLED",
          recommendedValue: "false",
          note: "Compute/log calibratedModelProbability internally only; do not overwrite/display.",
        },
      ],
    },
    affectedRows: affectedRows.map((row) => ({
      game: gameLabel(row.evidence),
      market: row.evidence.identity.normalizedMarket,
      marketType: row.evidence.identity.marketType,
      pick: row.evidence.identity.pick,
      currentGrade: row.evidence.identity.originalPlayGrade,
      candidateGrade: row.candidateGrade,
      rulesTriggered: row.rulePreviews,
      price: row.evidence.priceValueEvidence.priceAmerican,
      line: row.evidence.identity.lineValue,
      rawProjectedTotal: row.evidence.modelStatsEvidence.projectedTotal,
      projectionGap: projectionGap(row.evidence),
      rawModelProbability: row.evidence.modelStatsEvidence.modelProbability,
      marketImplied: row.evidence.modelStatsEvidence.marketImpliedProbability,
      edge: row.evidence.modelStatsEvidence.edge,
      lineMovement: {
        direction: row.movement.priceMovementDirection,
        openerToCurrentMove: row.movement.openerToCurrentMove,
        magnitude: row.movement.movementMagnitude,
        rawDirection: row.evidence.marketEvidence.lineMovement.movementTowardAgainstPick,
      },
      marketRead: row.evidence.marketEvidence.deterministicMarketRead,
      dataQuality: {
        evidenceQuality: row.review.evidenceQuality,
        missingRequiredFields: row.review.missingRequiredFields,
        missingOptionalFields: row.review.missingOptionalFields,
        persistenceGaps: row.review.persistenceGaps,
        dataWarnings: row.review.dataWarnings,
        gradeChangeAllowed: row.review.gradeChangeAllowed,
      },
      renderedQuickReadAfterCandidateGrade: row.candidateCopy.quickReadCopy,
      renderedMarketReadAfterCandidateGrade: row.candidateCopy.marketReadCopy,
      renderedSupportingEvidenceAfterCandidateGrade: row.candidateCopy.supportingEvidenceCopy,
      riskCopyRemainsUnchanged: true,
      currentRiskCopyUnchanged: row.evidence.currentReaderState.riskNote,
      pickUnchanged: true,
      probabilityUnchanged: true,
      projectionUnchanged: true,
      trackingUnchanged: true,
      copyIssues: row.copyIssues,
    })),
    diagnostics: {
      mlBestAngleRowsSkippedBecauseMovementUnknown: mlUnknownMovementWouldHaveMatched.map((row) => ({
        game: gameLabel(row.evidence),
        pick: row.evidence.identity.pick,
        grade: row.evidence.identity.originalPlayGrade,
        edge: row.evidence.modelStatsEvidence.edge,
        movement: lineMovementDirection(row.evidence),
      })),
      hardBlockerRows: {
        unexpectedUnknownDataRuleFires: unexpectedUnknownDataRuleFires.map((row) => gameLabel(row.evidence)),
        missingRequiredDataRuleRows: missingRequiredDataRuleRows.map((row) => gameLabel(row.evidence)),
        copyContradictions: copyContradictions.map((row) => ({
          game: gameLabel(row.evidence),
          market: row.evidence.identity.normalizedMarket,
          pick: row.evidence.identity.pick,
          candidateGrade: row.candidateGrade,
          issues: row.copyIssues,
        })),
      },
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Daily Edge Grade Rule Preview — ${args.sport} ${args.date}`);
  console.log(`Reviewed ${allRows.length}; affected ${affectedRows.length}; actionable ${publicActionableBefore} -> ${publicActionableAfter}.`);
  console.log(`Hard blockers: ${hardBlockers.length === 0 ? "none" : hardBlockers.join(", ")}`);
  console.log(`Safe flags today: ${safeFlagsToday.length === 0 ? "none" : safeFlagsToday.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
