import { readFileSync } from "node:fs";
import {
  isWithinCronMinimumInterval,
  resolveCronLeaseJobName,
} from "../lib/cron/runCron";
import {
  buildMlbModelLayerVersions,
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_MODEL_LAYER_VERSION_SCHEMA,
  MLB_PUBLIC_CALIBRATION_VERSION,
} from "../lib/automodel/mlbModelLayerVersions";
import {
  didFinalSideChange,
  snapshotHasFinalSideCorrection,
  snapshotHasTrueMoneylineInversion,
} from "../lib/services/finalSideDecision";
import { withPredictionGradeHistory } from "../lib/services/predictionRecordService";
import { assertMlbChampionRuntime } from "../lib/automodel/mlbChampionRuntime";
import {
  assertWnbaChampionRuntime,
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../lib/automodel/wnbaChampionRuntime";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import { normalizeGameStatus } from "../lib/providers/real_api/BallDontLieSlateProvider";
import {
  preserveAuthoritativeGameStatus,
  resolveCanonicalGameDate,
  resolveOfficialMlbScheduleGame,
} from "../lib/services/slateService";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.log(`✗ ${label}`);
  }
}

check(
  "different MLB writers resolve to one shared lease",
  resolveCronLeaseJobName("slate_cycle_automation", "mlb", "prediction_pipeline") ===
    resolveCronLeaseJobName("pregame_sweep", "mlb", "prediction_pipeline"),
);
check(
  "shared lease remains isolated by sport",
  resolveCronLeaseJobName("tracking_refresh", "mlb", "prediction_pipeline") !==
    resolveCronLeaseJobName("tracking_refresh", "wnba", "prediction_pipeline"),
);
const now = Date.parse("2026-07-21T12:00:00Z");
check(
  "duplicate run inside cooldown is suppressed",
  isWithinCronMinimumInterval(new Date(now - 9 * 60_000), 10, now),
);
check(
  "scheduled run outside cooldown proceeds",
  !isWithinCronMinimumInterval(new Date(now - 10 * 60_000), 10, now),
);

