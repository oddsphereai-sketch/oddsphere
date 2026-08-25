import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBalldontlieNflRegularResults } from "./balldontlieNflPreviewSlate";

export const NFL_SCORE_INGEST_RELEASE =
  "nfl_score_ingest_2026_08_25_r1_regular_exact_id" as const;

export type NflScoreIngestResult = {
  release: typeof NFL_SCORE_INGEST_RELEASE;
  updatedCount: number;
  alreadyFinalCount: number;
  inProgressCount: number;
  scheduledCount: number;
  providerRequests: number;
  errors: Array<{ reason: string }>;
};

type NflTrackedGameRow = {
  id: number;
  external_id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  provider_ids: Record<string, unknown> | null;
};

/** Exact-provider-id NFL score ingest. Prediction creation remains owned by the T-60 writer. */
export async function ingestNflFinalScores(args: {
  supabase: SupabaseClient;
  slateDate: string;
  apply: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<NflScoreIngestResult> {
  const result: NflScoreIngestResult = {
    release: NFL_SCORE_INGEST_RELEASE,
    updatedCount: 0,
    alreadyFinalCount: 0,
    inProgressCount: 0,
    scheduledCount: 0,
    providerRequests: 0,
    errors: [],
  };
  const { data, error } = await args.supabase
    .from("games")
    .select("id,external_id,status,home_score,away_score,provider_ids")
    .eq("sport", "nfl")
    .eq("slate_date", args.slateDate);
  if (error) throw new Error(`NFL score ingest game read failed: ${error.message}`);
  const dbGames = (data ?? []) as NflTrackedGameRow[];
  if (dbGames.length === 0) return result;
  const seasonWeeks = new Map<string, { season: number; week: number }>();
  for (const game of dbGames) {
    const identity = regularIdentity(game.provider_ids);
    if (!identity) {
      result.errors.push({ reason: `game ${game.external_id}: missing regular-season provider identity` });
      continue;
    }
    seasonWeeks.set(`${identity.season}:${identity.week}`, identity);
  }
  if (seasonWeeks.size > 2) throw new Error("NFL score ingest refused more than two season/week groups for one slate date.");
  const providerGames = new Map<number, Awaited<ReturnType<typeof fetchBalldontlieNflRegularResults>>["games"][number]>();
  for (const identity of seasonWeeks.values()) {
    const provider = await fetchBalldontlieNflRegularResults({
      ...identity,
      apiKey: args.apiKey,
      fetchImpl: args.fetchImpl,
    });
    result.providerRequests += provider.providerRequests;
    for (const game of provider.games) providerGames.set(Number(game.providerGameId), game);
  }
  for (const dbGame of dbGames) {
    const provider = providerGames.get(dbGame.external_id);
    if (!provider) {
      result.errors.push({ reason: `game ${dbGame.external_id}: exact BALLDONTLIE result row unavailable` });
      continue;
    }
    const status = normalizeStatus(provider.status);
    if (status === "in_progress") {
      result.inProgressCount += 1;
      continue;
    }
    if (status === "scheduled") {
      result.scheduledCount += 1;
      continue;
    }
    const voidStatus = status === "postponed" || status === "canceled";
    const homeScore = provider.homeScore ?? null;
    const awayScore = provider.awayScore ?? null;
    if (status === "final" && !validFinalScore(homeScore, awayScore)) {
      result.errors.push({ reason: `game ${dbGame.external_id}: final status has an invalid score` });
      continue;
    }
    if (
      dbGame.status === status &&
      (voidStatus || (dbGame.home_score === homeScore && dbGame.away_score === awayScore))
    ) {
      result.alreadyFinalCount += 1;
      continue;
    }
    if (!args.apply) {
      result.updatedCount += 1;
      continue;
    }
    const { error: updateError } = await args.supabase
      .from("games")
      .update({
        status,
        home_score: voidStatus ? null : homeScore,
        away_score: voidStatus ? null : awayScore,
      })
      .eq("id", dbGame.id)
      .eq("sport", "nfl")
      .eq("external_id", dbGame.external_id);
    if (updateError) result.errors.push({ reason: `game ${dbGame.external_id}: ${updateError.message}` });
    else result.updatedCount += 1;
  }
  return result;
}

function regularIdentity(providerIds: Record<string, unknown> | null): { season: number; week: number } | null {
  const raw = providerIds?.balldontlie_nfl;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const season = Number(row.season);
  const week = Number(row.week);
  return Number.isInteger(season) && Number.isInteger(week) && week >= 1 && week <= 18
    ? { season, week }
    : null;
}

function normalizeStatus(value: string): "scheduled" | "in_progress" | "final" | "postponed" | "canceled" {
  const normalized = value.trim().toLowerCase().replace(/^status_/, "");
  if (normalized === "final" || normalized === "completed" || normalized === "post") return "final";
  if (normalized === "in_progress" || normalized === "live") return "in_progress";
  if (normalized === "postponed") return "postponed";
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "abandoned") return "canceled";
  return "scheduled";
}

function validFinalScore(home: number | null, away: number | null): home is number {
  return home !== null && away !== null && Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0 && home + away > 0;
}
