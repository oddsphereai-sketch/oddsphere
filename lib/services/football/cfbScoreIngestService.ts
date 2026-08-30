import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBalldontlieNcaafResultsForDates } from "./balldontlieNcaafSlate";

export const CFB_SCORE_INGEST_RELEASE =
  "cfb_score_ingest_2026_08_30_r2_supported_date_filter" as const;

export type CfbScoreIngestResult = {
  release: typeof CFB_SCORE_INGEST_RELEASE;
  updatedCount: number;
  alreadyFinalCount: number;
  inProgressCount: number;
  scheduledCount: number;
  providerRequests: number;
  errors: Array<{ reason: string }>;
};

type TrackedCfbGame = {
  id: number;
  external_id: number;
  game_date: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
};

/** Exact-provider-id CFB score ingest. T-60 record creation remains writer-owned. */
export async function ingestCfbFinalScores(args: {
  supabase: SupabaseClient;
  slateDate: string;
  apply: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbScoreIngestResult> {
  const result: CfbScoreIngestResult = {
    release: CFB_SCORE_INGEST_RELEASE,
    updatedCount: 0,
    alreadyFinalCount: 0,
    inProgressCount: 0,
    scheduledCount: 0,
    providerRequests: 0,
    errors: [],
  };
  const { data, error } = await args.supabase
    .from("games")
    .select("id,external_id,game_date,status,home_score,away_score")
    .eq("sport", "cfb")
    .eq("slate_date", args.slateDate);
  if (error) throw new Error(`CFB score ingest game read failed: ${error.message}`);
  const dbGames = (data ?? []) as TrackedCfbGame[];
  if (dbGames.length === 0) return result;
  const providerDates = [...new Set(dbGames.map((game) => {
    const parsed = Date.parse(game.game_date ?? "");
    if (!Number.isFinite(parsed)) throw new Error(`CFB score ingest game ${game.external_id} has an invalid game_date.`);
    return new Date(parsed).toISOString().slice(0, 10);
  }))];
  const provider = await fetchBalldontlieNcaafResultsForDates({
    gameIds: dbGames.map((game) => String(game.external_id)),
    dates: providerDates,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
  result.providerRequests = provider.providerRequests;
  const providerById = new Map(provider.games.map((game) => [Number(game.providerGameId), game]));
  for (const dbGame of dbGames) {
    const game = providerById.get(dbGame.external_id);
    if (!game) {
      result.errors.push({ reason: `game ${dbGame.external_id}: exact BALLDONTLIE NCAAF result row unavailable` });
      continue;
    }
    const status = normalizeStatus(game.status);
    if (status === "in_progress") {
      result.inProgressCount += 1;
      continue;
    }
    if (status === "scheduled") {
      result.scheduledCount += 1;
      continue;
    }
    const voidStatus = status === "postponed" || status === "canceled";
    const homeScore = game.homeScore;
    const awayScore = game.awayScore;
    if (status === "final" && !validFinalScore(homeScore, awayScore)) {
      result.errors.push({ reason: `game ${dbGame.external_id}: final status has an invalid score` });
      continue;
    }
    if (dbGame.status === status && (voidStatus || (dbGame.home_score === homeScore && dbGame.away_score === awayScore))) {
      result.alreadyFinalCount += 1;
      continue;
    }
    if (!args.apply) {
      result.updatedCount += 1;
      continue;
    }
    const { error: updateError } = await args.supabase
      .from("games")
      .update({ status, home_score: voidStatus ? null : homeScore, away_score: voidStatus ? null : awayScore })
      .eq("id", dbGame.id)
      .eq("sport", "cfb")
      .eq("external_id", dbGame.external_id);
    if (updateError) result.errors.push({ reason: `game ${dbGame.external_id}: ${updateError.message}` });
    else result.updatedCount += 1;
  }
  return result;
}

function normalizeStatus(value: string): "scheduled" | "in_progress" | "final" | "postponed" | "canceled" {
  const normalized = value.trim().toLowerCase().replace(/^status_/, "");
  if (normalized === "final" || normalized === "completed" || normalized === "post") return "final";
  if (normalized === "in_progress" || normalized === "live") return "in_progress";
  if (normalized === "postponed") return "postponed";
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "abandoned") return "canceled";
  return "scheduled";
}

function validFinalScore(home: number | null, away: number | null): boolean {
  return home !== null && away !== null && Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0 && home + away > 0;
}