const layers = buildMlbModelLayerVersions("total", {});
check("missing model env stamps resolved v2_2", layers.runtime_env.automodel_version === "v2_2");
check("missing FI env stamps resolved fi_v2", layers.runtime_env.first_inning_model_version === "fi_v2");
check(
  "grade policy carries August 11 v25 SharpAPI split-source alignment",
  layers.grade_policy === "mlb_public_grade_policy_v25_sharpapi_split_source_alignment_2026_08_11",
);
check(
  "tracking contract carries the priority-retry minute-lock release",
  layers.tracking_contract === "member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11",
);
check(
  "MLB layer stamp carries one immutable decision release",
  layers.decision_release_id === MLB_DAILY_EDGE_DECISION_RELEASE_ID &&
    layers.calibration_version === MLB_PUBLIC_CALIBRATION_VERSION,
);
check(
  "MLB SharpAPI split-source alignment is versioned as decision release r34",
  MLB_DAILY_EDGE_DECISION_RELEASE_ID === "mlb_daily_edge_decision_2026_08_11_r34" &&
    MLB_MODEL_LAYER_VERSION_SCHEMA === "mlb_model_layer_versions_v3" &&
    layers.schedule_time_policy === "mlb_official_schedule_time_v1_2026_07_30",
);
check("different final sides are a true correction", didFinalSideChange("home", "away"));
check("same final side is not a correction", !didFinalSideChange("home", "home"));
check(
  "legacy intermediate ML flip reversed downstream is not a final correction",
  !snapshotHasFinalSideCorrection({
    ml_flip: { flipped: true, original_side: "home", flipped_side: "home" },
  }, "moneyline"),
);
check(
  "legacy genuine ML flip remains a final correction",
  snapshotHasFinalSideCorrection({
    ml_flip: { flipped: true, original_side: "home", flipped_side: "away" },
  }, "moneyline"),
);
check(
  "market-aware ML correction is not mislabeled as inversion",
  !snapshotHasTrueMoneylineInversion({
    market_aware_side_correction: {
      applied: true,
      market: "moneyline",
      original_side: "home",
      corrected_side: "away",
    },
  }),
);
check(
  "legacy genuine ML inversion is recognized",
  snapshotHasTrueMoneylineInversion({
    ml_flip: { flipped: true, original_side: "home", flipped_side: "away" },
  }),
);
check("champion runtime accepts resolved defaults", (() => {
  try { assertMlbChampionRuntime({}); return true; } catch { return false; }
})());
check("champion runtime refuses an explicit old model", (() => {
  try { assertMlbChampionRuntime({ AUTOMODEL_VERSION: "v1" }); return false; } catch { return true; }
})());
check("WNBA model family is single-sourced", EXPECTED_WNBA_MODEL_VERSION === "wnba_v1_1_team_identity");
check(
  "WNBA distribution version is explicit",
  EXPECTED_WNBA_DISTRIBUTION_VERSION === "wnba_market_heads_value_calibrated_2026_08_02_v3",
);
check(
  "WNBA market-read grade policy is an immutable August 10 release",
  EXPECTED_WNBA_GRADE_POLICY_VERSION ===
    "wnba_grade_policy_v4_market_resistance_and_elo_stat_agreement_2026_08_10",
);
const wnbaModelSource = readFileSync("lib/services/wnba/buildWnbaDailyEdgePreview.ts", "utf8");
const wnbaModelWriterSource = readFileSync("lib/services/wnba/runWnbaModel.ts", "utf8");
const wnbaRecordWriterSource = readFileSync("lib/services/wnba/buildWnbaPredictionRecords.ts", "utf8");
const wnbaReaderSource = readFileSync("lib/services/wnba/buildWnbaDailyEdgeAdapted.ts", "utf8");
check(
  "WNBA preview fallback delegates to the canonical compute",
  wnbaModelSource.includes("return computeWnbaPrediction(M, g, r);") &&
    (wnbaModelSource.match(/let finalP =/g) ?? []).length === 1,
);
check(
  "WNBA canonical compute cannot drift with preview or dry-run environment flags",
  wnbaModelSource.includes("= EXPECTED_WNBA_CALIBRATION_FLAGS") &&
    !wnbaModelSource.includes("readWnbaCoreModelCalibrationFlagsFromEnv()"),
);
check(
  "WNBA moneyline identity is canonical across model writer, record writer, and reader",
  [wnbaModelWriterSource, wnbaRecordWriterSource, wnbaReaderSource]
    .every((source) => source.includes("resolveWnbaMoneylineSide")),
);
check(
  "WNBA reader only lets genuinely locked records override the current model payload",
  wnbaReaderSource.includes("if (r.locked_at === null) continue;"),
);
check(
  "WNBA tracking writer fails closed on stale source release identifiers",
  wnbaRecordWriterSource.includes("wnbaPredictionReleaseMismatches(ss)") &&
    wnbaRecordWriterSource.includes("prediction release mismatch"),
);
check(
  "WNBA member reader hides only stale unlocked source releases",
  wnbaReaderSource.includes("lockedAt === null && wnbaPredictionReleaseMismatches(ss).length > 0"),
);
const wnbaChampionEnv = {
  WNBA_CORE_MODEL_CALIBRATION_ENABLED: "true",
  WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED: "true",
  WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED: "true",
  WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED: "false",
  WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED: "true",
  WNBA_GRADE_CALIBRATION_ENABLED: "true",
};
check("WNBA champion runtime accepts the production calibration", (() => {
  try { assertWnbaChampionRuntime(wnbaChampionEnv); return true; } catch { return false; }
})());
check("WNBA champion runtime refuses calibration drift", (() => {
  try {
    assertWnbaChampionRuntime({
      ...wnbaChampionEnv,
      WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED: "true",
    });
    return false;
  } catch { return true; }
})());
check(
  "WNBA daily refresh joins the shared prediction lease",
  resolveCronLeaseJobName("wnba_daily_refresh", "wnba", "prediction_pipeline") ===
    resolveCronLeaseJobName("tracking_refresh", "wnba", "prediction_pipeline"),
);
const dailyEdgeHealthSource = readFileSync("app/api/cron/daily-edge-data-health/route.ts", "utf8");
check(
  "Daily Edge auto-repair joins the required shared prediction lease",
  dailyEdgeHealthSource.includes('leaseGroup: "prediction_pipeline"') &&
    dailyEdgeHealthSource.includes("requireLease: true"),
);
check("BDL maps postponed explicitly", normalizeGameStatus("Postponed") === "STATUS_POSTPONED");
check("BDL maps canceled explicitly", normalizeGameStatus("Cancelled") === "STATUS_CANCELED");
check(
  "slate refresh cannot regress postponed to scheduled",
  preserveAuthoritativeGameStatus("STATUS_POSTPONED", "STATUS_SCHEDULED") === "STATUS_POSTPONED",
);
check(
  "slate refresh cannot regress final to scheduled",
  preserveAuthoritativeGameStatus("STATUS_FINAL", "STATUS_SCHEDULED") === "STATUS_FINAL",
);
check(
  "slate refresh can advance scheduled to live",
  preserveAuthoritativeGameStatus("STATUS_SCHEDULED", "STATUS_IN_PROGRESS") === "STATUS_IN_PROGRESS",
);
const officialScheduleGames = [
  {
    gamePk: 824894,
    gameDate: "2026-07-30T23:15:00Z",
    gameNumber: 1,
    doubleHeader: "N" as const,
    status: "scheduled" as const,
    homeTeamId: 144,
    awayTeamId: 120,
    homeProbable: null,
    awayProbable: null,
  },
];
check(
  "official MLB schedule time overrides a lower-authority exact team match",
  resolveOfficialMlbScheduleGame({
    providerGameDate: "2026-07-30T23:00:00Z",
    homeMlbTeamId: 144,
    awayMlbTeamId: 120,
    officialScheduleGames,
  })?.gameDate === "2026-07-30T23:15:00Z",
);
check(
  "official schedule matching fails closed for a different matchup",
  resolveOfficialMlbScheduleGame({
    providerGameDate: "2026-07-30T23:00:00Z",
    homeMlbTeamId: 144,
    awayMlbTeamId: 121,
    officialScheduleGames,
  }) === null,
);
check(
  "malformed official schedule time cannot replace the provider time",
  resolveOfficialMlbScheduleGame({
    providerGameDate: "2026-07-30T23:00:00Z",
    homeMlbTeamId: 144,
    awayMlbTeamId: 120,
    officialScheduleGames: [{ ...officialScheduleGames[0]!, gameDate: "" }],
  }) === null,
);
check(
  "doubleheader reconciliation chooses the official game nearest the provider time",
  resolveOfficialMlbScheduleGame({
    providerGameDate: "2026-07-30T23:00:00Z",
    homeMlbTeamId: 144,
    awayMlbTeamId: 120,
    officialScheduleGames: [
      {
        ...officialScheduleGames[0]!,
        gamePk: 824893,
        gameDate: "2026-07-30T17:10:00Z",
        gameNumber: 1,
        doubleHeader: "Y",
      },
      {
        ...officialScheduleGames[0]!,
        gamePk: 824894,
        gameDate: "2026-07-30T23:15:00Z",
        gameNumber: 2,
        doubleHeader: "Y",
      },
    ],
  })?.gamePk === 824894,
);
check(
  "ambiguous doubleheader with invalid provider time fails closed",
  resolveOfficialMlbScheduleGame({
    providerGameDate: "invalid",
    homeMlbTeamId: 144,
    awayMlbTeamId: 120,
    officialScheduleGames: [
      officialScheduleGames[0]!,
      { ...officialScheduleGames[0]!, gamePk: 824895, gameDate: "2026-07-31T02:00:00Z" },
    ],
  }) === null,
);
check(
  "lower-authority MLB refresh cannot overwrite an existing verified game time",
  resolveCanonicalGameDate({
    providerGameDate: "2026-07-30T23:00:00Z",
    officialGameDate: null,
    existingGameDate: "2026-07-30T23:15:00Z",
    preserveExistingWithoutOfficialMatch: true,
  }) === "2026-07-30T23:15:00Z",
);
check(
  "official MLB time can advance an existing lower-authority game time",
  resolveCanonicalGameDate({
    providerGameDate: "2026-07-30T23:00:00Z",
    officialGameDate: "2026-07-30T23:15:00Z",
    existingGameDate: "2026-07-30T23:00:00Z",
    preserveExistingWithoutOfficialMatch: true,
  }) === "2026-07-30T23:15:00Z",
);

