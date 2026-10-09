import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";

export const TRACKING_SETTLEMENT_CONTRACT_VERSION =
  "tracking_settlement_v6_missing_grade_cfb_provider_catchup_2026_10_09";

const MAX_PENDING_GRADES_SCANNED = 1_000;
const MAX_REPAIR_DATES_PER_RUN = 3;
const QUERY_CHUNK_SIZE = 500;

type PendingRecordCandidate = {
  id: number;
  game_id: number;
  slate_date: string;
  market: string;
};

type CandidateGame = {
  id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  first_inning_runs: number | null;
};

export type StalePendingRepairDiscovery = {
  dates: string[];
  pendingGradesScanned: number;
  missingGradesScanned: number;
  candidateRecords: number;
  eligibleRecords: number;
  errors: string[];
};

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isTerminalStatus(status: string | null): boolean {
  const normalized = (status ?? "").trim().toLowerCase().replace(/^status_/, "");
  return normalized === "final" ||
    normalized === "completed" ||
    normalized === "off" ||
    normalized.startsWith("final_") ||
    normalized === "postponed" ||
    normalized === "canceled" ||
    normalized === "cancelled";
}

function isVoidStatus(status: string | null): boolean {
  const normalized = (status ?? "").trim().toLowerCase().replace(/^status_/, "");
  return normalized === "postponed" || normalized === "canceled" || normalized === "cancelled";
}

/**
 * Choose historical slates where an existing pending grade can now settle.
 * The default remains database-only. MLB and CFB may explicitly include
 * incomplete stored outcomes because their callers perform one authoritative
 * slate read before grading. The date count is capped so refresh cost stays
 * predictable.
 */
export function selectStalePendingRepairDates(args: {
  records: readonly PendingRecordCandidate[];
  games: readonly CandidateGame[];
  beforeDate: string;
  maxDates?: number;
  /**
   * MLB and CFB can recover a historical terminal state from their existing
   * authoritative score providers. Other sports remain database-only so a
   * generic repair pass never invents or broadens provider work.
   */
  includeIncompleteOutcomes?: boolean;
}): { dates: string[]; eligibleRecords: number } {
  const gameById = new Map(args.games.map((game) => [game.id, game]));
  const eligible = args.records.filter((record) => {
    if (record.slate_date >= args.beforeDate) return false;
    const game = gameById.get(record.game_id);
    if (!game) return false;
    if (args.includeIncompleteOutcomes === true) return true;
    if (record.market === "first_inning") {
      return game.first_inning_runs !== null || isVoidStatus(game.status);
    }
    return isVoidStatus(game.status) ||
      (isTerminalStatus(game.status) && game.home_score !== null && game.away_score !== null);
  });
  const dates = Array.from(new Set(eligible.map((record) => record.slate_date)))
    .sort()
    .slice(0, args.maxDates ?? MAX_REPAIR_DATES_PER_RUN);
  return { dates, eligibleRecords: eligible.length };
}

export async function discoverStalePendingRepairDates(args: {
  supabase: SupabaseClient;
  sport: Sport;
  beforeDate: string;
}): Promise<StalePendingRepairDiscovery> {
  const result: StalePendingRepairDiscovery = {
    dates: [],
    pendingGradesScanned: 0,
    missingGradesScanned: 0,
    candidateRecords: 0,
    eligibleRecords: 0,
    errors: [],
  };

  // Filter by sport before applying the bounded limit. The former two-step
  // query selected the first 1,000 pending grades across every sport, then
  // filtered them to the requested sport. A busy cross-sport ledger could
  // therefore starve older MLB rows forever even though they were repairable.
  let pendingRecordsQuery = args.supabase
    .from("prediction_records")
    .select("id, game_id, slate_date, market, prediction_grades!inner(result)")
    .eq("sport", args.sport)
    .eq("prediction_grades.result", "pending")
    .lt("slate_date", args.beforeDate)
    .order("id", { ascending: true })
    .limit(MAX_PENDING_GRADES_SCANNED);
  if (args.sport === "mlb" || args.sport === "cfb") {
    pendingRecordsQuery = pendingRecordsQuery.not("locked_at", "is", null);
  }
  const { data: pendingRecordRows, error: pendingRecordError } = await pendingRecordsQuery;
  if (pendingRecordError) {
    result.errors.push(`candidate pending records fetch: ${pendingRecordError.message}`);
    return result;
  }

  result.pendingGradesScanned = pendingRecordRows?.length ?? 0;

  // A locked record with no prediction_grades row is also member-visible as
  // pending. That was the September CFB failure mode: the result provider was
  // missed, no pending grade row was ever inserted, and the old discovery
  // could therefore never find the record. Restrict this anti-join to the two
  // sports with a bounded authoritative historical provider catch-up.
  let missingRecordRows: typeof pendingRecordRows = [];
  if (args.sport === "mlb" || args.sport === "cfb") {
    const missingQuery = await args.supabase
      .from("prediction_records")
      .select("id, game_id, slate_date, market, prediction_grades!left(result)")
      .eq("sport", args.sport)
      .not("locked_at", "is", null)
      .lt("slate_date", args.beforeDate)
      // PostgREST anti-join: filter on the embedded resource itself. Filtering
      // `prediction_grades.result IS NULL` would retain every parent row while
      // merely emptying the embedded child, falsely classifying graded rows.
      .is("prediction_grades", null)
      .order("id", { ascending: true })
      .limit(MAX_PENDING_GRADES_SCANNED);
    if (missingQuery.error) {
      result.errors.push(`candidate missing-grade records fetch: ${missingQuery.error.message}`);
      return result;
    }
    missingRecordRows = missingQuery.data ?? [];
    result.missingGradesScanned = missingRecordRows.length;
  }

  const recordRows = Array.from(
    new Map(
      [...(pendingRecordRows ?? []), ...(missingRecordRows ?? [])]
        .map((row) => [Number(row.id), row] as const),
    ).values(),
  )
    .sort((a, b) => Number(a.id) - Number(b.id))
    .slice(0, MAX_PENDING_GRADES_SCANNED);

  const records = (recordRows ?? []).map((row) => ({
    id: Number(row.id),
    game_id: Number(row.game_id),
    slate_date: String(row.slate_date),
    market: String(row.market),
  })) as PendingRecordCandidate[];
  result.candidateRecords = records.length;
  if (records.length === 0) return result;

  const gameIds = Array.from(new Set(records.map((record) => record.game_id)));
  const games: CandidateGame[] = [];
  for (const idChunk of chunks(gameIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await args.supabase
      .from("games")
      .select("id, status, home_score, away_score, first_inning_runs")
      .in("id", idChunk);
    if (error) {
      result.errors.push(`candidate games fetch: ${error.message}`);
      return result;
    }
    games.push(...((data ?? []) as CandidateGame[]));
  }

  const selected = selectStalePendingRepairDates({
    records,
    games,
    beforeDate: args.beforeDate,
    includeIncompleteOutcomes: args.sport === "mlb" || args.sport === "cfb",
  });
  result.dates = selected.dates;
  result.eligibleRecords = selected.eligibleRecords;
  return result;
}
