import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../db/supabase";
import {
  WINNER_ACCURACY_SCORECARD_CONTRACT,
  buildWinnerAccuracyScorecards,
  type ReleaseWinnerScorecard,
  type WinnerAccuracyObservation,
  type WinnerOutcome,
  type WinnerScorecardSport,
} from "./winnerAccuracyScorecard";
import {
  filterCompleteUclLockManifestCohorts,
  isUclLockManifestRow,
  uclLockManifestCohortKey,
  type UclLockManifestRow,
} from "../ucl/uclLockManifest";

export const WINNER_ACCURACY_QUERY_PAGE_SIZE = 1_000;
export const WINNER_ACCURACY_DAILY_RECORD_CAP = 2_000;
export const WINNER_ACCURACY_GRADE_CHUNK_SIZE = 400;

export type WinnerAccuracyWindow = "nightly" | "morning" | "all";

type RecordRow = {
  id: number;
  game_id: number | null;
  external_id: number | null;
  sport: string;
  slate_date: string;
  matchup: string;
  market: string;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  model_used: string | null;
  model_version: string | null;
  calibration_version: string | null;
  model_probability: number | null;
  market_probability: number | null;
  play_grade: string | null;
  no_bet: boolean;
  locked_at: string;
  competition: string | null;
  model_layer_versions: Record<string, unknown> | null;
  decision_tuple: Record<string, unknown> | null;
  distribution_version: string | null;
  grade_policy_version: string | null;
  prediction_record_contract_version: string | null;
  epl_forecast: {
    model?: Partial<Record<WinnerOutcome, number>>;
    market?: Partial<Record<WinnerOutcome, number>>;
    displayed_side?: string;
  } | null;
  epl_model_release: string | null;
  epl_calibration_release: string | null;
  cfb_tracking_record_release: string | null;
  nfl_tracking_record_release: string | null;
  closing_line_value: {
    closing_odds_american?: number | null;
    clv_pct?: number | null;
  } | null;
};

type GradeRow = {
  prediction_record_id: number;
  win: boolean;
  loss: boolean;
  actual_home_score: number | null;
  actual_away_score: number | null;
  graded_at: string | null;
};

export const WINNER_ACCURACY_RECORD_SELECT = [
  "id", "game_id", "external_id", "sport", "slate_date", "matchup", "market",
  "pick", "side", "odds_american", "model_used", "model_version", "calibration_version",
  "model_probability", "market_probability", "play_grade", "no_bet", "locked_at",
  "competition:snapshot_json->>competition",
  "model_layer_versions:snapshot_json->model_layer_versions",
  "decision_tuple:snapshot_json->decision_tuple",
  "distribution_version:snapshot_json->>distribution_version",
  "grade_policy_version:snapshot_json->>grade_policy_version",
  "prediction_record_contract_version:snapshot_json->>prediction_record_contract_version",
  "epl_forecast:snapshot_json->forecast",
  "epl_model_release:snapshot_json->>model_release",
  "epl_calibration_release:snapshot_json->>calibration_release",
  "cfb_tracking_record_release:snapshot_json->>cfb_tracking_record_release",
  "nfl_tracking_record_release:snapshot_json->>nfl_tracking_record_release",
  "closing_line_value:snapshot_json->closing_line_value",
].join(",");

export type WinnerAccuracyMonitoringStatus = {
  state: "healthy" | "degraded" | "no_data";
  degraded: boolean;
  code: "ok" | "no_settled_rows" | "incomplete_forecast_coverage";
  winnerRows: number;
  modelProbabilityRows: number;
  marketProbabilityRows: number;
  omittedIncompleteRows: number;
};

export type WinnerAccuracyScorecardQueryResult = {
  contract: typeof WINNER_ACCURACY_SCORECARD_CONTRACT;
  generatedAt: string;
  timeZone: "America/New_York";
  window: WinnerAccuracyWindow;
  lockedDate: string | null;
  lockedFrom: string | null;
  lockedTo: string | null;
  source: "prediction_records + prediction_grades (SELECT-only)";
  settledRows: number;
  omittedIncompleteRows: number;
  scorecards: ReleaseWinnerScorecard[];
  monitoring: WinnerAccuracyMonitoringStatus;
};

