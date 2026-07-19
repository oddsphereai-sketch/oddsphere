import { classifyLockState, type LockState } from "@/lib/automodel/lockState";
import { supabase } from "@/lib/db/supabase";
import { runBdlPlayerBackfillCycle } from "@/lib/services/bdlPlayerBackfillService";
import { generatePredictionsForSlate } from "@/lib/services/automodelService";
import { linesService } from "@/lib/services/linesService";
import { lineupService } from "@/lib/services/lineupService";
import { repairMlbModelReadiness } from "@/lib/services/modelReadinessService";
import { weatherService } from "@/lib/services/weatherService";
import { runStarterRefreshCycle } from "../../../scripts/operator/refresh-starters";
import type {
  DailyEdgeDataHealthFinding,
  DailyEdgeDataHealthReport,
} from "@/lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import type { Sport } from "@/lib/types/domain/Sport";

export type DailyEdgeDataHealthRepairAttempt = {
  code: string;
  sport: Sport;
  date: string;
  game: string;
  market: string;
  pick: string | null;
  externalId: number | null;
  lockState: LockState | "unknown";
  status:
    | "eligible"
    | "repaired"
    | "still_monitoring"
    | "still_unhealthy"
    | "skipped_locked"
    | "skipped_entering_lock"
    | "skipped_started"
    | "skipped_no_external_id"
    | "skipped_unsupported";
  message: string;
};

export type DailyEdgeDataHealthRepairReport = {
  mode: "daily_edge_data_health_repair";
  apply: boolean;
  noOpenAiCalls: true;
  noTrackingChanges: true;
  sport: Sport;
  date: string;
  attemptedFindings: number;
  eligibleGames: number;
  repairedGames: number;
  stillUnhealthyGames: number;
  skipped: Record<string, number>;
  recordsUpdated: number;
  apiCallsMade: number;
  steps: {
    bdlPlayers?: Record<string, unknown>;
    weather?: Record<string, unknown>;
    lineups?: Record<string, unknown>;
    lines?: Record<string, unknown>;
    modelReadiness?: Record<string, unknown>;
    starterRefresh?: Record<string, unknown>;
    sharpSignals?: Record<string, unknown>;
    automodel?: Record<string, unknown>;
  };
  errors: string[];
  attempts: DailyEdgeDataHealthRepairAttempt[];
  postRepairHealth?: Pick<
    DailyEdgeDataHealthReport,
    "safeForNormalReaderDisplay" | "bySeverity" | "byCode" | "unresolvedBlockingOrHigh"
  >;
};

type GameRow = {
  id: number;
  external_id: number;
  game_date: string | null;
  game_predictions: Array<{ locked_at: string | null }> | null;
};