const base: PredictionRecordRow = {
  game_prediction_id: 1,
  game_id: 1,
  external_id: 1,
  sport: "mlb",
  slate_date: "2026-07-21",
  game_date: "2026-07-21T23:00:00Z",
  matchup: "AWY@HME",
  market: "total",
  pick: "over",
  side: "over",
  line_value: 8.5,
  odds_american: -110,
  odds_decimal: null,
  model_used: "v2_2",
  model_version: "auto_v2.2_mlb_full_game_projection",
  calibration_version: MLB_PUBLIC_CALIBRATION_VERSION,
  prediction_source: "auto_model",
  confidence: 58,
  model_probability: 0.58,
  market_probability: 0.52,
  edge: 6,
  expected_value: null,
  play_grade: "best_angle",
  prediction_type: "best_angle",
  best_angle: true,
  no_bet: false,
  no_bet_reason: null,
  market_aligned: false,
  data_quality_tier: "high",
  source_quality: null,
  provisional: false,
  held: false,
  hold_reason: null,
  launch_day: false,
  manual_outcome_expected: false,
  locked_at: null,
  published_at: null,
  snapshot_json: {},
};
const changed = withPredictionGradeHistory(
  { ...base, play_grade: "lean", best_angle: false },
  base,
  "2026-07-21T12:00:00Z",
);
const history = changed.snapshot_json?.prediction_grade_history_v1;
check("grade change preserves previous public decision", Array.isArray(history) && history.length === 1);
check(
  "grade history records the previous Best Angle",
  Array.isArray(history) && history[0]?.play_grade === "best_angle" && history[0]?.best_angle === true,
);

