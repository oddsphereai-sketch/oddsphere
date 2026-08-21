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
import {
  MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID,
  MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
} from "@/lib/services/predictionRecordService";
import {
  MLB_MODEL_LAYER_VERSION_IDS,
  MLB_MODEL_LAYER_VERSION_SCHEMA,
  type MlbModelLayerMarket,
} from "@/lib/automodel/mlbModelLayerVersions";

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
  | "publishable_degraded_stats"
  | "provisional_lineup_pending"
  | "sparse_starter_history"
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

type PredictionRecordContractRow = {
  id: number;
  game_id: string | number | null;
  external_id: number | null;
  sport: Sport;
  slate_date: string;
  game_date: string | null;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  no_bet_reason: string | null;
  locked_at: string | null;
  snapshot_json: unknown;
};

const LOCKED_PRICE_MAX_SOURCE_AGE_MINUTES = 90;
const LOCKED_PRICE_MAX_SOURCE_AGE_MS = LOCKED_PRICE_MAX_SOURCE_AGE_MINUTES * 60 * 1000;
const MLB_MODEL_LAYER_CONTRACT_EFFECTIVE_DATE = "2026-07-11";
const MLB_MODEL_LAYER_PUBLIC_NAME = "MLB Market-Aware Champion v2";

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

