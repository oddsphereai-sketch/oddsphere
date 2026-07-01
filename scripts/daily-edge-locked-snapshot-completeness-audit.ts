import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

type FindingSeverity = "info" | "medium" | "high";

type Finding = {
  severity: FindingSeverity;
  code: string;
  game: string;
  market: string;
  pick: string | null;
  field: string;
  status: "persisted" | "expected_missing" | "persistence_gap" | "diagnostic_only";
  message: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: "2026-06-29",
    markets: "ML,TOTAL,FI",
    json: false,
  };
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

function key(row: PredictionEvidenceObject): string {
  return `${row.identity.externalId}:${row.identity.normalizedMarket}`;
}

function game(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function pct(count: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function hasSharp(row: PredictionEvidenceObject): boolean {
  return row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable;
}

function hasCoreFi(row: PredictionEvidenceObject): boolean {
  return row.modelStatsEvidence.modelProbability !== null &&
    row.modelStatsEvidence.edge !== null &&
    row.priceValueEvidence.marketImpliedProbability !== null;
}

function fieldSummary(rows: PredictionEvidenceObject[]) {
  const count = rows.length;
  const countWhere = (fn: (row: PredictionEvidenceObject) => boolean) => rows.filter(fn).length;
  return {
    rows: count,
    consensusSplits: { count: countWhere((row) => row.marketEvidence.consensusSplitsAvailable), pct: pct(countWhere((row) => row.marketEvidence.consensusSplitsAvailable), count) },
    sharpFullSplits: { count: countWhere((row) => row.marketEvidence.sharpBookSplitsAvailable), pct: pct(countWhere((row) => row.marketEvidence.sharpBookSplitsAvailable), count) },
    sharpSignal: { count: countWhere((row) => row.marketEvidence.sharpBookSignalAvailable), pct: pct(countWhere((row) => row.marketEvidence.sharpBookSignalAvailable), count) },
    sharpAny: { count: countWhere(hasSharp), pct: pct(countWhere(hasSharp), count) },
    lineMovement: { count: countWhere((row) => row.marketEvidence.lineMovement.openAmerican !== null || row.marketEvidence.lineMovement.currentAmerican !== null || row.marketEvidence.lineMovement.lockedAmerican !== null || row.marketEvidence.lineMovement.currentLine !== null), pct: pct(countWhere((row) => row.marketEvidence.lineMovement.openAmerican !== null || row.marketEvidence.lineMovement.currentAmerican !== null || row.marketEvidence.lineMovement.lockedAmerican !== null || row.marketEvidence.lineMovement.currentLine !== null), count) },
    price: { count: countWhere((row) => row.priceValueEvidence.priceAmerican !== null), pct: pct(countWhere((row) => row.priceValueEvidence.priceAmerican !== null), count) },
    modelProbability: { count: countWhere((row) => row.modelStatsEvidence.modelProbability !== null), pct: pct(countWhere((row) => row.modelStatsEvidence.modelProbability !== null), count) },
    marketImpliedProbability: { count: countWhere((row) => row.modelStatsEvidence.marketImpliedProbability !== null), pct: pct(countWhere((row) => row.modelStatsEvidence.marketImpliedProbability !== null), count) },
    edge: { count: countWhere((row) => row.modelStatsEvidence.edge !== null), pct: pct(countWhere((row) => row.modelStatsEvidence.edge !== null), count) },
    marketRead: { count: countWhere((row) => row.marketEvidence.marketReadRaw !== null), pct: pct(countWhere((row) => row.marketEvidence.marketReadRaw !== null), count) },
    dataQualityWarnings: { count: countWhere((row) => row.modelStatsEvidence.dataQualityWarnings.length > 0), pct: pct(countWhere((row) => row.modelStatsEvidence.dataQualityWarnings.length > 0), count) },
    fiCore: { count: countWhere(hasCoreFi), pct: pct(countWhere(hasCoreFi), count) },
  };
}

function byMarketSummary(rows: PredictionEvidenceObject[]) {
  return {
    moneyline: fieldSummary(rows.filter((row) => row.identity.normalizedMarket === "moneyline")),
    total: fieldSummary(rows.filter((row) => row.identity.normalizedMarket === "total")),
    first_inning: fieldSummary(rows.filter((row) => row.identity.normalizedMarket === "first_inning")),
  };
}

function push(findings: Finding[], row: PredictionEvidenceObject, code: string, severity: FindingSeverity, field: string, status: Finding["status"], message: string) {
  findings.push({
    severity,
    code,
    game: game(row),
    market: row.identity.normalizedMarket,
    pick: row.identity.pick,
    field,
    status,
    message,
  });
}

function auditLockedRow(args: {
  locked: PredictionEvidenceObject;
  current: PredictionEvidenceObject | undefined;
  findings: Finding[];
}) {
  const { locked, current, findings } = args;
  const isFi = locked.identity.marketType === "FI";
  if (!isFi) {
    if (!locked.marketEvidence.consensusSplitsAvailable) {
      push(findings, locked, "locked_consensus_missing", "high", "consensus_splits", "persistence_gap", "ML/Total locked snapshot lacks Consensus Splits.");
    }
    if (!hasSharp(locked) && current && hasSharp(current)) {
      push(findings, locked, "sharp_context_available_prelock_but_not_persisted", "high", "sharp_book_splits_or_signal", "persistence_gap", "Current/pre-lock evidence has Sharp Book context, but locked snapshot does not. Future locks must persist Sharp Book Splits or Sharp Book Signal when available.");
    }
    if (!hasSharp(locked) && (!current || !hasSharp(current))) {
      push(findings, locked, "locked_sharp_not_persisted", "info", "sharp_book_splits_or_signal", "expected_missing", "Locked snapshot has no Sharp Book Splits/Signal. Do not invent it for historical evaluation.");
    }
  } else {
    if (locked.marketEvidence.consensusSplitsAvailable || hasSharp(locked)) {
      push(findings, locked, "fi_unexpected_split_source", "medium", "fi_split_sources", "diagnostic_only", "FI should not require consensus/sharp split bars unless a true FI-specific signal exists.");
    }
  }

  const required: Array<[string, boolean, FindingSeverity, string]> = [
    ["price", locked.priceValueEvidence.priceAmerican !== null, "high", "Locked snapshot should persist the display price/odds."],
    ["model_probability", locked.modelStatsEvidence.modelProbability !== null, "high", "Locked snapshot should persist model probability."],
    ["market_implied_probability", locked.modelStatsEvidence.marketImpliedProbability !== null, "high", "Locked snapshot should persist market implied probability."],
    ["edge", locked.modelStatsEvidence.edge !== null, "high", "Locked snapshot should persist model edge."],
    ["market_read", locked.marketEvidence.marketReadRaw !== null, "medium", "Locked snapshot should persist or reconstruct Market Read."],
  ];
  if (!isFi) {
    required.push(["line_movement", locked.marketEvidence.lineMovement.openAmerican !== null || locked.marketEvidence.lineMovement.currentAmerican !== null || locked.marketEvidence.lineMovement.lockedAmerican !== null || locked.marketEvidence.lineMovement.currentLine !== null, "medium", "ML/Total locked snapshot should persist line movement/open/current/lock where available."]);
  } else {
    required.push(["fi_context", hasCoreFi(locked), "medium", "FI locked snapshot should persist FI model edge/probability, market implied probability, and context."]);
  }
  for (const [field, ok, severity, message] of required) {
    if (!ok) push(findings, locked, `locked_${field}_missing`, severity, field, "persistence_gap", message);
  }
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
  const currentByKey = new Map(selection.currentLiveEvidence.map((row) => [key(row), row]));
  const findings: Finding[] = [];
  for (const locked of selection.lockedSnapshotEvidence) {
    auditLockedRow({ locked, current: currentByKey.get(key(locked)), findings });
  }
  const byCode = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.code] = (acc[finding.code] ?? 0) + 1;
    return acc;
  }, {});
  const byStatus = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.status] = (acc[finding.status] ?? 0) + 1;
    return acc;
  }, {});
  const bySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  const report = {
    mode: "locked_snapshot_completeness_audit",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    sport: args.sport,
    date: args.date,
    markets,
    evidenceSource: selection.selectionSummary,
    lockedPreLockFieldsPersisted: byMarketSummary(selection.lockedSnapshotEvidence),
    currentLiveSourceCoverageDiagnosticOnly: byMarketSummary(selection.currentLiveEvidence),
    findings: findings.length,
    bySeverity,
    byStatus,
    byCode,
    persistenceGaps: findings.filter((finding) => finding.status === "persistence_gap"),
    diagnosticCurrentLiveNotPersisted: findings.filter((finding) => finding.code === "sharp_context_available_prelock_but_not_persisted"),
    expectedMissing: findings.filter((finding) => finding.status === "expected_missing"),
    allFindings: findings,
    forwardLookingRule: "At future lock, persist the official evidence package: Consensus Splits, Sharp Book Splits or Sharp Book Signal when available, line movement, price/value, model/stat evidence, Market Read, and risk/data-quality context. After lock, reader/AI should use this package instead of current/live provider state.",
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Daily Edge Locked Snapshot Completeness Audit — ${args.sport} ${args.date}`);
  console.log("No OpenAI calls. No live/member-facing changes.");
  console.log(JSON.stringify({
    evidenceSource: report.evidenceSource,
    lockedPreLockFieldsPersisted: report.lockedPreLockFieldsPersisted,
    currentLiveSourceCoverageDiagnosticOnly: report.currentLiveSourceCoverageDiagnosticOnly,
    bySeverity,
    byStatus,
    byCode,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
