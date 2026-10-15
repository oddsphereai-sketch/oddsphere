/**
 * Immutable shadow capture for BALLDONTLIE NBA GOAT team features.
 *
 * This service never updates the active nba_team_ratings table and therefore
 * cannot change a prediction. It appends a dated provider snapshot for
 * chronological research and resumes an incomplete same-release batch safely.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchNbaBdlTeamFeatureSnapshot,
  NBA_BDL_GOAT_TEAM_FEATURE_RELEASE,
  type NbaBdlSeasonType,
  type NbaBdlTeamFeatureSelection,
} from "./balldontlieNbaGoat";

export type CaptureNbaBdlTeamFeaturesResult = {
  apply: boolean;
  release: typeof NBA_BDL_GOAT_TEAM_FEATURE_RELEASE;
  batchId: number | null;
  status: "dry_run" | "complete" | "already_complete";
  providerRequests: number;
  selectionsRequested: number;
  observationsFetched: number;
  observationsWritten: number;
  teamsMatched: number;
  unmatchedAbbreviations: string[];
};

type TeamRow = { id: number; abbreviation: string };
type BatchRow = { id: number; status: string };

function assertAsOfDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("NBA GOAT capture asOfDate must be a valid YYYY-MM-DD date.");
  }
}

export async function captureNbaBdlTeamFeatures(args: {
  supabase: SupabaseClient;
  season: number;
  seasonType: NbaBdlSeasonType;
  asOfDate: string;
  apply: boolean;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  manifest?: readonly NbaBdlTeamFeatureSelection[];
}): Promise<CaptureNbaBdlTeamFeaturesResult> {
  assertAsOfDate(args.asOfDate);
  const snapshot = await fetchNbaBdlTeamFeatureSnapshot({
    season: args.season,
    seasonType: args.seasonType,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
    manifest: args.manifest,
  });

  const { data: teamData, error: teamError } = await args.supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "nba");
  if (teamError) throw new Error(`NBA GOAT capture could not load NBA teams: ${teamError.message}`);
  const teams = (teamData ?? []) as TeamRow[];
  const internalTeamIdByAbbreviation = new Map(
    teams.map((team) => [team.abbreviation.trim().toUpperCase(), team.id]),
  );
  const unmatchedAbbreviations = Array.from(
    new Set(
      snapshot.observations
        .filter((row) => !internalTeamIdByAbbreviation.has(row.abbreviation))
        .map((row) => row.abbreviation),
    ),
  ).sort();
  if (unmatchedAbbreviations.length > 0) {
    throw new Error(
      `NBA GOAT capture has unmatched provider teams: ${unmatchedAbbreviations.join(", ")}.`,
    );
  }
  const matchedTeamIds = new Set(
    snapshot.observations.map((row) => internalTeamIdByAbbreviation.get(row.abbreviation)!),
  );

  const baseResult = {
    apply: args.apply,
    release: NBA_BDL_GOAT_TEAM_FEATURE_RELEASE,
    providerRequests: snapshot.providerRequests,
    selectionsRequested: snapshot.selectionsRequested,
    observationsFetched: snapshot.observations.length,
    teamsMatched: matchedTeamIds.size,
    unmatchedAbbreviations,
  } as const;
  if (!args.apply) {
    return {
      ...baseResult,
      batchId: null,
      status: "dry_run",
      observationsWritten: 0,
    };
  }

  const identity = {
    provider: "balldontlie",
    release: NBA_BDL_GOAT_TEAM_FEATURE_RELEASE,
    season: args.season,
    season_type: args.seasonType,
    as_of_date: args.asOfDate,
  };
  const { data: existingBatch, error: existingError } = await args.supabase
    .from("nba_stat_capture_batches")
    .select("id, status")
    .match(identity)
    .maybeSingle();
  if (existingError) {
    throw new Error(`NBA GOAT capture batch lookup failed: ${existingError.message}`);
  }
  if ((existingBatch as BatchRow | null)?.status === "complete") {
    return {
      ...baseResult,
      batchId: (existingBatch as BatchRow).id,
      status: "already_complete",
      observationsWritten: 0,
    };
  }

  let batchId = (existingBatch as BatchRow | null)?.id ?? null;
  if (batchId === null) {
    const { data: inserted, error: insertBatchError } = await args.supabase
      .from("nba_stat_capture_batches")
      .insert({
        ...identity,
        status: "in_progress",
        fetched_at: snapshot.fetchedAt,
        provider_requests: snapshot.providerRequests,
        selections_requested: snapshot.selectionsRequested,
      })
      .select("id")
      .single();
    if (insertBatchError) {
      throw new Error(`NBA GOAT capture batch insert failed: ${insertBatchError.message}`);
    }
    batchId = (inserted as { id: number }).id;
  } else {
    const { data: resumed, error: resumeError } = await args.supabase
      .from("nba_stat_capture_batches")
      .update({
        status: "in_progress",
        fetched_at: snapshot.fetchedAt,
        provider_requests: snapshot.providerRequests,
        selections_requested: snapshot.selectionsRequested,
        completed_at: null,
        error_message: null,
      })
      .eq("id", batchId)
      .neq("status", "complete")
      .select("id")
      .maybeSingle();
    if (resumeError) {
      throw new Error(`NBA GOAT capture batch resume failed: ${resumeError.message}`);
    }
    if (!(resumed as { id?: number } | null)?.id) {
      throw new Error("NBA GOAT capture batch could not be resumed without changing a completed batch.");
    }
  }

  const rows = snapshot.observations.map((observation) => ({
    batch_id: batchId,
    team_id: internalTeamIdByAbbreviation.get(observation.abbreviation)!,
    provider_team_id: observation.providerTeamId,
    team_abbreviation: observation.abbreviation,
    category: observation.category,
    stat_type: observation.statType ?? "none",
    research_role: observation.researchRole,
    stats_json: observation.stats,
    source_path: observation.sourcePath,
  }));
  const { data: written, error: observationError } = await args.supabase
    .from("nba_team_stat_observations")
    .upsert(rows, {
      onConflict: "batch_id,team_id,category,stat_type",
      ignoreDuplicates: true,
    })
    .select("id");
  if (observationError) {
    await args.supabase
      .from("nba_stat_capture_batches")
      .update({ status: "failed", error_message: observationError.message })
      .eq("id", batchId);
    throw new Error(`NBA GOAT team observation insert failed: ${observationError.message}`);
  }

  const { count, error: countError } = await args.supabase
    .from("nba_team_stat_observations")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);
  if (countError) throw new Error(`NBA GOAT capture verification failed: ${countError.message}`);
  if ((count ?? 0) !== rows.length) {
    await args.supabase
      .from("nba_stat_capture_batches")
      .update({
        status: "failed",
        error_message: `Expected ${rows.length} immutable rows, found ${count ?? 0}.`,
      })
      .eq("id", batchId)
      .neq("status", "complete");
    throw new Error(
      `NBA GOAT capture incomplete: expected ${rows.length} immutable rows, found ${count ?? 0}.`,
    );
  }

  const { data: completed, error: completeError } = await args.supabase
    .from("nba_stat_capture_batches")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      observation_count: count ?? 0,
      error_message: null,
    })
    .eq("id", batchId)
    .eq("status", "in_progress")
    .select("id")
    .maybeSingle();
  if (completeError) throw new Error(`NBA GOAT capture completion failed: ${completeError.message}`);
  if (!(completed as { id?: number } | null)?.id) {
    throw new Error("NBA GOAT capture completion lost its in-progress batch ownership.");
  }

  return {
    ...baseResult,
    batchId,
    status: "complete",
    observationsWritten: (written ?? []).length,
  };
}