const sweepSource = readFileSync("app/api/cron/pregame-sweep/route.ts", "utf8");
check(
  "T-60 lock defers games with failed model refresh",
  sweepSource.includes("locks_deferred_after_model_failure") &&
    sweepSource.includes("failedEnteringLockExternalIds"),
);
check(
  "pregame duplicate cooldown preserves the minute lock cadence",
  sweepSource.includes("minIntervalMinutes: !dryRun && gateActive ? 0.75 : undefined") &&
    sweepSource.includes("leaseRetryMaxWaitMs: !dryRun && gateActive ? 20_000 : undefined"),
);
check(
  "lock-only sweep avoids full market intelligence collection",
  sweepSource.includes("if (!lockOnly)") &&
    sweepSource.indexOf("if (lockOnly)") < sweepSource.indexOf('sport === "mlb" && marketIntelligenceV2 === null'),
);
check(
  "unlocked pregame refresh republishes coherent member records and snapshot",
  sweepSource.includes("member_record_sync") &&
    sweepSource.includes('source: "pregame_sweep_refresh"') &&
    sweepSource.includes("createPredictionRecords({"),
);
const lineupWatchSource = readFileSync("app/api/cron/lineup-watch/route.ts", "utf8");
check(
  "lineup watch synchronizes member records after its automodel write",
  lineupWatchSource.includes("createPredictionRecords({") &&
    lineupWatchSource.indexOf("createPredictionRecords({") >
      lineupWatchSource.indexOf("generatePredictionsForSlate("),
);
check(
  "lineup watch republishes the Daily Edge response snapshot after record sync",
  lineupWatchSource.includes('source: "lineup_watch"') &&
    lineupWatchSource.includes("response_snapshot: responseSnapshot"),
);
const dailyEdgeSource = readFileSync("app/api/lab/daily-edge/route.ts", "utf8");
check(
  "Daily Edge uses a stored prediction record as writer authority before lock",
  dailyEdgeSource.includes("const hasStoredPredictionRecord") &&
    dailyEdgeSource.includes("input.hasPredictionRecord === true"),
);
check(
  "Daily Edge keeps the stored pick and probability tuple together before lock",
  dailyEdgeSource.includes("storedModelProbability: lockedMl?.modelProbability") &&
    dailyEdgeSource.includes("storedMarketProbability: lockedOu?.marketProbability") &&
    dailyEdgeSource.includes("if (hasStoredPredictionRecord)"),
);

const vercelSource = readFileSync("vercel.json", "utf8");
check(
  "AI shadow completes well before the first full props build",
  vercelSource.includes('"45 8 * * *"') &&
    vercelSource.includes('"27 9,13,17,21 * * *"') &&
    !vercelSource.includes('"22 9 * * *"'),
);
check(
  "full props rebuilds stay bounded to four staggered runs per day",
  vercelSource.includes('"27 9,13,17,21 * * *"') &&
    !vercelSource.includes('"27 * * * *"'),
);
check(
  "WNBA refreshes are offset from five-minute MLB lock sweeps",
  vercelSource.includes('"23,53 13-23 * * *"') &&
    vercelSource.includes('"23,53 0-3 * * *"') &&
    !vercelSource.includes('"20,50 13-23 * * *"') &&
    !vercelSource.includes('"20,50 0-3 * * *"'),
);
check(
  "props settlement is offset from WNBA and fast props writers",
  vercelSource.includes('"27,57 0-8 * * *"') &&
    vercelSource.includes('"27 12 * * *"') &&
    !vercelSource.includes('"20,50 0-8 * * *"') &&
    !vercelSource.includes('"20 12 * * *"'),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