function numberFromDetails(finding: DailyEdgeDataHealthFinding, key: string): number | null {
  const value = finding.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function repairableFindings(report: DailyEdgeDataHealthReport): DailyEdgeDataHealthFinding[] {
  if (report.sport !== "mlb") return [];
  return report.findings.filter((finding) =>
    finding.code === "fi_held_no_actionable_side" ||
    finding.code === "fi_publishable_degraded_stats" ||
    finding.code === "fi_provisional_lineup_pending" ||
    finding.code === "fi_starter_ingestion_miss" ||
    finding.code === "fi_model_hold_missing_inputs" ||
    finding.code === "fi_model_hold_provider_gap" ||
    finding.code === "fi_model_hold_diagnostic_missing" ||
    (finding.code === "evidence_blocked" && finding.market === "first_inning")
  );
}

async function loadGamesByExternalId(
  sport: Sport,
  date: string,
  externalIds: number[],
): Promise<Map<number, GameRow>> {
  if (externalIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, game_date, game_predictions ( locked_at )")
    .eq("sport", sport)
    .eq("slate_date", date)
    .in("external_id", externalIds);
  if (error) {
    throw new Error(`daily-edge repair loadGames failed: ${error.message}`);
  }
  const out = new Map<number, GameRow>();
  for (const row of (data ?? []) as GameRow[]) {
    out.set(row.external_id, row);
  }
  return out;
}

export async function runDailyEdgeDataHealthRepair(args: {
  report: DailyEdgeDataHealthReport;
  apply?: boolean;
  postRepairMonitor?: () => Promise<DailyEdgeDataHealthReport>;
}): Promise<DailyEdgeDataHealthRepairReport> {
  const apply = args.apply === true;
  const candidates = repairableFindings(args.report);
  const skipped: Record<string, number> = {};
  const attempts: DailyEdgeDataHealthRepairAttempt[] = [];
  const steps: DailyEdgeDataHealthRepairReport["steps"] = {};
  const errors: string[] = [];
  let recordsUpdated = 0;
  let apiCallsMade = 0;

  if (args.report.sport !== "mlb") {
    for (const finding of args.report.findings) {
      attempts.push({
        code: finding.code,
        sport: finding.sport,
        date: finding.date,
        game: finding.game,
        market: finding.market,
        pick: finding.pick,
        externalId: numberFromDetails(finding, "externalId"),
        lockState: "unknown",
        status: "skipped_unsupported",
        message: "Automated repair currently supports MLB FI data gaps only.",
      });
    }
    return {
      mode: "daily_edge_data_health_repair",
      apply,
      noOpenAiCalls: true,
      noTrackingChanges: true,
      sport: args.report.sport,
      date: args.report.date,
      attemptedFindings: candidates.length,
      eligibleGames: 0,
      repairedGames: 0,
      stillUnhealthyGames: 0,
      skipped: { skipped_unsupported: attempts.length },
      recordsUpdated,
      apiCallsMade,
      steps,
      errors,
      attempts,
    };
  }

  const externalIds = Array.from(
    new Set(candidates.map((finding) => numberFromDetails(finding, "externalId")).filter((id): id is number => id !== null)),
  );
  const gamesByExternalId = await loadGamesByExternalId(args.report.sport, args.report.date, externalIds);
  const now = new Date();
  const eligibleExternalIds: number[] = [];

  for (const finding of candidates) {
    const externalId = numberFromDetails(finding, "externalId");
    if (externalId === null) {
      inc(skipped, "skipped_no_external_id");
      attempts.push({
        code: finding.code,
        sport: finding.sport,
        date: finding.date,
        game: finding.game,
        market: finding.market,
        pick: finding.pick,
        externalId,
        lockState: "unknown",
        status: "skipped_no_external_id",
        message: "Finding did not include a game external_id, so repair cannot target it safely.",
      });
      continue;
    }
    const game = gamesByExternalId.get(externalId);
    const lockState = game
      ? classifyLockState({
          locked_at: game.game_predictions?.[0]?.locked_at ?? null,
          game_date: game.game_date,
        }, now)
      : "unknown";
    if (lockState === "locked") {
      inc(skipped, "skipped_locked");
      attempts.push({
        code: finding.code,
        sport: finding.sport,
        date: finding.date,
        game: finding.game,
        market: finding.market,
        pick: finding.pick,
        externalId,
        lockState,
        status: "skipped_locked",
        message: "Game is already locked; repair will not mutate frozen cards.",
      });
      continue;
    }
    if (lockState === "entering_lock") {
      inc(skipped, "skipped_entering_lock");
      attempts.push({
        code: finding.code,
        sport: finding.sport,
        date: finding.date,
        game: finding.game,
        market: finding.market,
        pick: finding.pick,
        externalId,
        lockState,
        status: "skipped_entering_lock",
        message: "Game is inside the lock window; pregame-sweep owns the final lock refresh.",
      });
      continue;
    }
    if (lockState === "already_started") {
      inc(skipped, "skipped_started");
      attempts.push({
        code: finding.code,
        sport: finding.sport,
        date: finding.date,
        game: finding.game,
        market: finding.market,
        pick: finding.pick,
        externalId,
        lockState,
        status: "skipped_started",
        message: "Game already started without a usable unlocked repair window.",
      });
      continue;
    }
    eligibleExternalIds.push(externalId);
    attempts.push({
      code: finding.code,
      sport: finding.sport,
      date: finding.date,
      game: finding.game,
      market: finding.market,
      pick: finding.pick,
      externalId,
      lockState,
      status: "eligible",
      message: apply
        ? "Eligible for data refresh and unlocked automodel repair."
        : "Dry-run only; would refresh data and rerun unlocked automodel for this game.",
    });
  }

  const uniqueEligibleExternalIds = Array.from(new Set(eligibleExternalIds));
  if (uniqueEligibleExternalIds.length === 0) {
    return {
      mode: "daily_edge_data_health_repair",
      apply,
      noOpenAiCalls: true,
      noTrackingChanges: true,
      sport: args.report.sport,
      date: args.report.date,
      attemptedFindings: candidates.length,
      eligibleGames: 0,
      repairedGames: 0,
      stillUnhealthyGames: 0,
      skipped,
      recordsUpdated,
      apiCallsMade,
      steps,
      errors,
      attempts,
    };
  }

  if (!apply) {
    return {
      mode: "daily_edge_data_health_repair",
      apply,
      noOpenAiCalls: true,
      noTrackingChanges: true,
      sport: args.report.sport,
      date: args.report.date,
      attemptedFindings: candidates.length,
      eligibleGames: uniqueEligibleExternalIds.length,
      repairedGames: 0,
      stillUnhealthyGames: 0,
      skipped,
      recordsUpdated,
      apiCallsMade,
      steps: {
        ...steps,
        automodel: {
          dryRun: true,
          wouldTargetExternalIds: uniqueEligibleExternalIds,
          writeGateRequired: "AUTOMODEL_DB_WRITES_ENABLED=true",
        },
      },
      errors,
      attempts,
    };
  }

  try {
    const playerStatsProviderReal = process.env.PLAYER_STATS_PROVIDER === "real_api";
    const weatherProviderReal = process.env.WEATHER_PROVIDER === "real_api";
    const bdlWritesEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
    const readinessWriteMode = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
    const readiness = await repairMlbModelReadiness({
      sport: args.report.sport,
      date: args.report.date,
      writeMode: readinessWriteMode,
      providerGuards: {
        playerStatsProviderReal,
        weatherProviderReal,
        bdlWritesEnabled,
      },
    });
    steps.modelReadiness = {
      writeMode: readiness.write_mode,
      reasons: readiness.reasons,
      bdlPlayers: readiness.steps.bdl_players,
      seasonBatting: readiness.steps.season_batting,
      seasonPitching: readiness.steps.season_pitching,
      lineup: readiness.steps.lineup,
      weather: readiness.steps.weather,
    };
    recordsUpdated +=
      (readiness.steps.season_batting.rows_written ?? 0) +
      (readiness.steps.season_pitching.rows_written ?? 0) +
      (readiness.steps.lineup.records_updated ?? 0) +
      (readiness.steps.weather.records_updated ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.modelReadiness = { failed: true, error: message };
    errors.push(`model_readiness: ${message}`);
  }

  if (candidates.some((finding) => finding.code === "fi_starter_ingestion_miss")) {
    try {
      const writeMode = process.env.STARTER_DB_WRITES_ENABLED === "true";
      const starterRefresh = await runStarterRefreshCycle({
        sport: args.report.sport,
        date: args.report.date,
        writeMode,
        limit: Math.max(1, gamesByExternalId.size),
        log: () => undefined,
      });
      steps.starterRefresh = {
        writeMode,
        status: starterRefresh.status,
        gamesInSlate: starterRefresh.games_in_slate,
        gamesUpdated: starterRefresh.games_updated,
        sidesWritten: starterRefresh.sides_written,
        unresolved: starterRefresh.unresolved,
        errors: starterRefresh.errors,
      };
      recordsUpdated += starterRefresh.sides_written;
      if (starterRefresh.status === "failed") {
        errors.push(`starter_refresh: ${starterRefresh.message ?? "failed"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.starterRefresh = { failed: true, error: message };
      errors.push(`starter_refresh: ${message}`);
    }
  }

  if (process.env.PLAYER_STATS_PROVIDER === "real_api") {
    try {
      const bdlWriteMode = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
      const bdl = await runBdlPlayerBackfillCycle({
        sport: args.report.sport,
        date: args.report.date,
        writeMode: bdlWriteMode,
      });
      steps.bdlPlayers = {
        status: bdl.status,
        writeMode: bdlWriteMode,
        apiCalls: bdl.api_calls,
        linked: bdl.linked,
        created: bdl.created,
        failed: bdl.failed,
      };
      apiCallsMade += bdl.api_calls;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.bdlPlayers = { failed: true, error: message };
      errors.push(`bdl_players: ${message}`);
    }

    try {
      const lineup = await lineupService.refreshLineups(args.report.sport, args.report.date);
      steps.lineups = {
        recordsUpdated: lineup.records_updated ?? 0,
        apiCalls: lineup.api_calls_made ?? 0,
        details: lineup.details ?? null,
      };
      recordsUpdated += lineup.records_updated ?? 0;
      apiCallsMade += lineup.api_calls_made ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.lineups = { failed: true, error: message };
      errors.push(`lineups: ${message}`);
    }
  } else {
    steps.bdlPlayers = { skipped: true, reason: "PLAYER_STATS_PROVIDER!=real_api" };
    steps.lineups = { skipped: true, reason: "PLAYER_STATS_PROVIDER!=real_api" };
  }

  if (process.env.WEATHER_PROVIDER === "real_api") {
    try {
      const weather = await weatherService.refreshForecasts(args.report.sport, args.report.date);
      steps.weather = {
        recordsUpdated: weather.records_updated ?? 0,
        apiCalls: weather.api_calls_made ?? 0,
      };
      recordsUpdated += weather.records_updated ?? 0;
      apiCallsMade += weather.api_calls_made ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.weather = { failed: true, error: message };
      errors.push(`weather: ${message}`);
    }
  } else {
    steps.weather = { skipped: true, reason: "WEATHER_PROVIDER!=real_api" };
  }

  try {
    const lines = await linesService.refreshGameLinesV2(args.report.sport, args.report.date);
    steps.lines = {
      recordsUpdated: lines.records_updated ?? 0,
      apiCalls: lines.api_calls_made ?? 0,
    };
    recordsUpdated += lines.records_updated ?? 0;
    apiCallsMade += lines.api_calls_made ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.lines = { failed: true, error: message };
    errors.push(`lines: ${message}`);
  }

  try {
    const sharpSignals = await linesService.refreshSharpSignals(args.report.sport, args.report.date);
    steps.sharpSignals = {
      recordsUpdated: sharpSignals.records_updated ?? 0,
      apiCalls: sharpSignals.api_calls_made ?? 0,
    };
    recordsUpdated += sharpSignals.records_updated ?? 0;
    apiCallsMade += sharpSignals.api_calls_made ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.sharpSignals = { failed: true, error: message };
    errors.push(`sharp_signals: ${message}`);
  }

  if (process.env.AUTOMODEL_DB_WRITES_ENABLED !== "true") {
    steps.automodel = {
      skipped: true,
      reason: "AUTOMODEL_DB_WRITES_ENABLED!=true; refreshed source data but did not rewrite predictions.",
      targetedExternalIds: uniqueEligibleExternalIds,
    };
  } else {
    try {
      const previousFiModelVersion = process.env.FIRST_INNING_MODEL_VERSION;
      if (args.report.sport === "mlb" && (previousFiModelVersion === undefined || previousFiModelVersion.trim() === "")) {
        process.env.FIRST_INNING_MODEL_VERSION = "fi_v2";
      }
      let model: Awaited<ReturnType<typeof generatePredictionsForSlate>>;
      try {
        model = await generatePredictionsForSlate(args.report.sport, args.report.date, "morning_draft", {
          writeToDb: true,
          gameExternalIdsFilter: uniqueEligibleExternalIds,
          respectLocks: true,
          modelVersion: args.report.sport === "mlb" ? "v2_2" : undefined,
        });
      } finally {
        if (previousFiModelVersion === undefined) {
          delete process.env.FIRST_INNING_MODEL_VERSION;
        } else {
          process.env.FIRST_INNING_MODEL_VERSION = previousFiModelVersion;
        }
      }
      const ingest = model.db_writes?.ingest;
      const modelWrites = (ingest?.inserted ?? 0) + (ingest?.updated ?? 0);
      recordsUpdated += modelWrites;
      let legacyDuplicatesRemoved = 0;
      if (args.report.sport === "mlb") {
        const targetedGameIds = uniqueEligibleExternalIds
          .map((externalId) => gamesByExternalId.get(externalId)?.id)
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
        if (targetedGameIds.length > 0) {
          const { data: duplicateRows, error: duplicateLoadErr } = await supabase
            .from("prediction_records")
            .select("id, game_id, market, model_version, locked_at")
            .in("game_id", targetedGameIds)
            .eq("sport", "mlb")
            .eq("slate_date", args.report.date)
            .in("market", ["moneyline", "total"]);
          if (duplicateLoadErr) {
            errors.push(`automodel_legacy_duplicate_cleanup_load: ${duplicateLoadErr.message}`);
          } else {
            const rows = (duplicateRows ?? []) as Array<{
              id: number;
              game_id: number;
              market: string;
              model_version: string | null;
              locked_at: string | null;
            }>;
            const hasV22 = new Set(
              rows
                .filter((row) => row.model_version === "auto_v2.2_mlb_full_game_projection")
                .map((row) => `${row.game_id}::${row.market}`),
            );
            const legacyIds = rows
              .filter((row) =>
                row.locked_at === null &&
                row.model_version === "auto_v1.0_mlb_rules" &&
                hasV22.has(`${row.game_id}::${row.market}`),
              )
              .map((row) => row.id);
            if (legacyIds.length > 0) {
              const { data: deletedRows, error: duplicateDeleteErr } = await supabase
                .from("prediction_records")
                .delete()
                .in("id", legacyIds)
                .eq("sport", "mlb")
                .eq("slate_date", args.report.date)
                .eq("model_version", "auto_v1.0_mlb_rules")
                .is("locked_at", null)
                .select("id");
              if (duplicateDeleteErr) {
                errors.push(`automodel_legacy_duplicate_cleanup_delete: ${duplicateDeleteErr.message}`);
              } else {
                legacyDuplicatesRemoved = deletedRows?.length ?? 0;
              }
            }
          }
        }
      }
      steps.automodel = {
        targetedExternalIds: uniqueEligibleExternalIds,
        modelVersion: args.report.sport === "mlb" ? "v2_2" : null,
        fiWriterMode: args.report.sport === "mlb" ? (previousFiModelVersion?.trim() ? previousFiModelVersion : "fi_v2") : null,
        predictionsBuilt: model.predictions.length,
        heldCount: model.held_count,
        pickNullCounts: model.pick_null_counts,
        recordsUpdated: modelWrites,
        errors: model.errors,
        legacyDuplicatesRemoved,
        marketSignals: model.db_writes?.market_signals ?? null,
        grades: model.db_writes?.grades ?? null,
      };
      for (const modelError of model.errors) {
        errors.push(`automodel ext=${modelError.game_external_id}: ${modelError.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.automodel = {
        failed: true,
        error: message,
        targetedExternalIds: uniqueEligibleExternalIds,
      };
      errors.push(`automodel: ${message}`);
    }
  }

  let postRepairHealth: DailyEdgeDataHealthRepairReport["postRepairHealth"];
  const stillUnhealthyExternalIds = new Set<number>();
  const repairedExternalIds = new Set<number>();
  if (args.postRepairMonitor) {
    const post = await args.postRepairMonitor();
    postRepairHealth = {
      safeForNormalReaderDisplay: post.safeForNormalReaderDisplay,
      bySeverity: post.bySeverity,
      byCode: post.byCode,
      unresolvedBlockingOrHigh: post.unresolvedBlockingOrHigh,
    };
    const postRepairableFindings = repairableFindings(post);
    const postBadExternalIds = new Set(
      postRepairableFindings
        .filter((finding) => finding.severity === "blocking" || finding.severity === "high")
        .map((finding) => numberFromDetails(finding, "externalId"))
        .filter((id): id is number => id !== null),
    );
    const postMonitoredExternalIds = new Set(
      postRepairableFindings
        .filter((finding) => finding.severity !== "blocking" && finding.severity !== "high")
        .map((finding) => numberFromDetails(finding, "externalId"))
        .filter((id): id is number => id !== null),
    );
    for (const attempt of attempts) {
      if (attempt.status !== "eligible" || attempt.externalId === null) continue;
      if (postBadExternalIds.has(attempt.externalId)) {
        attempt.status = "still_unhealthy";
        attempt.message = "Repair ran, but the post-repair monitor still sees this gap.";
        stillUnhealthyExternalIds.add(attempt.externalId);
      } else if (postMonitoredExternalIds.has(attempt.externalId)) {
        attempt.status = "still_monitoring";
        attempt.message = "Repair ran; no blocking/high gap remains, but the monitor still tracks a publishable medium follow-up.";
        repairedExternalIds.add(attempt.externalId);
      } else {
        attempt.status = "repaired";
        attempt.message = "Post-repair monitor no longer reports this repairable gap.";
        repairedExternalIds.add(attempt.externalId);
      }
    }
  }

  return {
    mode: "daily_edge_data_health_repair",
    apply,
    noOpenAiCalls: true,
    noTrackingChanges: true,
    sport: args.report.sport,
    date: args.report.date,
    attemptedFindings: candidates.length,
    eligibleGames: uniqueEligibleExternalIds.length,
    repairedGames: repairedExternalIds.size,
    stillUnhealthyGames: stillUnhealthyExternalIds.size,
    skipped,
    recordsUpdated,
    apiCallsMade,
    steps,
    errors,
    attempts,
    postRepairHealth,
  };
}
