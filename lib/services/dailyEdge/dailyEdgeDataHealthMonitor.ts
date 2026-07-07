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
  officialProbableStarters?: OfficialMlbProbableStarterDiagnostic | null;
};

type GamePredictionDiagnosticRow = {
  sport_specific: Record<string, unknown> | null;
  games: { external_id: number } | null;
};

type GameDateRow = {
  external_id: number;
  game_date: string | null;
};

type OfficialMlbProbableStarterDiagnostic = {
  source: "mlb_statsapi";
  matched: boolean;
  gamePk: number | null;
  officialGameDate: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
  awayStarter: string | null;
  homeStarter: string | null;
  missingSides: Array<"away" | "home">;
  matchDistanceMinutes: number | null;
  classification:
    | "official_probables_complete"
    | "official_probable_starter_unannounced"
    | "official_match_missing"
    | "official_fetch_failed";
  error?: string;
};

type OfficialScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  teams?: {
    away?: {
      team?: { name?: string };
      probablePitcher?: { fullName?: string };
    };
    home?: {
      team?: { name?: string };
      probablePitcher?: { fullName?: string };
    };
  };
};

const MLB_TEAM_NAME_TO_ABBR: Record<string, string> = {
  "arizona diamondbacks": "ARI",
  "athletics": "ATH",
  "atlanta braves": "ATL",
  "baltimore orioles": "BAL",
  "boston red sox": "BOS",
  "chicago cubs": "CHC",
  "chicago white sox": "CWS",
  "cincinnati reds": "CIN",
  "cleveland guardians": "CLE",
  "colorado rockies": "COL",
  "detroit tigers": "DET",
  "houston astros": "HOU",
  "kansas city royals": "KC",
  "los angeles angels": "LAA",
  "los angeles dodgers": "LAD",
  "miami marlins": "MIA",
  "milwaukee brewers": "MIL",
  "minnesota twins": "MIN",
  "new york mets": "NYM",
  "new york yankees": "NYY",
  "philadelphia phillies": "PHI",
  "pittsburgh pirates": "PIT",
  "san diego padres": "SD",
  "san francisco giants": "SF",
  "seattle mariners": "SEA",
  "st. louis cardinals": "STL",
  "st louis cardinals": "STL",
  "tampa bay rays": "TB",
  "texas rangers": "TEX",
  "toronto blue jays": "TOR",
  "washington nationals": "WSH",
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

function cleanTeamName(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
    : "";
}

function officialTeamAbbr(value: unknown): string | null {
  const cleaned = cleanTeamName(value);
  return MLB_TEAM_NAME_TO_ABBR[cleaned] ?? null;
}

function officialMissingSides(game: OfficialScheduleGame): Array<"away" | "home"> {
  const missing: Array<"away" | "home"> = [];
  if (!game.teams?.away?.probablePitcher?.fullName) missing.push("away");
  if (!game.teams?.home?.probablePitcher?.fullName) missing.push("home");
  return missing;
}

async function loadGameDatesByExternalId(
  sport: Sport,
  date: string,
  externalIds: readonly number[],
): Promise<Map<number, string | null>> {
  if (externalIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("games")
    .select("external_id, game_date")
    .eq("sport", sport)
    .eq("slate_date", date)
    .in("external_id", [...externalIds]);
  if (error) {
    throw new Error(`daily-edge health game date lookup failed: ${error.message}`);
  }
  return new Map((data ?? []).map((row) => {
    const r = row as GameDateRow;
    return [r.external_id, r.game_date];
  }));
}

async function loadOfficialMlbProbableStarterDiagnostics(
  rows: PredictionEvidenceObject[],
): Promise<Map<number, OfficialMlbProbableStarterDiagnostic>> {
  const fiHeldRows = rows.filter((row) => row.identity.sport === "mlb" && isFiHeldNoSide(row));
  if (fiHeldRows.length === 0) return new Map();

  const externalIds = Array.from(new Set(fiHeldRows.map((row) => row.identity.externalId)));
  const gameDates = await loadGameDatesByExternalId("mlb", fiHeldRows[0]?.identity.slateDate ?? "", externalIds);
  let officialGames: OfficialScheduleGame[] = [];
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${fiHeldRows[0]?.identity.slateDate ?? ""}&hydrate=probablePitcher`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { dates?: Array<{ games?: OfficialScheduleGame[] }> };
    officialGames = (json.dates ?? []).flatMap((d) => d.games ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Map(externalIds.map((externalId) => [externalId, {
      source: "mlb_statsapi",
      matched: false,
      gamePk: null,
      officialGameDate: null,
      awayTeam: null,
      homeTeam: null,
      awayStarter: null,
      homeStarter: null,
      missingSides: [],
      matchDistanceMinutes: null,
      classification: "official_fetch_failed",
      error: message,
    } satisfies OfficialMlbProbableStarterDiagnostic]));
  }

  const out = new Map<number, OfficialMlbProbableStarterDiagnostic>();
  for (const row of fiHeldRows) {
    const gameDate = gameDates.get(row.identity.externalId) ?? null;
    const targetTime = gameDate && Number.isFinite(Date.parse(gameDate)) ? Date.parse(gameDate) : null;
    const candidates = officialGames
      .filter((game) =>
        officialTeamAbbr(game.teams?.away?.team?.name) === row.identity.awayTeam &&
        officialTeamAbbr(game.teams?.home?.team?.name) === row.identity.homeTeam
      )
      .map((game) => {
        const officialTime = game.gameDate && Number.isFinite(Date.parse(game.gameDate)) ? Date.parse(game.gameDate) : null;
        const distance = targetTime !== null && officialTime !== null ? Math.abs(targetTime - officialTime) : null;
        return { game, distance };
      })
      .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY));
    const best = candidates[0] ?? null;
    if (!best) {
      out.set(row.identity.externalId, {
        source: "mlb_statsapi",
        matched: false,
        gamePk: null,
        officialGameDate: null,
        awayTeam: null,
        homeTeam: null,
        awayStarter: null,
        homeStarter: null,
        missingSides: [],
        matchDistanceMinutes: null,
        classification: "official_match_missing",
      });
      continue;
    }
    const missingSides = officialMissingSides(best.game);
    out.set(row.identity.externalId, {
      source: "mlb_statsapi",
      matched: true,
      gamePk: typeof best.game.gamePk === "number" ? best.game.gamePk : null,
      officialGameDate: best.game.gameDate ?? null,
      awayTeam: best.game.teams?.away?.team?.name ?? null,
      homeTeam: best.game.teams?.home?.team?.name ?? null,
      awayStarter: best.game.teams?.away?.probablePitcher?.fullName ?? null,
      homeStarter: best.game.teams?.home?.probablePitcher?.fullName ?? null,
      missingSides,
      matchDistanceMinutes: best.distance === null ? null : Math.round(best.distance / 60_000),
      classification: missingSides.length > 0
        ? "official_probable_starter_unannounced"
        : "official_probables_complete",
    });
  }
  return out;
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
  if (/^no\s*play$/i.test(String(row.identity.originalPlayGrade ?? ""))) return false;
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
  if (diagnostic.officialProbableStarters?.classification === "official_probable_starter_unannounced") {
    return "fi_official_probable_starter_unannounced";
  }
  if (
    diagnostic.classification === "missing_inputs" &&
    diagnostic.officialProbableStarters?.classification === "official_probables_complete"
  ) {
    return "fi_starter_ingestion_miss";
  }
  if (diagnostic.classification === "legit_model_toss_up") return "fi_legit_model_toss_up";
  if (diagnostic.classification === "provisional_lineup_pending") return "fi_provisional_lineup_pending";
  if (diagnostic.classification === "missing_inputs") return "fi_model_hold_missing_inputs";
  if (diagnostic.classification === "provider_gap") return "fi_model_hold_provider_gap";
  return "fi_model_hold_diagnostic_missing";
}

function fiHoldFindingSeverity(diagnostic: FiHoldDiagnostic | undefined): DailyEdgeDataHealthSeverity {
  if (diagnostic?.classification === "legit_model_toss_up") return "info";
  if (diagnostic?.officialProbableStarters?.classification === "official_probable_starter_unannounced") return "medium";
  if (diagnostic?.materiality === "medium") return "medium";
  return "high";
}

function fiHoldFindingMessage(diagnostic: FiHoldDiagnostic | undefined): string {
  const official = diagnostic?.officialProbableStarters;
  if (official?.classification === "official_probable_starter_unannounced") {
    const sides = official.missingSides.join("/");
    return `FI side is held because MLB official probable starter data is still unannounced for ${sides || "one side"}.`;
  }
  if (official?.classification === "official_probables_complete" && diagnostic?.classification === "missing_inputs") {
    return "FI side is held even though MLB official probable starters are complete; this is an ingestion/mapping issue.";
  }
  return diagnostic?.reason ?? "FI model produced no actionable YRFI/NRFI side.";
}

function collectFindings(
  rows: PredictionEvidenceObject[],
  fiHoldDiagnostics: Map<number, FiHoldDiagnostic>,
  officialMlbProbableStarters: Map<number, OfficialMlbProbableStarterDiagnostic>,
): DailyEdgeDataHealthFinding[] {
  const findings: DailyEdgeDataHealthFinding[] = [];
  for (const row of rows) {
    const review = reviewPredictionEvidence(row);
    const actionable = isActionableRow(row);
    const sharpStatus = sharpContextStatusForEvidence(row);
    const fiHeldNoSide = isFiHeldNoSide(row);
    const baseFiDiagnostic = fiHeldNoSide ? fiHoldDiagnostics.get(row.identity.externalId) : undefined;
    const fiDiagnostic = baseFiDiagnostic
      ? {
          ...baseFiDiagnostic,
          officialProbableStarters: officialMlbProbableStarters.get(row.identity.externalId) ?? null,
        }
      : undefined;
    if (review.evidenceQuality === "blocked") {
      if (fiHeldNoSide) {
        pushFinding(findings, row, fiHoldFindingCode(fiDiagnostic), fiHoldFindingSeverity(fiDiagnostic), fiHoldFindingMessage(fiDiagnostic), {
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
      pushFinding(findings, row, fiHoldFindingCode(fiDiagnostic), fiHoldFindingSeverity(fiDiagnostic), fiHoldFindingMessage(fiDiagnostic), {
        missingRequiredFields: review.missingRequiredFields,
        dataWarnings: review.dataWarnings,
        expectedMissingFields: review.expectedMissingFields,
        fiHoldDiagnostic: fiDiagnostic ?? null,
      });
    }
    for (const gap of review.persistenceGaps) {
      if (gap === "fi_price_recovered_from_snapshot") continue;
      const severity: DailyEdgeDataHealthSeverity =
        gap.includes("not_offered") ? "info" :
        row.identity.marketType === "FI" && !actionable ? "medium" :
        "high";
      pushFinding(findings, row, gap, severity, "Evidence reviewer reported a persistence/source gap.", {
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
    if (
      row.identity.marketType !== "FI" &&
      row.marketEvidence.sourceAgreement !== "not_required" &&
      !row.marketEvidence.consensusSplitsAvailable
    ) {
      pushFinding(findings, row, "ml_total_consensus_context_missing", "medium", "ML/Total row is missing Consensus Splits context.", {
        sourceMissingReason: row.marketEvidence.sourceMissingReason,
        sourceAgreement: row.marketEvidence.sourceAgreement,
      });
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
  const officialMlbProbableStarters = args.sport === "mlb"
    ? await loadOfficialMlbProbableStarterDiagnostics(rows)
    : new Map<number, OfficialMlbProbableStarterDiagnostic>();
  const findings = collectFindings(rows, fiHoldDiagnostics, officialMlbProbableStarters);
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
