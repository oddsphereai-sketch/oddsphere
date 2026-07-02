import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { sharpContextStatusForEvidence } from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import type { Sport } from "@/lib/types/domain/Sport";

export type DailyEdgeDataHealthSeverity = "info" | "medium" | "high" | "blocking";

export type DailyEdgeDataHealthFinding = {
  severity: DailyEdgeDataHealthSeverity;
  code: string;
  sport: Sport;
  date: string;
  game: string;
  market: string;
  pick: string | null;
  evidenceSource: "current_live" | "locked_snapshot";
  message: string;
  details?: Record<string, unknown>;
};

export type DailyEdgeDataHealthReport = {
  mode: "daily_edge_data_health_monitor";
  noOpenAiCalls: true;
  noPredictionChanges: true;
  noGradeChanges: true;
  noTrackingChanges: true;
  sport: Sport;
  date: string;
  markets: AiAuditorMarketKey[];
  gameCount: number;
  predictionCount: number;
  evidenceSource: {
    sourceOfTruth: "locked_snapshot_preferred";
    lockedSnapshotRows: number;
    currentLiveRows: number;
    selectedLockedRows: number;
    selectedCurrentLiveRows: number;
    note: string;
  };
  coverage: Record<string, MarketCoverage>;
  findings: DailyEdgeDataHealthFinding[];
  bySeverity: Record<string, number>;
  byCode: Record<string, number>;
  unresolvedBlockingOrHigh: number;
  safeForNormalReaderDisplay: boolean;
};

