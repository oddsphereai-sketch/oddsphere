/**
 * Phase 4.2.C.1.R-17 Step 2 — Automation orchestrator (controlled apply).
 *
 * USAGE:
 *   Dry-run (default — never writes regardless of env vars):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/automation/run-slate-cycle.ts \
 *       --sport mlb --date 2026-06-04 [--verbose]
 *
 *   Apply (four-key gate + interactive y/N):
 *     AUTOMATION_ORCHESTRATOR_ENABLED=true \
 *       SLATE_DB_WRITES_ENABLED=true \
 *       STARTER_DB_WRITES_ENABLED=true \
 *       PLAYER_INGEST_DB_WRITES_ENABLED=true \
 *       SEASON_PITCHING_DB_WRITES_ENABLED=true \
 *       LINES_DB_WRITES_ENABLED=true \
 *       SHARP_SIGNALS_DB_WRITES_ENABLED=true \
 *       AUTOMODEL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/automation/run-slate-cycle.ts \
 *       --sport mlb --date 2026-06-04 --apply
 *
 * WRITE GATING — three orchestrator keys plus one operator-style key per step:
 *   1. `AUTOMATION_ORCHESTRATOR_ENABLED=true` env (top-level)
 *   2. `--apply` CLI flag
 *   3. Interactive y/N confirmation before any write phase
 *   4. Per-step env var must also be present for that step to write
 *      (a missing per-step var keeps that step in dry-run; other steps
 *      can still write)
 *
 * BEHAVIOR:
 *   • If provider date alignment is fail_closed → abort BEFORE any
 *     write step runs (all write-capable steps are marked "blocked").
 *   • If the top-level gate is missing → dry-run for ALL steps even if
 *     per-step gates are present.
 *   • If a per-step env var is missing → that step stays dry-run; the
 *     report makes the reason explicit.
 *   • If the automation gate is fail_closed → automodel/reviewer is
 *     skipped (the model would have nothing to do).
 *   • Starter coverage holds are per-game/market — they don't abort.
 *   • Lines / sharp_signals partial coverage is preserved (V2 per-(game,
 *     market) DELETE-INSERT pattern); downstream is gated.
 *
 * NOT INVOKED (deferred — marked `not_invoked_step2_v1` in the report):
 *   • S2 teams refresh — deferred to Step 2B
 *   • S6 bullpen / team-stats refresh — deferred to Step 2B
 *
 * INVOKED IN STEP 2A.5 (new since Step 2 first commit):
 *   • S5 season-pitching stats — runSeasonPitchingCycle, slate-starter
 *     scope only (helper resolves player IDs from games table). Bounded
 *     to the slate's probable starters; never a broad unbounded refresh.
 *     Per-pitcher failures isolated (counted, not crash-fatal); if stats
 *     remain missing, the post-refresh gate (G1) holds affected markets.
 *
 * NEVER:
 *   • auto-publish
 *   • activate cron
 *   • schema/DDL changes
 *   • destructive cleanup
 *   • hide/unlock/publish
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parseCommonCliOptions, readBoolFlag } from "../_cliCommon";
import { supabase } from "../../../lib/db/supabase";
import { SharpApiClient } from "../../../lib/providers/real_api/_sharpApiClient";
import { loadGameIdMap } from "../../../lib/services/_idMaps";
import {
  assessProviderDateAlignment,
  type ProviderDateAlignmentReport,
} from "../../../lib/services/providerDateAlignment";
import {
  assessAutomationGate,
  type AutomationGateReport,
} from "../../../lib/services/automationGate";
import { slateService } from "../../../lib/services/slateService";
import { linesService } from "../../../lib/services/linesService";
import { generatePredictionsForSlate } from "../../../lib/services/automodelService";
import { runStarterRefreshCycle } from "../refresh-starters";
import { runMissingPitcherCycle } from "../ingest-missing-pitchers";
import { runSeasonPitchingCycle } from "../backfill-season-pitching-stats";
import type { Sport } from "../../../lib/types/domain/Sport";

// ─── Step status ─────────────────────────────────────────────────────

/**
 * Per-step outcome. `dry_run` and `wrote` indicate the step ran; the
 * remaining variants document why it didn't.
 *
 *   • `dry_run`              — step ran in dry-run mode (no DB write)
 *   • `wrote`                — step ran in write mode and completed
 *   • `skipped`              — step had no work (e.g. slate empty)
 *   • `blocked`              — upstream gate (provider rollover or
 *                              automation gate fail_closed) prevented
 *                              this step
 *   • `failed`               — step ran and returned a failure result
 *   • `not_invoked_step2_v1` — out of scope for this commit; will be
 *                              wired in a follow-up
 */
