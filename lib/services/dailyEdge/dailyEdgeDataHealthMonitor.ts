import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { sharpContextStatusForEvidence } from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { supabase } from "@/lib/db/supabase";
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

type FiHoldClassification =
  | "legit_model_toss_up"
  | "provisional_lineup_pending"
  | "missing_inputs"
  | "provider_gap"
  | "mapping_bug_or_missing_audit"
  | "unknown";

type FiHoldDiagnostic = {
  classification: FiHoldClassification;
  materiality: "low" | "medium" | "high";
  reason: string;
  fiPick: string | null;
  fiPickReason: string | null;
  fiNoBetReason: string | null;
  fiPlayGrade: string | null;
  dataQualityTier: string | null;
  marketDataQuality: string | null;
  marketReason: string | null;
  missingFeatureCount: number | null;
  presentFeatureCount: number | null;
  featureReasonCodes: string[];
  canPublishNormal: boolean | null;
  repairEligible: boolean | null;
  completenessStatus: string | null;
  degradedFields: string[];
  posteriorNrfi: number | null;
  posteriorYrfi: number | null;
  marketListedFiTotal: number | null;
  marketNrfiOddsAmerican: number | null;
  marketYrfiOddsAmerican: number | null;
};

type GamePredictionDiagnosticRow = {
  sport_specific: Record<string, unknown> | null;
  games: { external_id: number } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function stringAt(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return typeof child === "string" && child.trim() !== "" ? child : null;
}

function numberAt(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return typeof child === "number" && Number.isFinite(child) ? child : null;
}

function booleanAt(value: unknown, key: string): boolean | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return typeof child === "boolean" ? child : null;
}

