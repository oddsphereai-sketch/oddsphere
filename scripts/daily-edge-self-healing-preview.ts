import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
} from "@/lib/services/aiAuditor/costPreview";
import { sanitizeDailyEdgeAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import { sharpContextStatusForEvidence } from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { getCurrentOrLastKnownLine } from "@/lib/services/lastKnownGoodReader";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", date: "2026-06-30", markets: "ML,TOTAL,FI", json: false };
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

function countBy<T>(rows: T[], keyFn: (row: T) => unknown): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(keyFn(row) ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function pct(count: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function label(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function sideForRecovery(row: PredictionEvidenceObject): "home" | "away" | "over" | "under" | null {
  const pick = String(row.identity.pick ?? "").toLowerCase();
  if (row.identity.marketType === "TOTAL") {
    if (pick.includes("over")) return "over";
    if (pick.includes("under")) return "under";
  }
  if (row.identity.marketType === "FI") {
    if (pick.includes("yrfi") || pick.includes("over")) return "over";
    if (pick.includes("nrfi") || pick.includes("under")) return "under";
  }
  if (row.identity.marketType === "ML") {
    if (pick === String(row.identity.homeTeam ?? "").toLowerCase()) return "home";
    if (pick === String(row.identity.awayTeam ?? "").toLowerCase()) return "away";
  }
  return null;
}

function marketTypeForRecovery(row: PredictionEvidenceObject): "moneyline" | "total" | "first_inning_total" | null {
  if (row.identity.marketType === "ML") return "moneyline";
  if (row.identity.marketType === "TOTAL") return "total";
  if (row.identity.marketType === "FI") return "first_inning_total";
  return null;
}

function isFiTossUp(row: PredictionEvidenceObject): boolean {
  return row.identity.marketType === "FI" && /toss[\s-]*up/i.test(String(row.identity.pick ?? ""));
}

async function recoverPriceDiagnostic(row: PredictionEvidenceObject) {
  if (row.priceValueEvidence.priceAmerican !== null) {
    return {
      status: row.priceValueEvidence.priceSource === "locked_snapshot" ? "fi_price_recovered_from_snapshot" : "price_present",
      recoveredPrice: row.priceValueEvidence.priceAmerican,
      source: row.priceValueEvidence.priceSource,
      observedAt: row.evidenceSource.asOfTimestamp,
      note: "Price already present in selected evidence.",
    };
  }
  if (isFiTossUp(row)) {
    return {
      status: "fi_toss_up_price_not_required",
      recoveredPrice: null,
      source: null,
      observedAt: row.evidenceSource.asOfTimestamp,
      note: "FI Toss-Up has no actionable YRFI/NRFI side, so a picked-side price is not required and should not be treated as a data gap.",
    };
  }
  const side = sideForRecovery(row);
  const marketType = marketTypeForRecovery(row);
  const gameId = Number(row.identity.externalId);
  if (!side || !marketType || !Number.isFinite(gameId)) {
    return {
      status: row.evidenceSource.kind === "locked_snapshot" ? "fi_price_missing_locked_snapshot" : "fi_price_not_offered_or_unavailable",
      recoveredPrice: null,
      source: null,
      observedAt: null,
      note: "Cannot derive a trusted recovery key for this prediction.",
    };
  }
  const { supabase } = await import("@/lib/db/supabase");
  const lkg = await getCurrentOrLastKnownLine({
    supabase,
    gameId,
    marketType,
    side,
    field: "odds_american",
  });
  if (lkg.value !== null) {
    return {
      status: lkg.source === "history" ? "fi_price_recovered_from_history" : "price_recovered_from_current_source",
      recoveredPrice: lkg.value,
      source: lkg.source,
      observedAt: lkg.observed_at,
      stale: lkg.is_stale,
      note: "Recovered for QA from trusted current/history line source. Not written to production by this preview.",
    };
  }
  const { data } = await supabase
    .from("prediction_records")
    .select("odds_american,locked_at,snapshot_json")
    .eq("sport", row.identity.sport)
    .eq("slate_date", row.identity.slateDate)
    .eq("external_id", row.identity.externalId)
    .eq("market", row.identity.normalizedMarket)
    .not("odds_american", "is", null)
    .limit(1);
  const record = Array.isArray(data) ? data[0] as { odds_american?: number | null; locked_at?: string | null; snapshot_json?: unknown } | undefined : undefined;
  if (typeof record?.odds_american === "number") {
    return {
      status: "price_recovered_from_prediction_record",
      recoveredPrice: record.odds_american,
      source: "prediction_records",
      observedAt: record.locked_at ?? null,
      note: "Recovered for QA from existing prediction record. Not written to production by this preview.",
    };
  }
  return {
    status: row.evidenceSource.kind === "locked_snapshot" ? "fi_price_missing_locked_snapshot" : `${row.identity.marketType === "FI" ? "fi_" : ""}price_not_offered_or_unavailable`,
    recoveredPrice: null,
    source: null,
    observedAt: null,
    note: "No trusted current, history, prediction record, or selected evidence price found.",
  };
}

function coverage(rows: PredictionEvidenceObject[]) {
  const rowCount = rows.length;
  const c = (fn: (row: PredictionEvidenceObject) => boolean) => rows.filter(fn).length;
  const actionableRows = rows.filter((row) => !(row.identity.marketType === "FI" && (isFiTossUp(row) || row.identity.pick === null)));
  const actionableCount = actionableRows.length;
  const actionable = (fn: (row: PredictionEvidenceObject) => boolean) => actionableRows.filter(fn).length;
  return {
    rows: rowCount,
    price: { count: c((row) => row.priceValueEvidence.priceAmerican !== null), pct: pct(c((row) => row.priceValueEvidence.priceAmerican !== null), rowCount) },
    modelProbability: { count: c((row) => row.modelStatsEvidence.modelProbability !== null), pct: pct(c((row) => row.modelStatsEvidence.modelProbability !== null), rowCount) },
    marketImplied: { count: c((row) => row.modelStatsEvidence.marketImpliedProbability !== null), pct: pct(c((row) => row.modelStatsEvidence.marketImpliedProbability !== null), rowCount) },
    edge: { count: c((row) => row.modelStatsEvidence.edge !== null), pct: pct(c((row) => row.modelStatsEvidence.edge !== null), rowCount) },
    lineMovement: {
      count: c((row) =>
        row.marketEvidence.lineMovement.currentAmerican !== null ||
        row.marketEvidence.lineMovement.lockedAmerican !== null ||
        row.marketEvidence.lineMovement.currentLine !== null ||
        row.marketEvidence.lineMovement.openAmerican !== null
      ),
      pct: pct(c((row) =>
        row.marketEvidence.lineMovement.currentAmerican !== null ||
        row.marketEvidence.lineMovement.lockedAmerican !== null ||
        row.marketEvidence.lineMovement.currentLine !== null ||
        row.marketEvidence.lineMovement.openAmerican !== null
      ), rowCount),
    },
    consensus: { count: c((row) => row.marketEvidence.consensusSplitsAvailable), pct: pct(c((row) => row.marketEvidence.consensusSplitsAvailable), rowCount) },
    sharpFullSplits: { count: c((row) => row.marketEvidence.sharpBookSplitsAvailable), pct: pct(c((row) => row.marketEvidence.sharpBookSplitsAvailable), rowCount) },
    sharpSignal: { count: c((row) => row.marketEvidence.sharpBookSignalAvailable), pct: pct(c((row) => row.marketEvidence.sharpBookSignalAvailable), rowCount) },
    sharpAny: { count: c((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable), pct: pct(c((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable), rowCount) },
    marketRead: { count: c((row) => row.marketEvidence.marketReadRaw !== null), pct: pct(c((row) => row.marketEvidence.marketReadRaw !== null), rowCount) },
    actionableRows: actionableCount,
    actionablePrice: { count: actionable((row) => row.priceValueEvidence.priceAmerican !== null), pct: pct(actionable((row) => row.priceValueEvidence.priceAmerican !== null), actionableCount) },
    actionableMarketImplied: { count: actionable((row) => row.modelStatsEvidence.marketImpliedProbability !== null), pct: pct(actionable((row) => row.modelStatsEvidence.marketImpliedProbability !== null), actionableCount) },
    actionableEdge: { count: actionable((row) => row.modelStatsEvidence.edge !== null), pct: pct(actionable((row) => row.modelStatsEvidence.edge !== null), actionableCount) },
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
  const rows = selection.evidence.map((evidence) => {
    const evidenceReview = reviewPredictionEvidence(evidence);
    const marketIntelligence = interpretMarketIntelligence(evidence);
    const healed = selfHealDailyEdgePrediction({ evidence, evidenceReview, marketIntelligence, sanitizerResult: null });
    const sanitizer = sanitizeDailyEdgeAiOutput(evidence, {
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
    return { evidence, evidenceReview, marketIntelligence, healed, sanitizer };
  });
  const priceGapDiagnostics = await Promise.all(rows
    .filter((row) => row.evidence.priceValueEvidence.priceAmerican === null)
    .map(async (row) => ({
      game: label(row.evidence),
      market: row.evidence.identity.normalizedMarket,
      pick: row.evidence.identity.pick,
      currentGrade: row.evidence.identity.originalPlayGrade,
      line: row.evidence.identity.lineValue,
      priceMissingReason: row.evidence.priceValueEvidence.priceNullReason,
      modelProbability: row.evidence.modelStatsEvidence.modelProbability,
      edge: row.evidence.modelStatsEvidence.edge,
      marketImplied: row.evidence.modelStatsEvidence.marketImpliedProbability,
      evidenceSource: row.evidence.evidenceSource.kind,
      recovery: await recoverPriceDiagnostic(row.evidence),
      reviewImpact: row.evidence.identity.marketType === "FI"
        ? "allow FI copy/review from model/context, block grade strengthening from price"
        : "allow copy/market-read review if other evidence is usable, block grade-change review until price is recovered",
    })));

  const report = {
    mode: "daily_edge_self_healing_preview",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    appliedRows: 0,
    sport: args.sport,
    date: args.date,
    markets,
    gameCount: new Set(rows.map((row) => row.evidence.identity.gameId)).size,
    predictionCount: rows.length,
    evidenceSource: selection.selectionSummary,
    currentPreLockVsLocked: {
      selectedLockedRows: selection.selectionSummary.selectedLockedRows,
      selectedCurrentLiveRows: selection.selectionSummary.selectedCurrentLiveRows,
    },
    evidenceCompleteness: {
      moneyline: coverage(rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline").map((row) => row.evidence)),
      total: coverage(rows.filter((row) => row.evidence.identity.normalizedMarket === "total").map((row) => row.evidence)),
      first_inning: coverage(rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning").map((row) => row.evidence)),
    },
    sharpContextRecovery: {
      moneyline: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
      total: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "total"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
      firstInning: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
      recoveredSharpCount: rows.filter((row) => sharpContextStatusForEvidence(row.evidence) === "sharp_context_recovered").length,
      unrecoveredMlTotalSharpCount: rows.filter((row) =>
        row.evidence.identity.marketType !== "FI" &&
        !["sharp_full_splits_available", "sharp_signal_available", "sharp_context_recovered"].includes(sharpContextStatusForEvidence(row.evidence))
      ).length,
    },
    evidenceQualityDistribution: countBy(rows, (row) => row.evidenceReview.evidenceQuality),
    reviewModeDistribution: countBy(rows, (row) => row.evidenceReview.reviewModeAllowed),
    selfHealingRepairsAttempted: rows.reduce((sum, row) => sum + row.healed.repairActions.length, 0),
    selfHealingRepairsApplied: rows.reduce((sum, row) => sum + row.healed.repairActions.filter((action) => action.repairApplied).length, 0),
    repairTypes: countBy(rows.flatMap((row) => row.healed.repairActions), (action) => action.repairType),
    revalidationStatus: countBy(rows, (row) => row.healed.revalidationStatus),
    unresolvedIssues: countBy(rows.flatMap((row) => row.healed.unresolvedIssues), (issue) => issue),
    priceGapDiagnostics,
    priceRecoveryStatus: countBy(priceGapDiagnostics, (row) => row.recovery.status),
    copySafetyFindings: countBy(rows.flatMap((row) => row.sanitizer.blockedReasons), (reason) => reason),
    fiGenericCopyFindings: rows.filter((row) =>
      row.evidence.identity.marketType === "FI" &&
      row.sanitizer.blockedReasons.some((reason) => reason === "fi_generic_no_signal_copy" || reason === "fi_copy_lacks_prediction_specific_context")
    ).length,
    providerOrHypeFindings: rows.filter((row) =>
      row.sanitizer.blockedReasons.some((reason) =>
        reason === "provider_or_source_leak" ||
        reason === "provider_name_leak" ||
        reason === "betting_hype_language" ||
        reason === "copy_overclaims_sharp_signal"
      )
    ).length,
    examples: rows.slice(0, 12).map((row) => ({
      game: label(row.evidence),
      market: row.evidence.identity.normalizedMarket,
      pick: row.evidence.identity.pick,
      originalGrade: row.evidence.identity.originalPlayGrade,
      evidenceSource: row.evidence.evidenceSource.kind,
      evidenceQuality: row.evidenceReview.evidenceQuality,
      marketReadLabel: row.healed.repairedReaderFields.marketReadLabel,
      marketReadCopy: row.healed.repairedReaderFields.marketReadCopy,
      supportingEvidenceCopy: row.healed.repairedReaderFields.supportingEvidenceCopy,
      riskCopy: row.healed.repairedReaderFields.riskCopy,
      unresolvedIssues: row.healed.unresolvedIssues,
      sanitizerFindings: row.sanitizer.blockedReasons,
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Daily Edge Self-Healing Preview — ${args.sport} ${args.date}`);
    console.log(JSON.stringify({
    gameCount: report.gameCount,
    predictionCount: report.predictionCount,
    evidenceSource: report.evidenceSource,
    evidenceCompleteness: report.evidenceCompleteness,
    selfHealingRepairsAttempted: report.selfHealingRepairsAttempted,
    selfHealingRepairsApplied: report.selfHealingRepairsApplied,
    revalidationStatus: report.revalidationStatus,
    unresolvedIssues: report.unresolvedIssues,
    priceRecoveryStatus: report.priceRecoveryStatus,
    priceGapDiagnostics: report.priceGapDiagnostics,
    copySafetyFindings: report.copySafetyFindings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
