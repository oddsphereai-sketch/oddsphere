import { randomUUID } from "node:crypto";

import { acquireCronJobLeaseWithRetry } from "../../lib/cron/leaseRetry";
import {
  acquireCronJobLease,
  cronJobName,
  releaseCronJobLease,
} from "../../lib/cron/leases";
import { supabase } from "../../lib/db/supabase";
import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import { refreshDailyEdgeResponseSnapshot } from "../../lib/services/labResponseSnapshotWriter";
import {
  fetchMlbStatsScheduleRaw,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import { parseMlbStatsSchedule } from "../../lib/services/starterResolver";

type GameRow = {
  id: number;
  external_id: number;
  slate_status: string;
  provider_ids: unknown;
  home_team: { abbreviation: string | null } | null;
  away_team: { abbreviation: string | null } | null;
};

const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
const slateDate = dateArg?.slice("--date=".length) ?? new Date().toLocaleDateString("en-CA", {
  timeZone: "America/New_York",
});
const apply = process.argv.includes("--apply");

function mlbStatsGamePk(providerIds: unknown): number | null {
  if (!providerIds || typeof providerIds !== "object") return null;
  const value = (providerIds as Record<string, unknown>).mlb_stats;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  if (typeof id === "number" && Number.isInteger(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
}

async function writeAudit(args: {
  actionType: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const { error } = await supabase.from("admin_audit_log").insert({
    action_type: args.actionType,
    target_table: "games",
    target_id: null,
    before_state: args.before,
    after_state: args.after,
    source_type: "manual",
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

async function main() {
  const officialRaw = await fetchMlbStatsScheduleRaw(slateDate, {
    quiet: true,
    signal: AbortSignal.timeout(8_000),
  });
  const official = parseMlbStatsSchedule(officialRaw);
  if (official.length === 0) {
    throw new Error(`MLB Stats has no supported official games for ${slateDate}; refusing repair.`);
  }
  const officialPks = new Set(official.map((game) => game.gamePk));
  const officialTbdPks = new Set(
    ((officialRaw as {
      dates?: Array<{
        games?: Array<{
          gamePk?: number;
          gameType?: string;
          teams?: {
            home?: { probablePitcher?: unknown };
            away?: { probablePitcher?: unknown };
          };
        }>;
      }>;
    }).dates ?? [])
      .flatMap((day) => day.games ?? [])
      .filter((game) =>
        typeof game.gamePk === "number" &&
        game.gameType !== "A" &&
        game.gameType !== "S" &&
        game.gameType !== "E" &&
        game.teams?.home?.probablePitcher == null &&
        game.teams?.away?.probablePitcher == null,
      )
      .map((game) => game.gamePk as number),
  );

  const { data, error } = await supabase
    .from("games")
    .select(
      "id, external_id, slate_status, provider_ids, " +
      "home_team:home_team_id ( abbreviation ), " +
      "away_team:away_team_id ( abbreviation )",
    )
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .order("id", { ascending: true });
  if (error) throw new Error(`game read failed: ${error.message}`);
  const games = (data ?? []) as unknown as GameRow[];
  const officialRows = games.filter((game) => {
    const gamePk = mlbStatsGamePk(game.provider_ids);
    return gamePk !== null && officialPks.has(gamePk);
  });
  const unverifiedRows = games.filter((game) => !officialRows.some((row) => row.id === game.id));
  const unverifiedRowsToHide = unverifiedRows.filter((game) => game.slate_status !== "hidden");
  if (officialRows.length !== official.length) {
    throw new Error(
      `Official/local identity mismatch: official=${official.length}, matched rows=${officialRows.length}; refusing repair.`,
    );
  }

  const officialExternalIds = officialRows.map((game) => game.external_id);
  const verifiedOfficialTbdStarterExternalIds = officialRows.flatMap((game) => {
    const gamePk = mlbStatsGamePk(game.provider_ids);
    return gamePk !== null && officialTbdPks.has(gamePk) ? [game.external_id] : [];
  });
  const dryRun = await generatePredictionsForSlate("mlb", slateDate, "morning_draft", {
    writeToDb: false,
    gameExternalIdsFilter: officialExternalIds,
    verifiedOfficialTbdStarterExternalIds,
    respectLocks: true,
  });
  const report = {
    mode: apply ? "apply" : "dry_run",
    slateDate,
    officialGames: official.map((game) => ({
      gamePk: game.gamePk,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      gameDate: game.gameDate,
    })),
    officialRows: officialRows.map((game) => ({
      id: game.id,
      externalId: game.external_id,
      matchup: `${game.away_team?.abbreviation ?? "?"}@${game.home_team?.abbreviation ?? "?"}`,
      slateStatus: game.slate_status,
    })),
    rowsToHide: unverifiedRowsToHide.map((game) => ({
      id: game.id,
      externalId: game.external_id,
      matchup: `${game.away_team?.abbreviation ?? "?"}@${game.home_team?.abbreviation ?? "?"}`,
      slateStatus: game.slate_status,
    })),
    predictionDryRun: {
      gameCount: dryRun.game_count,
      predictionCount: dryRun.predictions.length,
      heldCount: dryRun.held_count,
      errors: dryRun.errors,
      predictions: dryRun.predictions.map((prediction) => ({
        externalId: prediction.game_external_id,
        homeScore: prediction.predicted_home_score,
        awayScore: prediction.predicted_away_score,
        ml: prediction.predicted_ml_winner,
        total: prediction.predicted_ou_side,
        modelVersion: prediction.sport_specific.model_version,
        completeness: prediction.sport_specific.mlb_data_completeness,
      })),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    dryRun.errors.length > 0 ||
    dryRun.predictions.length !== officialRows.length ||
    dryRun.predictions.some((prediction) =>
      prediction.predicted_home_score === null ||
      prediction.predicted_away_score === null ||
      prediction.predicted_ml_winner === null ||
      prediction.predicted_ou_side === null
    )
  ) {
    throw new Error("Official-game dry run did not produce one coherent full-game prediction per game.");
  }
  if (!apply) return;

  const publishStatus = dryRun.predictions.every(
    (prediction) =>
      (prediction.sport_specific.mlb_data_completeness as
        | { can_publish_normal?: unknown }
        | null
        | undefined)?.can_publish_normal === true,
  )
    ? "published"
    : "preview_only";
  const canPublishNormal = publishStatus === "published";

  const runId = randomUUID();
  const jobName = cronJobName("prediction_pipeline", "mlb");
  const acquired = await acquireCronJobLeaseWithRetry({
    jobName,
    runId,
    leaseSeconds: 8 * 60,
    maxWaitMs: 20_000,
    retryIntervalMs: 1_000,
  }, { acquire: acquireCronJobLease });
  if (acquired.lease.mode !== "acquired") {
    throw new Error(`Required MLB prediction-pipeline lease was not acquired (${acquired.lease.mode}).`);
  }

  try {
    if (unverifiedRowsToHide.length > 0) {
      const extraIds = unverifiedRowsToHide.map((game) => game.id);
      const { error: hideError } = await supabase
        .from("games")
        .update({ slate_status: "hidden" })
        .in("id", extraIds);
      if (hideError) throw new Error(`conditional-row hide failed: ${hideError.message}`);
      await writeAudit({
        actionType: "slate.hide_unverified_mlb_official_schedule",
        before: { sport: "mlb", date: slateDate, gameIds: extraIds },
        after: { sport: "mlb", date: slateDate, gameIds: extraIds, slate_status: "hidden" },
      });
    }

    if (!canPublishNormal) {
      const officialIds = officialRows.map((game) => game.id);
      const { count: memberRecordCount, error: memberRecordError } = await supabase
        .from("prediction_records")
        .select("id", { count: "exact", head: true })
        .in("game_id", officialIds);
      if (memberRecordError) {
        throw new Error(`pending-card member-record guard failed: ${memberRecordError.message}`);
      }
      if ((memberRecordCount ?? 0) !== 0) {
        throw new Error("Refusing pending-card recovery because a member prediction record already exists.");
      }

      const { data: priorPredictions, error: priorPredictionError } = await supabase
        .from("game_predictions")
        .select("id, locked_at, sport_specific")
        .in("game_id", officialIds);
      if (priorPredictionError) {
        throw new Error(`pending-card prediction guard failed: ${priorPredictionError.message}`);
      }
      const removablePredictionIds = (priorPredictions ?? []).map((row) => {
        const sportSpecific = row.sport_specific as Record<string, unknown> | null;
        const completeness = sportSpecific?.mlb_data_completeness as
          | Record<string, unknown>
          | null
          | undefined;
        if (
          row.locked_at !== null ||
          sportSpecific?.model_version !== "auto_v2.2_mlb_full_game_projection" ||
          completeness?.status !== "incomplete_missing_required_data" ||
          !Array.isArray(completeness?.missing_fields) ||
          !completeness.missing_fields.includes("home_probable_pitcher") ||
          !completeness.missing_fields.includes("away_probable_pitcher")
        ) {
          throw new Error("Refusing to remove a prediction that is not the exact unlocked both-starters-missing fallback.");
        }
        return row.id as number;
      });
      if (removablePredictionIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("game_predictions")
          .delete()
          .in("id", removablePredictionIds);
        if (deleteError) throw new Error(`pending-card rollback failed: ${deleteError.message}`);
      }

      const { error: pendingPublishError } = await supabase
        .from("games")
        .update({ slate_status: "published" })
        .in("id", officialIds)
        .eq("slate_status", "draft");
      if (pendingPublishError) {
        throw new Error(`official pending-card publish failed: ${pendingPublishError.message}`);
      }
      await writeAudit({
        actionType: "slate.publish_verified_mlb_pending_starters",
        before: { sport: "mlb", date: slateDate, gameIds: officialIds, slate_status: "draft" },
        after: {
          sport: "mlb",
          date: slateDate,
          gameIds: officialIds,
          slate_status: "published",
          prediction_status: "pending_official_starters",
        },
      });
      console.log(JSON.stringify({
        repaired: true,
        pendingOfficialStarters: true,
        removedUnpublishedFallbackPredictionIds: removablePredictionIds,
        officialGameIdsPublished: officialIds,
        hiddenUnverifiedGameIds: unverifiedRowsToHide.map((game) => game.id),
        lease: { jobName, runId, attempts: acquired.attempts, waitedMs: acquired.waitedMs },
      }, null, 2));
      return;
    }

    const model = await generatePredictionsForSlate("mlb", slateDate, "morning_draft", {
      writeToDb: true,
      gameExternalIdsFilter: officialExternalIds,
      verifiedOfficialTbdStarterExternalIds,
      respectLocks: true,
    });
    if (model.errors.length > 0 || model.predictions.length !== officialRows.length) {
      throw new Error(`prediction write incomplete: ${JSON.stringify(model.errors)}`);
    }

    const officialIds = officialRows.map((game) => game.id);
    const { error: publishError } = await supabase
      .from("games")
      .update({ slate_status: publishStatus })
      .in("id", officialIds);
    if (publishError) throw new Error(`official-row publish failed: ${publishError.message}`);
    await writeAudit({
      actionType: "slate.publish_verified_mlb_official_schedule",
      before: { sport: "mlb", date: slateDate, gameIds: officialIds },
      after: { sport: "mlb", date: slateDate, gameIds: officialIds, slate_status: publishStatus },
    });

    const records = await createPredictionRecords({
      sport: "mlb",
      slateDate,
      launchDay: false,
      apply: true,
      supabase,
    });
    if (records.errors.length > 0) {
      throw new Error(`prediction-record sync failed: ${JSON.stringify(records.errors)}`);
    }
    const memberSnapshot = await refreshDailyEdgeResponseSnapshot({
      sport: "mlb",
      date: slateDate,
      source: "mlb_official_tbd_slate_recovery",
    });
    if (!memberSnapshot.ok) {
      throw new Error(`member snapshot refresh failed: ${memberSnapshot.error ?? "unknown error"}`);
    }

    const { data: readback, error: readbackError } = await supabase
      .from("games")
      .select("id, external_id, slate_status, game_predictions(id, predicted_home_score, predicted_away_score)")
      .eq("sport", "mlb")
      .eq("slate_date", slateDate)
      .order("id", { ascending: true });
    if (readbackError) throw new Error(`readback failed: ${readbackError.message}`);
    console.log(JSON.stringify({
      repaired: true,
      modelPredictionsWritten: model.predictions.length,
      predictionRecordsWritten: records.insertedCount,
      memberSnapshot,
      readback,
      lease: { jobName, runId, attempts: acquired.attempts, waitedMs: acquired.waitedMs },
    }, null, 2));
  } finally {
    await releaseCronJobLease({ jobName, runId });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