function hasSparseStarterHistory(sportSpecific: Record<string, unknown>, featureReasonCodes: string[]): boolean {
  const fiAudit = recordAt(sportSpecific, "fi_v2_audit");
  const freshDataBlockers = stringArrayAt(fiAudit, "fresh_data_blockers");
  if (
    featureReasonCodes.includes("fi_starter_proxy_season_stats") &&
    freshDataBlockers.some((reason) => /opposing_starter_fi_proxy|starter_fi_proxy/i.test(reason))
  ) {
    return true;
  }
  if (!featureReasonCodes.includes("fi_starter_missing") && !featureReasonCodes.includes("fi_starter_proxy_season_stats")) return false;
  const v22Audit = recordAt(sportSpecific, "v2_2_audit");
  const featureCapture = recordAt(v22Audit, "feature_capture");
  const starters = recordAt(featureCapture, "starter");
  const starterRows = [recordAt(starters, "home"), recordAt(starters, "away")];
  return starterRows.some((starter) => {
    if (!starter) return false;
    const hasKnownIdentity = stringAt(starter, "name") !== null || numberAt(starter, "player_id") !== null;
    const hasKnownStats =
      numberAt(starter, "first_inning_starts") !== null ||
      numberAt(starter, "season_games_started") !== null ||
      numberAt(starter, "season_innings_pitched") !== null ||
      numberAt(starter, "season_era") !== null;
    if (!hasKnownIdentity && !hasKnownStats) return false;
    const fiStarts = numberAt(starter, "first_inning_starts");
    const seasonStarts = numberAt(starter, "season_games_started");
    const seasonInnings = numberAt(starter, "season_innings_pitched");
    const seasonEra = numberAt(starter, "season_era");
    const hasSparseFi = fiStarts === null || fiStarts < 5;
    if (featureReasonCodes.includes("fi_starter_proxy_season_stats") && hasSparseFi) return true;
    const hasTinyStarterSample =
      (seasonStarts !== null && seasonStarts <= 1) ||
      (seasonInnings !== null && seasonInnings < 10) ||
      seasonEra === 0;
    return hasSparseFi && hasTinyStarterSample;
  });
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

export function isDailyEdgeActionableGrade(grade: string | null | undefined): boolean {
  const normalized = String(grade ?? "").trim().toLowerCase();
  return normalized === "lean" || normalized === "best angle" || normalized === "best_angle";
}

function isActionableRow(row: PredictionEvidenceObject): boolean {
  if (row.identity.noBet === true) return false;
  if (row.identity.marketType === "FI" && (isFiTossUp(row) || row.identity.pick === null)) return false;
  if (row.identity.pick === null) return false;
  return isDailyEdgeActionableGrade(row.identity.originalPlayGrade);
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

function pushPredictionRecordFinding(
  findings: DailyEdgeDataHealthFinding[],
  row: PredictionRecordContractRow,
  code: string,
  severity: DailyEdgeDataHealthSeverity,
  message: string,
  details?: Record<string, unknown>,
) {
  findings.push({
    severity,
    code,
    sport: row.sport,
    date: row.slate_date,
    game: row.matchup ?? String(row.game_id ?? row.external_id ?? "unknown_game"),
    market: row.market ?? "unknown_market",
    pick: row.pick,
    evidenceSource: row.locked_at ? "locked_snapshot" : "current_live",
    message,
    details: {
      predictionRecordId: row.id,
      gameId: row.game_id,
      externalId: row.external_id,
      gameTime: row.game_date,
      lineValue: row.line_value,
      oddsAmerican: row.odds_american,
      modelProbability: row.model_probability,
      marketProbability: row.market_probability,
      edge: row.edge,
      playGrade: row.play_grade,
      bestAngle: row.best_angle,
      noBet: row.no_bet,
      noBetReason: row.no_bet_reason,
      ...details,
    },
  });
}

function snapshotRecord(value: unknown, key: string): Record<string, unknown> | null {
  return recordAt(value, key);
}

function isMarketAwareCorrectedRow(row: PredictionRecordContractRow): boolean {
  const correction = snapshotRecord(row.snapshot_json, "market_aware_side_correction");
  return correction?.applied === true && correction.rule_id === MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID;
}

function marketAwareCorrectedGrade(row: PredictionRecordContractRow): Record<string, unknown> | null {
  const grade = snapshotRecord(row.snapshot_json, "market_aware_corrected_grade");
  return grade?.rule_id === MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID ? grade : null;
}

function isMlbModelLayerContractEffective(row: PredictionRecordContractRow): boolean {
  return row.slate_date >= MLB_MODEL_LAYER_CONTRACT_EFFECTIVE_DATE;
}

function expectedMlbModelLayerMarket(market: string | null): MlbModelLayerMarket | null {
  const normalized = String(market ?? "").toLowerCase();
  if (normalized === "moneyline" || normalized === "ml") return "moneyline";
  if (normalized === "total" || normalized === "totals" || normalized === "ou") return "total";
  if (normalized === "first_inning" || normalized === "first-inning" || normalized === "fi") return "first_inning";
  return null;
}

function expectedMlbActiveProbabilityHead(market: MlbModelLayerMarket): string {
  if (market === "moneyline") return MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head;
  if (market === "total") return MLB_MODEL_LAYER_VERSION_IDS.total_probability_head;
  return MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head;
}

function modelLayerVersionsFromSnapshot(snapshot: unknown): Record<string, unknown> | null {
  const direct = snapshotRecord(snapshot, "model_layer_versions");
  if (direct) return direct;
  const memberFacing = snapshotRecord(snapshot, "member_facing_at_lock");
  return snapshotRecord(memberFacing, "model_layer_versions");
}

function modelLayerFindingSeverity(row: PredictionRecordContractRow): DailyEdgeDataHealthSeverity {
  return row.no_bet === true && row.best_angle !== true ? "medium" : "high";
}

const MLB_IMMUTABLE_MODEL_LAYER_FIELDS = [
  "schema_version",
  "projection_core",
  "score_distribution",
  "moneyline_probability_head",
  "total_probability_head",
  "first_inning_probability_head",
  "market_calibration_policy",
  "market",
  "active_probability_head",
] as const;

const MLB_CURRENT_POLICY_LAYER_FIELDS = [
  "grade_policy",
  "correction_policy",
  "tracking_contract",
] as const;

type MlbComparableModelLayerField =
  | (typeof MLB_IMMUTABLE_MODEL_LAYER_FIELDS)[number]
  | (typeof MLB_CURRENT_POLICY_LAYER_FIELDS)[number];

export function mlbModelLayerFieldsToCompare(
  locked: boolean,
): readonly MlbComparableModelLayerField[] {
  return locked
    ? MLB_IMMUTABLE_MODEL_LAYER_FIELDS
    : [...MLB_IMMUTABLE_MODEL_LAYER_FIELDS, ...MLB_CURRENT_POLICY_LAYER_FIELDS];
}

function pushMlbModelLayerContractFinding(
  findings: DailyEdgeDataHealthFinding[],
  row: PredictionRecordContractRow,
) {
  if (!isMlbModelLayerContractEffective(row)) return;

  const expectedMarket = expectedMlbModelLayerMarket(row.market);
  if (expectedMarket === null) return;

  const actual = modelLayerVersionsFromSnapshot(row.snapshot_json);
  const severity = modelLayerFindingSeverity(row);
  const expected = {
    publicName: MLB_MODEL_LAYER_PUBLIC_NAME,
    schema_version: MLB_MODEL_LAYER_VERSION_SCHEMA,
    projection_core: MLB_MODEL_LAYER_VERSION_IDS.projection_core,
    score_distribution: MLB_MODEL_LAYER_VERSION_IDS.score_distribution,
    moneyline_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
    total_probability_head: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
    first_inning_probability_head: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
    market_calibration_policy: MLB_MODEL_LAYER_VERSION_IDS.market_calibration_policy,
    grade_policy: MLB_MODEL_LAYER_VERSION_IDS.grade_policy,
    correction_policy: MLB_MODEL_LAYER_VERSION_IDS.correction_policy,
    tracking_contract: MLB_MODEL_LAYER_VERSION_IDS.tracking_contract,
    market: expectedMarket,
    active_probability_head: expectedMlbActiveProbabilityHead(expectedMarket),
  };

  if (actual === null) {
    pushPredictionRecordFinding(
      findings,
      row,
      "mlb_model_layer_stamp_missing",
      severity,
      "MLB prediction row is not stamped with the active MLB Market-Aware Champion v2 model layer contract.",
      {
        expected,
        effectiveDate: MLB_MODEL_LAYER_CONTRACT_EFFECTIVE_DATE,
      },
    );
    return;
  }

  // Locked rows are immutable release evidence. Their grade/correction/tracking
  // policy stamps must remain the policy that actually produced the member
  // pick, so only model identity is compared to the active contract. Unlocked
  // rows must carry the complete current policy contract.
  const fieldsToCompare = mlbModelLayerFieldsToCompare(row.locked_at !== null);
  const mismatches = fieldsToCompare
    .map((field) => ({
      field,
      expected: expected[field],
      actual: actual[field],
    }))
    .filter((mismatch) => mismatch.actual !== mismatch.expected);

  if (mismatches.length === 0) return;

  pushPredictionRecordFinding(
    findings,
    row,
    "mlb_model_layer_stamp_mismatch",
    severity,
    "MLB prediction row is stamped with a model layer contract that does not match MLB Market-Aware Champion v2.",
    {
      publicName: MLB_MODEL_LAYER_PUBLIC_NAME,
      mismatches,
      actualRuntimeEnv: recordAt(actual, "runtime_env"),
      effectiveDate: MLB_MODEL_LAYER_CONTRACT_EFFECTIVE_DATE,
    },
  );
}

function lockedPriceSourceKey(market: string | null): string | null {
  if (market === "moneyline") return "odds_source_at_lock_ml";
  if (market === "total") return "odds_source_at_lock_ou";
  if (market === "first_inning") return "odds_source_at_lock_fi";
  return null;
}

function lockedPriceSelectedSide(row: PredictionRecordContractRow): string | null {
  if (row.side === "home" || row.side === "away" || row.side === "over" || row.side === "under") {
    return row.side;
  }
  if (row.market === "first_inning") {
    if (row.pick === "NRFI") return "under";
    if (row.pick === "YRFI") return "over";
  }
  return null;
}

function selectedLockedPriceSource(row: PredictionRecordContractRow): {
  sourceKey: string | null;
  selectedSide: string | null;
  source: Record<string, unknown> | null;
} {
  const sourceKey = lockedPriceSourceKey(row.market);
  const selectedSide = lockedPriceSelectedSide(row);
  if (sourceKey === null) return { sourceKey, selectedSide, source: null };
  const sourceBucket = snapshotRecord(row.snapshot_json, sourceKey);
  if (row.market === "first_inning") {
    return { sourceKey, selectedSide, source: recordAt(sourceBucket, "picked") };
  }
  if (selectedSide === null) return { sourceKey, selectedSide, source: null };
  return { sourceKey, selectedSide, source: recordAt(sourceBucket, selectedSide) };
}

function lockedPriceFindingSeverity(row: PredictionRecordContractRow): DailyEdgeDataHealthSeverity {
  return row.no_bet === true ? "medium" : "high";
}

function pushLockedPriceFreshnessFinding(
  findings: DailyEdgeDataHealthFinding[],
  row: PredictionRecordContractRow,
) {
  if (row.locked_at === null) return;
  if (row.market !== "moneyline" && row.market !== "total" && row.market !== "first_inning") return;
  if (row.pick === null || row.pick === "Toss-Up") return;

  const { sourceKey, selectedSide, source } = selectedLockedPriceSource(row);
  const severity = lockedPriceFindingSeverity(row);
  if (row.odds_american === null) {
    pushPredictionRecordFinding(
      findings,
      row,
      "locked_price_missing",
      severity,
      "Locked prediction row has a member-facing pick but no selected price.",
      { sourceKey, selectedSide },
    );
    return;
  }

  const sourceName = stringAt(source, "source");
  if (source === null || sourceName === "unavailable") {
    pushPredictionRecordFinding(
      findings,
      row,
      "locked_price_source_missing",
      severity,
      "Locked prediction row has a price but no auditable lock-price source.",
      { sourceKey, selectedSide },
    );
    return;
  }

  const observedAt = stringAt(source, "observedAt");
  const lockedMs = Date.parse(row.locked_at);
  const observedMs = observedAt === null ? NaN : Date.parse(observedAt);
  if (!Number.isFinite(lockedMs) || !Number.isFinite(observedMs)) {
    pushPredictionRecordFinding(
      findings,
      row,
      "locked_price_source_timestamp_invalid",
      severity,
      "Locked prediction row has an invalid or missing lock-price source timestamp.",
      {
        sourceKey,
        selectedSide,
        source,
        lockedAt: row.locked_at,
        observedAt,
      },
    );
    return;
  }

  const ageMs = lockedMs - observedMs;
  const ageMinutes = Math.round(ageMs / 60000);
  if (ageMs < 0 || ageMs > LOCKED_PRICE_MAX_SOURCE_AGE_MS) {
    pushPredictionRecordFinding(
      findings,
      row,
      "locked_price_source_stale",
      severity,
      "Locked prediction row selected a stale price source instead of a fresh lock-time market price.",
      {
        sourceKey,
        selectedSide,
        source,
        lockedAt: row.locked_at,
        observedAt,
        ageMinutes,
        maxAgeMinutes: LOCKED_PRICE_MAX_SOURCE_AGE_MINUTES,
      },
    );
  }
}

async function loadPredictionRecordContractFindings(args: {
  sport: Sport;
  date: string;
  markets: AiAuditorMarketKey[];
}): Promise<DailyEdgeDataHealthFinding[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,no_bet_reason,locked_at,snapshot_json")
    .eq("sport", args.sport)
    .eq("slate_date", args.date)
    .in("market", args.markets)
    .limit(10000);
  if (error) {
    throw new Error(`daily-edge health prediction_records contract scan failed: ${error.message}`);
  }

  const findings: DailyEdgeDataHealthFinding[] = [];
  for (const row of (data ?? []) as PredictionRecordContractRow[]) {
    if (row.best_angle === true && row.no_bet === true) {
      pushPredictionRecordFinding(
        findings,
        row,
        "best_angle_no_bet_contradiction",
        "blocking",
        "prediction_records has best_angle=true and no_bet=true; this cannot be member-facing or tracked coherently.",
      );
    }

    if (args.sport !== "mlb") continue;
    pushMlbModelLayerContractFinding(findings, row);
    pushLockedPriceFreshnessFinding(findings, row);
    if (row.market !== "moneyline" && row.market !== "total") continue;
    if (!isMarketAwareCorrectedRow(row)) continue;

    const correctedGrade = marketAwareCorrectedGrade(row);
    const correctedBestAngle = correctedGrade?.bestAngle === true;
    const correctedPlayGrade = typeof correctedGrade?.playGrade === "string" ? correctedGrade.playGrade : null;
    if (!correctedGrade) {
      pushPredictionRecordFinding(
        findings,
        row,
        "market_aware_corrected_grade_missing",
        "high",
        "Market-aware corrected ML/Total row is missing the official corrected grade audit stamp.",
        {
          expectedCorrectedGradeRuleId: MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID,
          sideCorrectionRuleId: MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
        },
      );
      continue;
    }

    if (row.best_angle === true && !correctedBestAngle) {
      pushPredictionRecordFinding(
        findings,
        row,
        "unvalidated_corrected_row_marked_best_angle",
        "blocking",
        "Market-aware corrected row is marked Best Angle even though the corrected grade audit did not validate it as Best Angle.",
        {
          correctedPlayGrade,
          correctedBestAngle,
          correctedGradeReason: correctedGrade.reason ?? null,
        },
      );
    }

    if (correctedBestAngle && row.no_bet === true) {
      pushPredictionRecordFinding(
        findings,
        row,
        "corrected_best_angle_stale_no_bet",
        "blocking",
        "Market-aware corrected Best Angle still carries no_bet=true, likely from the pre-correction side.",
        {
          correctedPlayGrade,
          correctedBestAngle,
          correctedGradeReason: correctedGrade.reason ?? null,
        },
      );
    }

    if (!correctedBestAngle && row.play_grade !== "market_aligned") {
      pushPredictionRecordFinding(
        findings,
        row,
        "unvalidated_corrected_row_not_watchlist",
        row.best_angle === true ? "blocking" : "medium",
        "Unvalidated market-aware corrected row should remain market_aligned/Watchlist.",
        {
          correctedPlayGrade,
          correctedBestAngle,
          correctedGradeReason: correctedGrade.reason ?? null,
        },
      );
    }
  }
  return findings;
}

export function classifyFiHoldDiagnostic(sportSpecific: Record<string, unknown> | null): FiHoldDiagnostic {
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
  const sparseStarterHistory = hasSparseStarterHistory(sportSpecific, featureReasonCodes);

  let classification: FiHoldClassification = "unknown";
  let materiality: FiHoldDiagnostic["materiality"] = "medium";
  let reason = "FI side is held, but the audit payload did not identify a precise reason.";

  if (!audit) {
    classification = "mapping_bug_or_missing_audit";
    materiality = "high";
    reason = "FI side is held but the fi_v2_audit payload is missing.";
  } else if (completenessStatus === "degraded_stats_fallback" && canPublishNormal === true) {
    classification = "publishable_degraded_stats";
    materiality = "medium";
    reason = "FI side is held because some stats are using degraded fallbacks; the card can publish normally as No Play and should update when richer stats arrive.";
  } else if (completenessStatus === "provisional_lineup_pending" && canPublishNormal === true) {
    classification = "provisional_lineup_pending";
    materiality = "medium";
    reason = "FI side is held while official lineup/top-order context is pending; the card can publish normally and should update through lineup refresh.";
  } else if (sparseStarterHistory && canPublishNormal === true) {
    classification = "sparse_starter_history";
    materiality = "medium";
    reason = "FI side is held because the official starter is known but has too little first-inning starter history to publish a normal side; unrelated repair eligibility must not relabel this as an ingestion miss.";
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
  if (diagnostic.classification === "publishable_degraded_stats") return "fi_publishable_degraded_stats";
  if (diagnostic.classification === "sparse_starter_history") return "fi_sparse_starter_history";
  if (hasOnlyStarterStatsGap(diagnostic)) return "fi_sparse_starter_history";
  if (hasActualStarterIngestionGap(diagnostic)) {
    return "fi_starter_ingestion_miss";
  }
  if (
    diagnostic.classification === "missing_inputs" &&
    diagnostic.officialProbableStarters?.classification === "official_probables_complete" &&
    diagnostic.marketDataQuality === "missing"
  ) return "fi_model_hold_provider_gap";
  if (
    diagnostic.classification === "missing_inputs" &&
    diagnostic.officialProbableStarters?.classification === "official_probables_complete" &&
    diagnostic.posteriorNrfi !== null &&
    diagnostic.posteriorYrfi !== null &&
    Math.max(diagnostic.posteriorNrfi, diagnostic.posteriorYrfi) < 0.54
  ) return "fi_legit_model_toss_up";
  if (diagnostic.classification === "legit_model_toss_up") return "fi_legit_model_toss_up";
  if (diagnostic.classification === "provisional_lineup_pending") return "fi_provisional_lineup_pending";
  if (diagnostic.classification === "missing_inputs") return "fi_model_hold_missing_inputs";
  if (diagnostic.classification === "provider_gap") return "fi_model_hold_provider_gap";
  return "fi_model_hold_diagnostic_missing";
}

function fiHoldFindingSeverity(diagnostic: FiHoldDiagnostic | undefined): DailyEdgeDataHealthSeverity {
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_legit_model_toss_up") return "info";
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_sparse_starter_history") return "medium";
  if (diagnostic?.officialProbableStarters?.classification === "official_probable_starter_unannounced") return "medium";
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_model_hold_provider_gap") return "medium";
  if (diagnostic?.materiality === "medium") return "medium";
  return "high";
}

function fiHoldFindingMessage(diagnostic: FiHoldDiagnostic | undefined): string {
  const official = diagnostic?.officialProbableStarters;
  if (official?.classification === "official_probable_starter_unannounced") {
    const sides = official.missingSides.join("/");
    return `FI side is held because MLB official probable starter data is still unannounced for ${sides || "one side"}.`;
  }
  if (diagnostic?.classification === "publishable_degraded_stats") {
    return "FI side is held on degraded fallback stats; the card can publish normally as No Play.";
  }
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_sparse_starter_history") {
    return "FI side is held because the official starter is known but lacks enough first-inning starter history for a normal side.";
  }
  if (diagnostic && hasActualStarterIngestionGap(diagnostic)) {
    return "FI side is held even though MLB official probable starters are complete; this is an ingestion/mapping issue.";
  }
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_model_hold_provider_gap") {
    return "FI side is held because the sportsbook FI market is unavailable; official starter inputs are present.";
  }
  if (diagnostic && fiHoldFindingCode(diagnostic) === "fi_legit_model_toss_up") {
    return "FI side is held because the model is a legitimate toss-up; official starter inputs are present.";
  }
  return diagnostic?.reason ?? "FI model produced no actionable YRFI/NRFI side.";
}

function hasActualStarterIngestionGap(diagnostic: FiHoldDiagnostic): boolean {
  if (diagnostic.classification !== "missing_inputs") return false;
  if (diagnostic.officialProbableStarters?.classification !== "official_probables_complete") return false;
  if (hasOnlyStarterStatsGap(diagnostic)) return false;
  return diagnostic.featureReasonCodes.includes("fi_starter_missing") ||
    diagnostic.degradedFields.some((field) => /probable_pitcher|starter_missing/i.test(field));
}

function hasOnlyStarterStatsGap(diagnostic: FiHoldDiagnostic): boolean {
  if (diagnostic.classification !== "missing_inputs") return false;
  if (diagnostic.officialProbableStarters?.classification !== "official_probables_complete") return false;
  const starterFields = diagnostic.degradedFields.filter((field) => /starter/i.test(field));
  if (!starterFields.some((field) => /starter_season_stats/i.test(field))) return false;
  return starterFields.every((field) =>
    /starter_season_stats|starter_confirmation/i.test(field),
  );
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
    if (row.identity.marketType === "TOTAL" && row.priceValueEvidence.priceAmerican === null) {
      const staleOrUnavailable = /\b(stale|unavailable|no_price|no price|price missing)\b/i.test(
        row.priceValueEvidence.priceNullReason ?? "",
      );
      pushFinding(
        findings,
        row,
        staleOrUnavailable ? "total_price_stale_or_unavailable" : "total_price_missing",
        actionable ? "high" : "medium",
        staleOrUnavailable
          ? "Total market is missing a fresh trusted-book display price."
          : "Total market has no trusted-book display price in Daily Edge evidence.",
        {
          priceNullReason: row.priceValueEvidence.priceNullReason,
          priceSource: row.priceValueEvidence.priceSource,
          marketImpliedProbability: row.modelStatsEvidence.marketImpliedProbability,
          edge: row.modelStatsEvidence.edge,
        },
      );
    }
    if (actionable && row.modelStatsEvidence.edge === null) {
      pushFinding(findings, row, "actionable_edge_missing", "high", "Actionable prediction is missing model-vs-market edge.");
    }
    if (row.identity.marketType !== "FI" && sharpStatus === "sharp_context_unavailable_current_source") {
      const severity: DailyEdgeDataHealthSeverity = row.identity.sport === "mlb" ? "high" : "medium";
      pushFinding(findings, row, "ml_total_sharp_context_missing", severity, "ML/Total row is missing Sharp Book context.");
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
  const evidenceFindings = collectFindings(rows, fiHoldDiagnostics, officialMlbProbableStarters);
  const predictionRecordContractFindings = await loadPredictionRecordContractFindings({
    sport: args.sport,
    date: args.date,
    markets,
  });
  const findings = [...evidenceFindings, ...predictionRecordContractFindings];
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
    gameCount: new Set(rows.map((row) => row.identity.externalId)).size,
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