type StepMode =
  | "dry_run"
  | "wrote"
  | "skipped"
  | "blocked"
  | "failed"
  | "not_invoked_step2_v1";

type StepResult = {
  order: number;
  name: string;
  operator_path: string;
  mode: StepMode;
  reason: string;
  details?: Record<string, unknown>;
};

// ─── Gating ──────────────────────────────────────────────────────────

const ORCHESTRATOR_ENV_FLAG = "AUTOMATION_ORCHESTRATOR_ENABLED";
const PER_STEP_ENV_VARS = {
  slate: "SLATE_DB_WRITES_ENABLED",
  starter: "STARTER_DB_WRITES_ENABLED",
  pitcher: "PLAYER_INGEST_DB_WRITES_ENABLED",
  season: "SEASON_PITCHING_DB_WRITES_ENABLED",
  lines: "LINES_DB_WRITES_ENABLED",
  signals: "SHARP_SIGNALS_DB_WRITES_ENABLED",
  automodel: "AUTOMODEL_DB_WRITES_ENABLED",
} as const;

type PerStepKey = keyof typeof PER_STEP_ENV_VARS;

function readPerStepGates(): Record<PerStepKey, boolean> {
  const out = {} as Record<PerStepKey, boolean>;
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    out[k] = process.env[PER_STEP_ENV_VARS[k]] === "true";
  }
  return out;
}