type QueryOptions = {
  window: WinnerAccuracyWindow;
  lockedDate: string | null;
  recordCap?: number;
};

type ReadClient = Pick<SupabaseClient, "from">;

const UCL_LOCK_MANIFEST_SELECT = [
  "game_id", "external_id", "sport", "slate_date", "market", "model_version",
  "calibration_version", "locked_at", "competition:snapshot_json->>competition",
].join(",");

function localParts(instant: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
}

export function etDate(instant: Date): string {
  const parts = localParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function previousDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid ET date.");
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function zonedMidnightUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = target;
  for (let pass = 0; pass < 3; pass++) {
    const parts = localParts(new Date(candidate));
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

export function utcBoundsForEtDate(date: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid ET date.");
  const from = zonedMidnightUtc(date);
  const to = zonedMidnightUtc(nextDate(date));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error("Could not resolve ET day boundaries.");
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function resolveLockedDate(
  window: Exclude<WinnerAccuracyWindow, "all">,
  requestedDate: string | null,
  now = new Date(),
): string {
  if (requestedDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new Error("Invalid date; expected YYYY-MM-DD.");
    return requestedDate;
  }
  const today = etDate(now);
  return window === "morning" ? previousDate(today) : today;
}

function scalar(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function releaseKey(row: RecordRow, sport: WinnerScorecardSport): string {
  const layer = row.model_layer_versions ?? {};
  const decision = row.decision_tuple ?? {};
  if (sport === "mlb") {
    return [
      scalar(layer.decision_release_id ?? row.model_version),
      scalar(layer.active_probability_head),
      scalar(layer.calibration_version ?? row.calibration_version),
    ].join(" :: ");
  }
  if (sport === "cfb") {
    return [
      scalar(decision.modelRelease ?? row.model_used),
      scalar(decision.decisionRelease ?? row.model_version),
      scalar(decision.calibrationRelease ?? row.calibration_version),
      scalar(row.cfb_tracking_record_release),
    ].join(" :: ");
  }
  if (sport === "wnba") {
    return [
      scalar(row.model_version),
      scalar(row.distribution_version),
      scalar(row.grade_policy_version),
      scalar(row.prediction_record_contract_version),
    ].join(" :: ");
  }
  if (sport === "nfl") {
    return [
      scalar(decision.modelRelease ?? row.model_used),
      scalar(decision.decisionRelease ?? row.model_version),
      scalar(decision.calibrationRelease ?? row.calibration_version),
      scalar(row.nfl_tracking_record_release),
    ].join(" :: ");
  }
  if (sport === "epl" || sport === "ucl") {
    return [
      scalar(row.epl_model_release ?? row.model_version),
      scalar(row.epl_calibration_release ?? row.calibration_version),
    ].join(" :: ");
  }
  return [scalar(row.model_used), scalar(row.model_version), scalar(row.calibration_version)].join(" :: ");
}

function side(value: string | null): WinnerOutcome | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "home" || normalized === "away" || normalized === "draw" ? normalized : null;
}

function complement(value: WinnerOutcome): WinnerOutcome | null {
  return value === "home" ? "away" : value === "away" ? "home" : null;
}

function observation(row: RecordRow, grade: GradeRow): WinnerAccuracyObservation | null {
  if ((!grade.win && !grade.loss) || grade.graded_at === null) return null;
  const sport: WinnerScorecardSport = row.sport === "soccer"
    ? row.competition === "uefa_champions_league" ? "ucl" : "epl"
    : row.sport as WinnerScorecardSport;
  const modelPick = side(sport === "epl" || sport === "ucl" ? row.epl_forecast?.displayed_side ?? row.side ?? row.pick : row.side);
  if (modelPick === null) return null;
  let actualOutcome: WinnerOutcome;
  let modelProbabilities: Partial<Record<WinnerOutcome, number>>;
  let marketProbabilities: Partial<Record<WinnerOutcome, number>> | null;
  if (sport === "epl" || sport === "ucl") {
    if (grade.actual_home_score === null || grade.actual_away_score === null) return null;
    actualOutcome = grade.actual_home_score > grade.actual_away_score
      ? "home" : grade.actual_home_score < grade.actual_away_score ? "away" : "draw";
    modelProbabilities = row.epl_forecast?.model ?? {};
    marketProbabilities = row.epl_forecast?.market ?? null;
  } else {
    const opposite = complement(modelPick);
    if (opposite === null) return null;
    actualOutcome = grade.win ? modelPick : opposite;
    modelProbabilities = row.model_probability === null
      ? {} : { [modelPick]: row.model_probability, [opposite]: 1 - row.model_probability };
    marketProbabilities = row.market_probability === null
      ? null : { [modelPick]: row.market_probability, [opposite]: 1 - row.market_probability };
  }
  const closingPrice = row.closing_line_value?.closing_odds_american;
  const clvPct = row.closing_line_value?.clv_pct;
  return {
    recordId: row.id,
    sport,
    gameKey: `${sport}:${row.game_id ?? row.external_id ?? row.matchup}`,
    releaseKey: releaseKey(row, sport),
    lockedAt: row.locked_at,
    settledAt: grade.graded_at,
    modelPick,
    actualOutcome,
    modelProbabilities,
    marketProbabilities,
    exactPriceAmerican: Number.isFinite(row.odds_american) ? row.odds_american : null,
    playGrade: row.play_grade,
    noBet: row.no_bet,
    closingPriceAmerican: Number.isFinite(closingPrice) ? closingPrice as number : null,
    clvPct: Number.isFinite(clvPct) ? clvPct as number : null,
  };
}

function monitoringFor(
  settledRows: number,
  omittedIncompleteRows: number,
  scorecards: ReleaseWinnerScorecard[],
): WinnerAccuracyMonitoringStatus {
  const winnerRows = scorecards.reduce((sum, row) => sum + row.winnerAccuracy.sample, 0);
  const modelProbabilityRows = scorecards.reduce((sum, row) => sum + row.modelProbability.sample, 0);
  const marketProbabilityRows = scorecards.reduce((sum, row) => sum + row.marketProbability.sample, 0);
  if (settledRows === 0) {
    return {
      state: "no_data", degraded: false, code: "no_settled_rows",
      winnerRows, modelProbabilityRows, marketProbabilityRows, omittedIncompleteRows,
    };
  }
  const degraded = omittedIncompleteRows > 0
    || modelProbabilityRows < winnerRows
    || marketProbabilityRows < winnerRows;
  return {
    state: degraded ? "degraded" : "healthy",
    degraded,
    code: degraded ? "incomplete_forecast_coverage" : "ok",
    winnerRows,
    modelProbabilityRows,
    marketProbabilityRows,
    omittedIncompleteRows,
  };
}

async function fetchRecords(
  client: ReadClient,
  bounds: { from: string; to: string } | null,
  recordCap: number,
): Promise<RecordRow[]> {
  const rows: RecordRow[] = [];
  for (let start = 0; start < recordCap; start += WINNER_ACCURACY_QUERY_PAGE_SIZE) {
    let query = client.from("prediction_records")
      .select(WINNER_ACCURACY_RECORD_SELECT)
      .in("sport", ["mlb", "nfl", "cfb", "wnba", "soccer"])
      .in("market", ["moneyline", "match_result"])
      .not("locked_at", "is", null);
    if (bounds !== null) query = query.gte("locked_at", bounds.from).lt("locked_at", bounds.to);
    const limit = Math.min(WINNER_ACCURACY_QUERY_PAGE_SIZE, recordCap - start);
    const { data, error } = await query.order("id", { ascending: true }).range(start, start + limit - 1);
    if (error) throw new Error(`prediction_records read failed: ${error.message}`);
    const page = (data ?? []) as unknown as RecordRow[];
    rows.push(...page);
    if (page.length < limit) break;
    if (rows.length >= recordCap) {
      throw new Error(`Winner-accuracy record cap reached (${recordCap}); refusing a partial scorecard.`);
    }
  }
  return rows.filter((row) => row.sport !== "soccer" || row.competition === "english_premier_league" || row.competition === "uefa_champions_league");
}

async function fetchGrades(client: ReadClient, recordIds: number[]): Promise<GradeRow[]> {
  const rows: GradeRow[] = [];
  for (let index = 0; index < recordIds.length; index += WINNER_ACCURACY_GRADE_CHUNK_SIZE) {
    const { data, error } = await client.from("prediction_grades")
      .select("prediction_record_id,win,loss,actual_home_score,actual_away_score,graded_at")
      .in("prediction_record_id", recordIds.slice(index, index + WINNER_ACCURACY_GRADE_CHUNK_SIZE));
    if (error) throw new Error(`prediction_grades read failed: ${error.message}`);
    rows.push(...((data ?? []) as GradeRow[]));
  }
  return rows;
}

async function excludePartialUclWinnerCohorts(
  client: ReadClient,
  records: RecordRow[],
): Promise<RecordRow[]> {
  const uclWinners = records.filter(isUclLockManifestRow);
  if (uclWinners.length === 0) return records;

  const gameIds = [...new Set(uclWinners.map((row) => row.game_id).filter((id): id is number => id !== null))];
  const manifestRows: UclLockManifestRow[] = [];
  for (let index = 0; index < gameIds.length; index += WINNER_ACCURACY_GRADE_CHUNK_SIZE) {
    const { data, error } = await client.from("prediction_records")
      .select(UCL_LOCK_MANIFEST_SELECT)
      .eq("sport", "soccer")
      .contains("snapshot_json", { competition: "uefa_champions_league" })
      .not("locked_at", "is", null)
      .in("game_id", gameIds.slice(index, index + WINNER_ACCURACY_GRADE_CHUNK_SIZE));
    if (error) throw new Error(`UCL lock-manifest read failed: ${error.message}`);
    manifestRows.push(...((data ?? []) as unknown as UclLockManifestRow[]));
  }

  const completeKeys = new Set(filterCompleteUclLockManifestCohorts(manifestRows)
    .map(uclLockManifestCohortKey)
    .filter((key): key is string => key !== null));
  return records.filter((row) => {
    if (!isUclLockManifestRow(row)) return true;
    const key = uclLockManifestCohortKey(row);
    return key !== null && completeKeys.has(key);
  });
}

export async function loadWinnerAccuracyScorecards(
  options: QueryOptions,
  client: ReadClient = supabase,
): Promise<WinnerAccuracyScorecardQueryResult> {
  if (options.window !== "all" && options.lockedDate === null) throw new Error("Daily windows require a locked date.");
  const recordCap = options.recordCap ?? WINNER_ACCURACY_DAILY_RECORD_CAP;
  if (!Number.isInteger(recordCap) || recordCap < 1 || recordCap > 10_000) throw new Error("Invalid record cap.");
  const bounds = options.lockedDate === null ? null : utcBoundsForEtDate(options.lockedDate);
  const records = await excludePartialUclWinnerCohorts(
    client,
    await fetchRecords(client, bounds, recordCap),
  );
  const grades = await fetchGrades(client, records.map((row) => row.id));
  const gradeById = new Map(grades.map((grade) => [grade.prediction_record_id, grade]));
  const settled = records.filter((row) => {
    const grade = gradeById.get(row.id);
    return grade !== undefined && (grade.win || grade.loss) && grade.graded_at !== null;
  });
  const observations = settled.map((row) => observation(row, gradeById.get(row.id) as GradeRow))
    .filter((row): row is WinnerAccuracyObservation => row !== null);
  const scorecards = buildWinnerAccuracyScorecards(observations);
  const omittedIncompleteRows = settled.length - observations.length;
  return {
    contract: WINNER_ACCURACY_SCORECARD_CONTRACT,
    generatedAt: new Date().toISOString(),
    timeZone: "America/New_York",
    window: options.window,
    lockedDate: options.lockedDate,
    lockedFrom: bounds?.from ?? null,
    lockedTo: bounds?.to ?? null,
    source: "prediction_records + prediction_grades (SELECT-only)",
    settledRows: settled.length,
    omittedIncompleteRows,
    scorecards,
    monitoring: monitoringFor(settled.length, omittedIncompleteRows, scorecards),
  };
}
