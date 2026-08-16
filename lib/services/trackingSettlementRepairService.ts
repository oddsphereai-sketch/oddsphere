import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";

export const TRACKING_SETTLEMENT_CONTRACT_VERSION =
  "tracking_settlement_v2_bounded_stale_pending_repair_2026_08_16";

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
 * Choose historical slates where an existing pending grade can now settle
 * from data already stored in `games`. This intentionally performs no score
 * provider calls and is capped so the normal refresh remains predictable.
 */
export function selectStalePendingRepairDates(args: {
  records: readonly PendingRecordCandidate[];
  games: readonly CandidateGame[];
  beforeDate: string;
  maxDates?: number;
}): { dates: string[]; eligibleRecords: number } {
  const gameById = new Map(args.games.map((game) => [game.id, game]));
  const eligible = args.records.filter((record) => {
    if (record.slate_date >= args.beforeDate) return false;
    const game = gameById.get(record.game_id);
    if (!game) return false;
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
    candidateRecords: 0,
    eligibleRecords: 0,
    errors: [],
  };

  const { data: gradeRows, error: gradeError } = await args.supabase
    .from("prediction_grades")
    .select("prediction_record_id")
    .eq("result", "pending")
    .order("prediction_record_id", { ascending: true })
    .limit(MAX_PENDING_GRADES_SCANNED);
  if (gradeError) {
    result.errors.push(`pending grades fetch: ${gradeError.message}`);
    return result;
  }

  const recordIds = ((gradeRows ?? []) as Array<{ prediction_record_id: number }>)
    .map((row) => row.prediction_record_id);
  result.pendingGradesScanned = recordIds.length;
  if (recordIds.length === 0) return result;

  const records: PendingRecordCandidate[] = [];
  for (const idChunk of chunks(recordIds, QUERY_CHUNK_SIZE)) {
    let query = args.supabase
      .from("prediction_records")
      .select("id, game_id, slate_date, market")
      .in("id", idChunk)
      .eq("sport", args.sport)
      .lt("slate_date", args.beforeDate);
    if (args.sport === "mlb") query = query.not("locked_at", "is", null);
    const { data, error } = await query;
    if (error) {
      result.errors.push(`candidate records fetch: ${error.message}`);
      return result;
    }
    records.push(...((data ?? []) as PendingRecordCandidate[]));
  }
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
  });
  result.dates = selected.dates;
  result.eligibleRecords = selected.eligibleRecords;
  return result;
}