async function confirmApply(planSummary: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log();
    console.log("━━━ WRITE CONFIRMATION ━━━");
    console.log(planSummary);
    console.log();
    const ans = await rl.question(
      `Proceed with write phase across the steps shown above? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── Step runners ────────────────────────────────────────────────────
//
// Each `runX` function takes a `writeMode` flag the orchestrator already
// resolved (combining top-level gate + --apply + per-step env). When
// false, the underlying service is called with dryRun=true. Returns a
// StepResult so the orchestrator can aggregate verbose status.

async function runSlateIngest(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  const dryRun = !writeMode;
  try {
    const res = await slateService.refreshGames(sport, date, undefined, {
      dryRun,
    });
    return {
      order,
      name: "S1. Slate ingest (games rows)",
      operator_path: "lib/services/slateService.refreshGames",
      mode: writeMode ? "wrote" : "dry_run",
      reason: writeMode
        ? `wrote ${res.records_updated} game row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} game row(s)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.slate} missing — would be dry-run anyway)`),
      details: { records_updated: res.records_updated, api_calls: res.api_calls_made },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "S1. Slate ingest (games rows)",
      operator_path: "lib/services/slateService.refreshGames",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runStarterPass(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  slateSize: number,
  label: "first" | "final",
  order: number
): Promise<StepResult> {
  const stepName =
    label === "first"
      ? "S3. Starter refresh (first pass)"
      : "M1. Starter refresh (final pass before model)";
  try {
    const res = await runStarterRefreshCycle({
      sport,
      date,
      writeMode,
      limit: writeMode ? Math.max(1, slateSize) : undefined,
      log: () => {
        /* swallow per-step verbose chatter; orchestrator owns the report */
      },
    });
    let mode: StepMode;
    let reason: string;
    switch (res.status) {
      case "wrote":
        mode = "wrote";
        reason = `wrote ${res.sides_written} side(s) across ${res.games_updated} game(s)`;
        break;
      case "dry_run":
        mode = "dry_run";
        reason =
          `dry-run; planned ${res.planned_writes} game write(s)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.starter} missing — would be dry-run anyway)`);
        break;
      case "no_changes":
        mode = writeMode ? "wrote" : "dry_run";
        reason = "no starter changes proposed";
        break;
      case "cancelled":
        mode = "skipped";
        reason = "cancelled (confirm returned false)";
        break;
      case "empty_slate":
        mode = "skipped";
        reason = "empty slate";
        break;
      case "failed":
        mode = "failed";
        reason = `failed: ${res.message ?? "unknown"}`;
        break;
    }
    return {
      order,
      name: stepName,
      operator_path: "scripts/operator/refresh-starters.runStarterRefreshCycle",
      mode,
      reason,
      details: {
        games_in_slate: res.games_in_slate,
        planned_writes: res.planned_writes,
        games_updated: res.games_updated,
        sides_written: res.sides_written,
        unresolved: res.unresolved,
        unmatched_mlb_games: res.unmatched_mlb_games,
        errors: res.errors,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: stepName,
      operator_path: "scripts/operator/refresh-starters.runStarterRefreshCycle",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runSeasonPitching(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  try {
    const res = await runSeasonPitchingCycle({
      sport,
      slateDate: date,
      writeMode,
      log: () => {
        /* swallow per-pitcher verbose chatter */
      },
    });
    let mode: StepMode;
    let reason: string;
    switch (res.status) {
      case "wrote":
        mode = "wrote";
        reason =
          `inserted/updated ${res.rows_written} season row(s); ` +
          `errors=${res.errors}; skipped_empty=${res.skipped_empty}, ` +
          `skipped_nulled=${res.skipped_nulled}, missing_dob=${res.skipped_missing_dob}`;
        break;
      case "dry_run":
        mode = "dry_run";
        reason =
          `dry-run; would write ${res.rows_dry_run} row(s) ` +
          `(planned: ${res.planned_inserts} INSERT + ${res.planned_updates} UPDATE)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.season} missing — would be dry-run anyway)`);
        break;
      case "no_changes":
        mode = writeMode ? "wrote" : "dry_run";
        reason = "every slate starter already has a fresh season row";
        break;
      case "cancelled":
        mode = "skipped";
        reason = "cancelled (confirm returned false)";
        break;
      case "empty_slate":
        mode = "skipped";
        reason = "no slate starters resolved (empty slate or starters unset)";
        break;
      case "failed":
        mode = "failed";
        reason = `failed: ${res.message ?? "unknown"}`;
        break;
    }
    return {
      order,
      name: "S5. Season-pitching stats",
      operator_path:
        "scripts/operator/backfill-season-pitching-stats.runSeasonPitchingCycle",
      mode,
      reason,
      details: {
        planned_inserts: res.planned_inserts,
        planned_updates: res.planned_updates,
        skipped_no_overwrite: res.skipped_no_overwrite,
        skipped_nulled: res.skipped_nulled,
        rows_written: res.rows_written,
        rows_dry_run: res.rows_dry_run,
        skipped_empty: res.skipped_empty,
        skipped_missing_dob: res.skipped_missing_dob,
        errors: res.errors,
        mlb_api_calls: res.mlb_api_calls,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "S5. Season-pitching stats",
      operator_path:
        "scripts/operator/backfill-season-pitching-stats.runSeasonPitchingCycle",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runMissingPitchers(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  try {
    const res = await runMissingPitcherCycle({
      sport,
      date,
      writeMode,
      // In writeMode, allow the helper to attempt every candidate. Per-row
      // skip-existing already provides safety; the limit just caps blast
      // radius from a single cycle and the helper requires >0 in writeMode.
      limit: writeMode ? Math.max(1, 50) : undefined,
      log: () => {
        /* swallow */
      },
    });
    let mode: StepMode;
    let reason: string;
    switch (res.status) {
      case "wrote":
        mode = "wrote";
        reason = `inserted ${res.rows_inserted} player row(s); skipped_existing=${res.skipped_existing}, skipped_missing=${res.skipped_missing_fields}`;
        break;
      case "dry_run":
        mode = "dry_run";
        reason =
          `dry-run; would insert ${res.planned_inserts_after_limit} of ${res.planned_inserts_total} planned` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.pitcher} missing — would be dry-run anyway)`);
        break;
      case "no_changes":
        mode = writeMode ? "wrote" : "dry_run";
        reason = "every probable starter already in players";
        break;
      case "cancelled":
        mode = "skipped";
        reason = "cancelled (confirm returned false)";
        break;
      case "failed":
        mode = "failed";
        reason = `failed: ${res.message ?? "unknown"}`;
        break;
    }
    return {
      order,
      name: "S4. Missing-pitcher ingest",
      operator_path:
        "scripts/operator/ingest-missing-pitchers.runMissingPitcherCycle",
      mode,
      reason,
      details: {
        unique_candidates: res.unique_candidates,
        planned_inserts_total: res.planned_inserts_total,
        planned_inserts_after_limit: res.planned_inserts_after_limit,
        skipped_existing: res.skipped_existing,
        skipped_missing_fields: res.skipped_missing_fields,
        rows_inserted: res.rows_inserted,
        errors: res.errors,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "S4. Missing-pitcher ingest",
      operator_path:
        "scripts/operator/ingest-missing-pitchers.runMissingPitcherCycle",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runLinesV2(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  const dryRun = !writeMode;
  try {
    const res = await linesService.refreshGameLinesV2(sport, date, { dryRun });
    return {
      order,
      name: "S7. Lines V2 refresh (R-16D + R-16E + R-16G-A)",
      operator_path: "lib/services/linesService.refreshGameLinesV2",
      mode: writeMode ? "wrote" : "dry_run",
      reason: writeMode
        ? `wrote ${res.records_updated} line row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} line row(s)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.lines} missing — would be dry-run anyway)`),
      details: {
        records_updated: res.records_updated,
        api_calls: res.api_calls_made,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "S7. Lines V2 refresh (R-16D + R-16E + R-16G-A)",
      operator_path: "lib/services/linesService.refreshGameLinesV2",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runSharpSignals(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  const dryRun = !writeMode;
  try {
    const res = await linesService.refreshSharpSignals(sport, date, { dryRun });
    return {
      order,
      name: "S8. Sharp signals refresh",
      operator_path: "lib/services/linesService.refreshSharpSignals",
      mode: writeMode ? "wrote" : "dry_run",
      reason: writeMode
        ? `wrote ${res.records_updated} signal row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} signal row(s)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.signals} missing — would be dry-run anyway)`),
      details: {
        records_updated: res.records_updated,
        api_calls: res.api_calls_made,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "S8. Sharp signals refresh",
      operator_path: "lib/services/linesService.refreshSharpSignals",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

async function runAutomodel(
  sport: Sport,
  date: string,
  writeMode: boolean,
  perStepEnabled: boolean,
  order: number
): Promise<StepResult> {
  try {
    const res = await generatePredictionsForSlate(sport, date, "morning_draft", {
      writeToDb: writeMode,
    });
    return {
      order,
      name: "M2. Automodel + reviewer + breakdown",
      operator_path: "lib/services/automodelService.generatePredictionsForSlate",
      mode: writeMode ? "wrote" : "dry_run",
      reason: writeMode
        ? `wrote ${res.predictions.length} prediction(s); held=${res.held_count}; errors=${res.errors.length}`
        : `dry-run; would write ${res.predictions.length} prediction(s)` +
          (perStepEnabled
            ? ""
            : ` (per-step gate ${PER_STEP_ENV_VARS.automodel} missing — would be dry-run anyway)`),
      details: {
        game_count: res.game_count,
        held_count: res.held_count,
        pick_null_counts: res.pick_null_counts,
        ai_sanity_actions: res.ai_sanity_actions,
        errors: res.errors.length,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      order,
      name: "M2. Automodel + reviewer + breakdown",
      operator_path: "lib/services/automodelService.generatePredictionsForSlate",
      mode: "failed",
      reason: `failed: ${msg}`,
    };
  }
}

// ─── Final cycle decision ────────────────────────────────────────────

type CycleDecision =
  | "ran_model"
  | "wrote_with_holds"
  | "dry_run_only"
  | "aborted_provider_mismatch"
  | "aborted_gate_fail_closed"
  | "no_slate_in_db"
  | "operator_cancelled";

function decideCycle(
  alignment: ProviderDateAlignmentReport | null,
  gate: AutomationGateReport,
  steps: StepResult[],
  applyRequested: boolean,
  topLevelGateOk: boolean,
  confirmed: boolean
): CycleDecision {
  if (gate.aggregate.total_games === 0) return "no_slate_in_db";
  if (alignment && alignment.status === "fail_closed") {
    return "aborted_provider_mismatch";
  }
  if (gate.overall === "fail_closed") return "aborted_gate_fail_closed";
  if (!applyRequested || !topLevelGateOk) return "dry_run_only";
  if (!confirmed) return "operator_cancelled";
  const automodel = steps.find((s) => s.name.startsWith("M2."));
  if (automodel?.mode !== "wrote") return "dry_run_only";
  const aggregate = gate.aggregate;
  if (aggregate.ml_hold_count > 0 || aggregate.ou_hold_count > 0) {
    return "wrote_with_holds";
  }
  return "ran_model";
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);
  const verbose = readBoolFlag(argv, "--verbose");
  const applyRequested = readBoolFlag(argv, "--apply");
  const topLevelGateOk = process.env[ORCHESTRATOR_ENV_FLAG] === "true";
  const perStep = readPerStepGates();

  console.log(`[run-slate-cycle] R-17 Step 2 — Controlled-apply orchestrator`);
  console.log(`  sport=${common.sport}  date=${common.date}`);
  console.log(
    `  --apply=${applyRequested ? "yes" : "no"}  ${ORCHESTRATOR_ENV_FLAG}=${topLevelGateOk ? "true" : "missing"}`
  );
  console.log(`  per-step gates:`);
  for (const k of Object.keys(perStep) as PerStepKey[]) {
    console.log(
      `    ${PER_STEP_ENV_VARS[k].padEnd(38)} ${perStep[k] ? "true" : "missing"}`
    );
  }
  if (applyRequested && !topLevelGateOk) {
    console.log();
    console.log(
      `  ⚠ --apply set but ${ORCHESTRATOR_ENV_FLAG} missing → dry-run forced for ALL steps.`
    );
  }
  console.log();

  // ── Pre-flight: slate state + provider alignment ────────────────────
  console.log(`━━━ P3. Current DB state ━━━`);
  const gameIdByExternal = await loadGameIdMap(common.sport, common.date);
  const gameIds = [...gameIdByExternal.values()];
  console.log(`  games in slate (DB): ${gameIds.length}`);

  const { count: predictionsCount } = await supabase
    .from("game_predictions")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds);
  const { count: linesCount } = await supabase
    .from("lines")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds)
    .is("player_id", null);
  const { count: sigsCount } = await supabase
    .from("sharp_signals")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds);
  console.log(`  game_predictions:    ${predictionsCount ?? 0}`);
  console.log(`  lines (game-level):  ${linesCount ?? 0}`);
  console.log(`  sharp_signals:       ${sigsCount ?? 0}`);

  console.log();
  console.log(`━━━ P2. Provider date alignment ━━━`);
  let alignment: ProviderDateAlignmentReport | null = null;
  const key = process.env.SHARPAPI_KEY;
  if (!key) {
    console.log(`  ⚠ SHARPAPI_KEY missing — skipping preflight`);
  } else {
    try {
      const client = new SharpApiClient(key);
      alignment = await assessProviderDateAlignment(
        client,
        common.sport,
        common.date,
        { slate_size: gameIds.length > 0 ? gameIds.length : 9 }
      );
      console.log(`  matched:              ${alignment.matched}/${alignment.slate_size}`);
      console.log(`  wrong_date:           ${alignment.wrong_date}`);
      console.log(`  threshold:            ${alignment.threshold}`);
      console.log(`  STATUS:               ${alignment.status.toUpperCase()}`);
      console.log(`  reason:               ${alignment.reason}`);
    } catch (e) {
      console.log(
        `  ✗ preflight failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // ── Pre-write gate (G1) ─────────────────────────────────────────────
  console.log();
  console.log(`━━━ G1. Automation gate (pre-write) ━━━`);
  const preGate = await assessAutomationGate(common.sport, common.date, {
    providerAlignment: alignment,
  });
  console.log(`  overall: ${preGate.overall.toUpperCase()}`);
  console.log(
    `  per-market holds: ML ${preGate.aggregate.ml_hold_count}  OU ${preGate.aggregate.ou_hold_count}  NRFI ${preGate.aggregate.nrfi_hold_count}`
  );

  // ── Resolve effective write mode ────────────────────────────────────
  const providerBlocked = alignment !== null && alignment.status === "fail_closed";
  const effectiveApply = applyRequested && topLevelGateOk && !providerBlocked;
  // Note: per-step writeMode = effectiveApply && perStep[k]. Each runner
  // builds it locally so the report can explain WHY a step stayed dry-run.

  // ── Confirm before any writes ───────────────────────────────────────
  let confirmed = true;
  if (effectiveApply) {
    const summary = [
      `  Steps that WILL WRITE under current env (per-step gates check):`,
      `    S1 slate:        ${perStep.slate ? "WRITE" : "dry-run (env missing)"}`,
      `    S3 starter#1:    ${perStep.starter ? "WRITE" : "dry-run (env missing)"}`,
      `    S4 pitchers:     ${perStep.pitcher ? "WRITE" : "dry-run (env missing)"}`,
      `    S5 season pitch: ${perStep.season ? "WRITE" : "dry-run (env missing)"}`,
      `    S7 lines V2:     ${perStep.lines ? "WRITE" : "dry-run (env missing)"}`,
      `    S8 signals:      ${perStep.signals ? "WRITE" : "dry-run (env missing)"}`,
      `    M1 starter#2:    ${perStep.starter ? "WRITE" : "dry-run (env missing)"}`,
      `    M2 automodel:    ${perStep.automodel ? "WRITE" : "dry-run (env missing)"}` +
        (preGate.overall === "fail_closed" ? " — but gate is fail_closed; will be blocked" : ""),
      ``,
      `  Deferred (not invoked yet):`,
      `    S2 teams      → not_invoked_step2_v1 (Step 2B)`,
      `    S6 bullpen    → not_invoked_step2_v1 (Step 2B)`,
    ].join("\n");
    confirmed = await confirmApply(summary);
    if (!confirmed) {
      console.log();
      console.log(`  Operator cancelled. No writes performed.`);
    }
  } else if (applyRequested && providerBlocked) {
    console.log();
    console.log(
      `  ⚠ Provider alignment fail_closed → write phase aborted before any step ran.`
    );
  }

  // ── Step execution ──────────────────────────────────────────────────
  const steps: StepResult[] = [];
  let nextOrder = 0;

  steps.push({
    order: nextOrder++,
    name: "P1. Resolve slate date",
    operator_path: "(inline)",
    mode: "dry_run",
    reason: `slate=${common.date} sport=${common.sport}`,
  });

  steps.push({
    order: nextOrder++,
    name: "P2. Provider date alignment preflight",
    operator_path: "lib/services/providerDateAlignment.assessProviderDateAlignment",
    mode: alignment === null ? "skipped" : alignment.status === "fail_closed" ? "blocked" : "dry_run",
    reason: alignment === null ? "SHARPAPI_KEY missing" : alignment.reason,
  });

  // S1 — Slate ingest. Run even when gameIds.length > 0 so the slate
  // refreshes statuses / probable pitchers nightly. Skipped only when
  // provider is fail_closed.
  const slateWrite = effectiveApply && confirmed && perStep.slate;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S1. Slate ingest (games rows)",
      operator_path: "lib/services/slateService.refreshGames",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runSlateIngest(common.sport, common.date, slateWrite, perStep.slate, nextOrder++)
    );
  }

  // S2 — Teams refresh: deferred to Step 2B.
  steps.push({
    order: nextOrder++,
    name: "S2. Teams refresh",
    operator_path: "scripts/operator/refresh-teams.ts",
    mode: "not_invoked_step2_v1",
    reason: "deferred to Step 2B (teams change rarely; not on the per-night critical path)",
  });

  // S3 — Starter refresh (first pass).
  const starterWrite = effectiveApply && confirmed && perStep.starter;
  const slateSizeAfterIngest = gameIds.length > 0 ? gameIds.length : 9;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S3. Starter refresh (first pass)",
      operator_path: "scripts/operator/refresh-starters.runStarterRefreshCycle",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runStarterPass(
        common.sport,
        common.date,
        starterWrite,
        perStep.starter,
        slateSizeAfterIngest,
        "first",
        nextOrder++
      )
    );
  }

  // S4 — Missing-pitcher ingest.
  const pitcherWrite = effectiveApply && confirmed && perStep.pitcher;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S4. Missing-pitcher ingest",
      operator_path: "scripts/operator/ingest-missing-pitchers.runMissingPitcherCycle",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runMissingPitchers(common.sport, common.date, pitcherWrite, perStep.pitcher, nextOrder++)
    );
  }

  // S5 — Season-pitching stats. Slate-starter-only scope (the helper
  // resolves player IDs via games.{home,away}_pitcher_id). Per-pitcher
  // failures are isolated by the helper — counted but not crash-fatal.
  // If stats remain missing, the post-refresh gate (G1) holds the
  // affected game/markets.
  const seasonWrite = effectiveApply && confirmed && perStep.season;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S5. Season-pitching stats",
      operator_path:
        "scripts/operator/backfill-season-pitching-stats.runSeasonPitchingCycle",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runSeasonPitching(
        common.sport,
        common.date,
        seasonWrite,
        perStep.season,
        nextOrder++
      )
    );
  }

  // S6 — Bullpen refresh: deferred to Step 2B.
  steps.push({
    order: nextOrder++,
    name: "S6. Bullpen / team-stats refresh",
    operator_path: "scripts/operator/refresh-mlb-stats-from-splits.ts",
    mode: "not_invoked_step2_v1",
    reason: "deferred to Step 2B",
  });

  // S7 — Lines V2 refresh.
  const linesWrite = effectiveApply && confirmed && perStep.lines;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S7. Lines V2 refresh (R-16D + R-16E + R-16G-A)",
      operator_path: "lib/services/linesService.refreshGameLinesV2",
      mode: "blocked",
      reason: "blocked by provider rollover (would only write stale data)",
    });
  } else {
    steps.push(
      await runLinesV2(common.sport, common.date, linesWrite, perStep.lines, nextOrder++)
    );
  }

  // S8 — Sharp signals refresh.
  const signalsWrite = effectiveApply && confirmed && perStep.signals;
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "S8. Sharp signals refresh",
      operator_path: "lib/services/linesService.refreshSharpSignals",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runSharpSignals(
        common.sport,
        common.date,
        signalsWrite,
        perStep.signals,
        nextOrder++
      )
    );
  }

  // M1 — Final starter refresh.
  if (providerBlocked) {
    steps.push({
      order: nextOrder++,
      name: "M1. Starter refresh (final pass before model)",
      operator_path: "scripts/operator/refresh-starters.runStarterRefreshCycle",
      mode: "blocked",
      reason: "blocked by provider rollover",
    });
  } else {
    steps.push(
      await runStarterPass(
        common.sport,
        common.date,
        starterWrite,
        perStep.starter,
        slateSizeAfterIngest,
        "final",
        nextOrder++
      )
    );
  }

  // G1 — re-assess gate AFTER the data-refreshing steps (lines, signals,
  // starters may have changed coverage). This is the decisive gate for
  // M2 (automodel).
  console.log();
  console.log(`━━━ G1. Automation gate (post-refresh) ━━━`);
  const finalGate = await assessAutomationGate(common.sport, common.date, {
    providerAlignment: alignment,
  });
  console.log(`  overall: ${finalGate.overall.toUpperCase()}`);
  console.log(
    `  per-market holds: ML ${finalGate.aggregate.ml_hold_count}  OU ${finalGate.aggregate.ou_hold_count}  NRFI ${finalGate.aggregate.nrfi_hold_count}`
  );
  steps.push({
    order: nextOrder++,
    name: "G1. Automation gate (final assessment)",
    operator_path: "lib/services/automationGate.assessAutomationGate",
    mode: finalGate.overall === "fail_closed" ? "blocked" : "dry_run",
    reason: `overall=${finalGate.overall} · per-market holds: ML ${finalGate.aggregate.ml_hold_count}/${finalGate.aggregate.total_games}, OU ${finalGate.aggregate.ou_hold_count}/${finalGate.aggregate.total_games}, NRFI ${finalGate.aggregate.nrfi_hold_count}/${finalGate.aggregate.total_games}`,
    details: {
      total_games: finalGate.aggregate.total_games,
      games_with_complete_starters: finalGate.aggregate.games_with_complete_starters,
      games_with_ml_lines: finalGate.aggregate.games_with_ml_lines,
      games_with_total_lines: finalGate.aggregate.games_with_total_lines,
      games_with_fi_lines: finalGate.aggregate.games_with_fi_lines,
      games_with_sharp_signals: finalGate.aggregate.games_with_sharp_signals,
    },
  });

  // M2 — Automodel + reviewer.
  const modelBlocked =
    providerBlocked || finalGate.overall === "fail_closed";
  const modelWrite = effectiveApply && confirmed && perStep.automodel && !modelBlocked;
  if (modelBlocked) {
    steps.push({
      order: nextOrder++,
      name: "M2. Automodel + reviewer + breakdown",
      operator_path: "lib/services/automodelService.generatePredictionsForSlate",
      mode: "blocked",
      reason: providerBlocked
        ? "blocked by provider rollover"
        : "blocked by automation gate fail_closed",
    });
  } else {
    steps.push(
      await runAutomodel(
        common.sport,
        common.date,
        modelWrite,
        perStep.automodel,
        nextOrder++
      )
    );
  }

  // ── Final report ────────────────────────────────────────────────────
  console.log();
  console.log(`━━━ Per-step results (verbose) ━━━`);
  for (const s of steps) {
    const tag = (() => {
      switch (s.mode) {
        case "wrote":
          return "✓ WROTE";
        case "dry_run":
          return "○ DRY-RUN";
        case "skipped":
          return "↷ SKIPPED";
        case "blocked":
          return "🚫 BLOCKED";
        case "failed":
          return "✗ FAILED";
        case "not_invoked_step2_v1":
          return "… NOT-INVOKED (Step 2 v1)";
      }
    })();
    console.log(`  ${String(s.order).padStart(2)}. ${tag.padEnd(28)} ${s.name}`);
    console.log(`      ${s.operator_path}`);
    console.log(`      reason: ${s.reason}`);
    if (verbose && s.details) {
      const json = JSON.stringify(s.details, null, 2)
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n");
      console.log(json);
    }
  }

  console.log();
  console.log(`━━━ Final cycle decision ━━━`);
  const decision = decideCycle(
    alignment,
    finalGate,
    steps,
    applyRequested,
    topLevelGateOk,
    confirmed
  );
  const decisionLabel = (() => {
    switch (decision) {
      case "ran_model":
        return "🟢 RAN_MODEL (clean writes)";
      case "wrote_with_holds":
        return "🟡 WROTE_WITH_HOLDS";
      case "dry_run_only":
        return "○ DRY_RUN_ONLY";
      case "aborted_provider_mismatch":
        return "🚫 ABORTED_PROVIDER_MISMATCH";
      case "aborted_gate_fail_closed":
        return "🚫 ABORTED_GATE_FAIL_CLOSED";
      case "no_slate_in_db":
        return "🚫 NO_SLATE_IN_DB";
      case "operator_cancelled":
        return "↷ OPERATOR_CANCELLED";
    }
  })();
  console.log(`  decision: ${decisionLabel}`);

  const failed = steps.some((s) => s.mode === "failed");
  if (failed) process.exit(2);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