type MarketCoverage = {
  rows: number;
  actionableRows: number;
  price: string;
  actionablePrice: string;
  modelProbability: string;
  actionableMarketImplied: string;
  actionableEdge: string;
  lineMovement: string;
  consensus: string;
  sharpAny: string;
  marketRead: string;
  strongOrUsable: string;
};

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = keyFn(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function pct(count: number, total: number): string {
  if (total === 0) return "0/0";
  return `${count}/${total} (${((count / total) * 100).toFixed(1)}%)`;
}

function gameLabel(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function isFiTossUp(row: PredictionEvidenceObject): boolean {
  return row.identity.marketType === "FI" && /toss[\s-]*up/i.test(String(row.identity.pick ?? ""));
}

function isActionableRow(row: PredictionEvidenceObject): boolean {
  if (row.identity.marketType === "FI" && (isFiTossUp(row) || row.identity.pick === null)) return false;
  return row.identity.pick !== null;
}

function hasLineMovement(row: PredictionEvidenceObject): boolean {
  return row.marketEvidence.lineMovement.movementTowardAgainstPick !== null ||
    row.marketEvidence.lineMovement.currentAmerican !== null ||
    row.marketEvidence.lineMovement.lockedAmerican !== null ||
    row.marketEvidence.lineMovement.openAmerican !== null ||
    row.marketEvidence.lineMovement.currentLine !== null;
}

function coverage(rows: PredictionEvidenceObject[]): MarketCoverage {
  const reviews = rows.map((row) => reviewPredictionEvidence(row));
  const actionables = rows.filter(isActionableRow);
  const c = (fn: (row: PredictionEvidenceObject) => boolean) => rows.filter(fn).length;
  const a = (fn: (row: PredictionEvidenceObject) => boolean) => actionables.filter(fn).length;
  return {
    rows: rows.length,
    actionableRows: actionables.length,
    price: pct(c((row) => row.priceValueEvidence.priceAmerican !== null), rows.length),
    actionablePrice: pct(a((row) => row.priceValueEvidence.priceAmerican !== null), actionables.length),
    modelProbability: pct(c((row) => row.modelStatsEvidence.modelProbability !== null), rows.length),
    actionableMarketImplied: pct(a((row) => row.modelStatsEvidence.marketImpliedProbability !== null), actionables.length),
    actionableEdge: pct(a((row) => row.modelStatsEvidence.edge !== null), actionables.length),
    lineMovement: pct(c(hasLineMovement), rows.length),
    consensus: pct(c((row) => row.marketEvidence.consensusSplitsAvailable), rows.length),
    sharpAny: pct(c((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable), rows.length),
    marketRead: pct(c((row) => row.marketEvidence.marketReadRaw !== null), rows.length),
    strongOrUsable: pct(reviews.filter((review) => review.evidenceQuality === "strong" || review.evidenceQuality === "usable").length, reviews.length),
  };
}

function pushFinding(
  findings: DailyEdgeDataHealthFinding[],
  row: PredictionEvidenceObject,
  code: string,
  severity: DailyEdgeDataHealthSeverity,
  message: string,
  details?: Record<string, unknown>,
) {
  findings.push({
    severity,
    code,
    sport: row.identity.sport as Sport,
    date: row.identity.slateDate,
    game: gameLabel(row),
    market: row.identity.normalizedMarket,
    pick: row.identity.pick,
    evidenceSource: row.evidenceSource.kind,
    message,
    details: {
      gameId: row.identity.gameId,
      externalId: row.identity.externalId,
      gameTime: row.identity.gameTime,
      marketType: row.identity.marketType,
      ...details,
    },
  });
}

function collectFindings(rows: PredictionEvidenceObject[]): DailyEdgeDataHealthFinding[] {
  const findings: DailyEdgeDataHealthFinding[] = [];
  for (const row of rows) {
    const review = reviewPredictionEvidence(row);
    const actionable = isActionableRow(row);
    const sharpStatus = sharpContextStatusForEvidence(row);
    if (review.evidenceQuality === "blocked") {
      pushFinding(findings, row, "evidence_blocked", "blocking", "Prediction evidence is blocked for review/display quality.", {
        missingRequiredFields: review.missingRequiredFields,
        persistenceGaps: review.persistenceGaps,
        dataWarnings: review.dataWarnings,
      });
    }
    if (row.identity.marketType === "FI" && row.identity.pick === null) {
      pushFinding(findings, row, "fi_held_no_actionable_side", "high", "FI model produced no actionable YRFI/NRFI side; verify repairable starter/lineup/context inputs.", {
        missingRequiredFields: review.missingRequiredFields,
        dataWarnings: review.dataWarnings,
        expectedMissingFields: review.expectedMissingFields,
      });
    }
    for (const gap of review.persistenceGaps) {
      if (gap === "fi_price_recovered_from_snapshot") continue;
      pushFinding(findings, row, gap, gap.includes("not_offered") ? "info" : "high", "Evidence reviewer reported a persistence/source gap.", {
        gap,
        priceNullReason: row.priceValueEvidence.priceNullReason,
      });
    }
    if (actionable && row.priceValueEvidence.priceAmerican === null) {
      pushFinding(findings, row, "actionable_price_missing", "high", "Actionable prediction is missing a display price.");
    }
    if (actionable && row.modelStatsEvidence.edge === null) {
      pushFinding(findings, row, "actionable_edge_missing", "high", "Actionable prediction is missing model-vs-market edge.");
    }
    if (row.identity.marketType !== "FI" && sharpStatus === "sharp_context_unavailable_current_source") {
      pushFinding(findings, row, "ml_total_sharp_context_missing", "medium", "ML/Total row is missing Sharp Book context.");
    }
    if (row.identity.marketType === "FI" && sharpStatus !== "sharp_context_not_required") {
      pushFinding(findings, row, "fi_unexpected_sharp_context_status", "medium", "FI should not require Consensus/Sharp split context.", { sharpStatus });
    }
  }
  return findings;
}

export async function runDailyEdgeDataHealthMonitor(args: {
  sport: Sport;
  date: string;
  markets?: string;
}): Promise<DailyEdgeDataHealthReport> {
  const markets = parseAiAuditorMarkets(args.markets ?? "ML,TOTAL,FI");
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const selection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets,
    response,
  });
  const rows = selection.evidence;
  const findings = collectFindings(rows);
  const bySeverity = countBy(findings, (finding) => finding.severity);
  const byCode = countBy(findings, (finding) => finding.code);
  const unresolvedBlockingOrHigh = findings.filter((finding) =>
    finding.severity === "blocking" || finding.severity === "high"
  ).length;
  return {
    mode: "daily_edge_data_health_monitor",
    noOpenAiCalls: true,
    noPredictionChanges: true,
    noGradeChanges: true,
    noTrackingChanges: true,
    sport: args.sport,
    date: args.date,
    markets,
    gameCount: new Set(rows.map((row) => row.identity.gameId)).size,
    predictionCount: rows.length,
    evidenceSource: selection.selectionSummary,
    coverage: {
      moneyline: coverage(rows.filter((row) => row.identity.normalizedMarket === "moneyline")),
      total: coverage(rows.filter((row) => row.identity.normalizedMarket === "total")),
      first_inning: coverage(rows.filter((row) => row.identity.normalizedMarket === "first_inning")),
    },
    findings,
    bySeverity,
    byCode,
    unresolvedBlockingOrHigh,
    safeForNormalReaderDisplay: unresolvedBlockingOrHigh === 0,
  };
}