function stringArrayAt(value: unknown, key: string): string[] {
  if (!isRecord(value)) return [];
  const child = value[key];
  return Array.isArray(child) ? child.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

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

function isFiHeldNoSide(row: PredictionEvidenceObject): boolean {
  return row.identity.marketType === "FI" && row.identity.pick === null;
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

function classifyFiHoldDiagnostic(sportSpecific: Record<string, unknown> | null): FiHoldDiagnostic {
  if (!sportSpecific) {
    return {
      classification: "mapping_bug_or_missing_audit",
      materiality: "high",
      reason: "No sport_specific audit payload was available for this FI hold.",
      fiPick: null,
      fiPickReason: null,
      fiNoBetReason: null,
      fiPlayGrade: null,
      dataQualityTier: null,
      marketDataQuality: null,
      marketReason: null,
      missingFeatureCount: null,
      presentFeatureCount: null,
      featureReasonCodes: [],
      canPublishNormal: null,
      repairEligible: null,
      completenessStatus: null,
      degradedFields: [],
      posteriorNrfi: null,
      posteriorYrfi: null,
      marketListedFiTotal: null,
      marketNrfiOddsAmerican: null,
      marketYrfiOddsAmerican: null,
    };
  }

  const audit = recordAt(sportSpecific, "fi_v2_audit");
  const featureAudit = recordAt(audit, "feature_audit");
  const completeness = recordAt(sportSpecific, "mlb_data_completeness");
  const fiPick = stringAt(audit, "fi_pick");
  const fiPickReason = stringAt(audit, "fi_pick_reason");
  const fiNoBetReason = stringAt(audit, "fi_no_bet_reason");
  const marketDataQuality = stringAt(audit, "market_data_quality");
  const missingFeatureCount = numberAt(featureAudit, "missing_count");
  const featureReasonCodes = stringArrayAt(featureAudit, "reason_codes");
  const completenessStatus = stringAt(completeness, "status");
  const canPublishNormal = booleanAt(completeness, "can_publish_normal");
  const repairEligible = booleanAt(completeness, "repair_eligible");
  const noBetText = `${fiPick ?? ""} ${fiPickReason ?? ""} ${fiNoBetReason ?? ""} ${completenessStatus ?? ""} ${featureReasonCodes.join(" ")}`.toLowerCase();

  let classification: FiHoldClassification = "unknown";
  let materiality: FiHoldDiagnostic["materiality"] = "medium";
  let reason = "FI side is held, but the audit payload did not identify a precise reason.";

  if (!audit) {
    classification = "mapping_bug_or_missing_audit";
    materiality = "high";
    reason = "FI side is held but the fi_v2_audit payload is missing.";
  } else if (completenessStatus === "provisional_lineup_pending" && canPublishNormal === true) {
    classification = "provisional_lineup_pending";
    materiality = "medium";
    reason = "FI side is held while official lineup/top-order context is pending; the card can publish normally and should update through lineup refresh.";
  } else if (/\b(provider|market|odds|line|price)\b/.test(noBetText) && marketDataQuality !== "ok") {
    classification = "provider_gap";
    materiality = "high";
    reason = "FI side is held because market/price provider context is unavailable or not trusted.";
  } else if (/\b(data|lineup|starter|missing|fallback|pending|sparse)\b/.test(noBetText) || (missingFeatureCount ?? 0) > 0) {
    classification = "missing_inputs";
    materiality = "high";
    reason = "FI side is held because starter/lineup/context inputs are sparse or pending.";
  } else if (/\btoss\b|\btoss_up\b|\btoss-up\b/.test(noBetText) || stringAt(sportSpecific, "nrfi_threshold_zone") === "toss_up") {
    classification = "legit_model_toss_up";
    materiality = "low";
    reason = "FI model sees this as a true toss-up/no-actionable-side rather than a data gap.";
  }

  return {
    classification,
    materiality,
    reason,
    fiPick,
    fiPickReason,
    fiNoBetReason,
    fiPlayGrade: stringAt(audit, "fi_play_grade"),
    dataQualityTier: stringAt(audit, "data_quality_tier"),
    marketDataQuality,
    marketReason: stringAt(audit, "market_reason"),
    missingFeatureCount,
    presentFeatureCount: numberAt(featureAudit, "present_count"),
    featureReasonCodes,
    canPublishNormal,
    repairEligible,
    completenessStatus,
    degradedFields: stringArrayAt(completeness, "degraded_fields"),
    posteriorNrfi: numberAt(audit, "posterior_p_nrfi"),
    posteriorYrfi: numberAt(audit, "posterior_p_yrfi"),
    marketListedFiTotal: numberAt(audit, "market_listed_fi_total"),
    marketNrfiOddsAmerican: numberAt(audit, "market_nrfi_odds_american"),
    marketYrfiOddsAmerican: numberAt(audit, "market_yrfi_odds_american"),
  };
}

async function loadFiHoldDiagnostics(rows: PredictionEvidenceObject[]): Promise<Map<number, FiHoldDiagnostic>> {
  const externalIds = Array.from(new Set(rows.filter(isFiHeldNoSide).map((row) => row.identity.externalId)));
  if (externalIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("game_predictions")
    .select("sport_specific, games!inner ( external_id, sport, slate_date )")
    .eq("games.sport", rows[0]?.identity.sport ?? "mlb")
    .eq("games.slate_date", rows[0]?.identity.slateDate ?? "")
    .in("games.external_id", externalIds);
  if (error) {
    throw new Error(`daily-edge health FI diagnostics failed: ${error.message}`);
  }
  const out = new Map<number, FiHoldDiagnostic>();
  for (const row of (data ?? []) as unknown as GamePredictionDiagnosticRow[]) {
    const externalId = row.games?.external_id;
    if (typeof externalId !== "number") continue;
    out.set(externalId, classifyFiHoldDiagnostic(row.sport_specific));
  }
  for (const externalId of externalIds) {
    if (!out.has(externalId)) out.set(externalId, classifyFiHoldDiagnostic(null));
  }
  return out;
}

function fiHoldFindingCode(diagnostic: FiHoldDiagnostic | undefined): string {
  if (!diagnostic) return "fi_model_hold_diagnostic_missing";
  if (diagnostic.classification === "legit_model_toss_up") return "fi_legit_model_toss_up";
  if (diagnostic.classification === "provisional_lineup_pending") return "fi_provisional_lineup_pending";
  if (diagnostic.classification === "missing_inputs") return "fi_model_hold_missing_inputs";
  if (diagnostic.classification === "provider_gap") return "fi_model_hold_provider_gap";
  return "fi_model_hold_diagnostic_missing";
}

function fiHoldFindingSeverity(diagnostic: FiHoldDiagnostic | undefined): DailyEdgeDataHealthSeverity {
  if (diagnostic?.classification === "legit_model_toss_up") return "info";
  if (diagnostic?.materiality === "medium") return "medium";
  return "high";
}

function collectFindings(
  rows: PredictionEvidenceObject[],
  fiHoldDiagnostics: Map<number, FiHoldDiagnostic>,
): DailyEdgeDataHealthFinding[] {
  const findings: DailyEdgeDataHealthFinding[] = [];
  for (const row of rows) {
    const review = reviewPredictionEvidence(row);
    const actionable = isActionableRow(row);
    const sharpStatus = sharpContextStatusForEvidence(row);
    const fiHeldNoSide = isFiHeldNoSide(row);
    const fiDiagnostic = fiHeldNoSide ? fiHoldDiagnostics.get(row.identity.externalId) : undefined;
    if (review.evidenceQuality === "blocked") {
      if (fiHeldNoSide) {
        pushFinding(findings, row, fiHoldFindingCode(fiDiagnostic), fiHoldFindingSeverity(fiDiagnostic), fiDiagnostic?.reason ?? "FI side is held with no diagnostic payload available.", {
          missingRequiredFields: review.missingRequiredFields,
          persistenceGaps: review.persistenceGaps,
          dataWarnings: review.dataWarnings,
          expectedMissingFields: review.expectedMissingFields,
          fiHoldDiagnostic: fiDiagnostic ?? null,
        });
      } else {
        pushFinding(findings, row, "evidence_blocked", "blocking", "Prediction evidence is blocked for review/display quality.", {
          missingRequiredFields: review.missingRequiredFields,
          persistenceGaps: review.persistenceGaps,
          dataWarnings: review.dataWarnings,
        });
      }
    } else if (fiHeldNoSide) {
      pushFinding(findings, row, fiHoldFindingCode(fiDiagnostic), fiHoldFindingSeverity(fiDiagnostic), fiDiagnostic?.reason ?? "FI model produced no actionable YRFI/NRFI side.", {
        missingRequiredFields: review.missingRequiredFields,
        dataWarnings: review.dataWarnings,
        expectedMissingFields: review.expectedMissingFields,
        fiHoldDiagnostic: fiDiagnostic ?? null,
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
  const fiHoldDiagnostics = await loadFiHoldDiagnostics(rows);
  const findings = collectFindings(rows, fiHoldDiagnostics);
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
