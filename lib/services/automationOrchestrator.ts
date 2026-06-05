/**
 * Phase 4.2.C.1.R-19 Phase 2 — non-interactive slate-cycle orchestrator.
 *
 * Parallel to the operator-facing `scripts/operator/automation/run-slate-cycle.ts`
 * but designed for cron execution: NO interactive prompts, NO console.log
 * noise, ONE structured report returned. Both orchestrators call the same
 * R-17 helpers and service functions, so the underlying writes (when env
 * flags are set) are identical.
 *
 * Safety invariants enforced here, NOT at the route layer:
 *
 *   • Provider mode audit (R-17 Step 2C) MUST pass before any write step
 *     becomes effective. If ANY required provider is not real_api, every
 *     downstream step's effective_write_mode is forced to false (the step
 *     still runs in dry-run mode, so the report shows what WOULD happen).
 *   • Slate reconciliation (R-17 Step 2B) MUST pass before S7/S8/M2
 *     become writable. fail_closed reconciliation blocks lines, signals,
 *     and prediction writes.
 *   • Provider date alignment is captured for the report but its
 *     fail_closed state only WARNS (not block) — the morning-slate cron
 *     historically tolerated alignment misses while logging them.
 *   • Per-step env flag MUST be set for each step's write to fire,
 *     mirroring the operator path. Missing flag → dry_run for that step.
 *   • Publish gate (R-19 Phase 1 C4) is hold-as-draft by default.
 *     `MORNING_SLATE_AUTO_PUBLISH=true` is the only opt-in.
 *
 * Cron-side gates (CRON_SECRET, ORCHESTRATOR_SKIP_CONFIRMATION) live in
 * the route layer (`app/api/cron/slate-cycle/route.ts`) so this module
 * stays pure-ish and unit-testable in isolation.
 */

import { supabase } from "../db/supabase";
import { SharpApiClient } from "../providers/real_api/_sharpApiClient";
import { getSlateProvider } from "../providers/factory";
import { discoverEventsFromOpportunities } from "../providers/real_api/_opportunitiesDiscovery";
import {
  assessProviderModes,
  type ProviderModeReport,
} from "./providerModeAudit";
import {
  assessProviderDateAlignment,
  type ProviderDateAlignmentReport,
} from "./providerDateAlignment";
import {
  reconcileBdlVsSharpEv,
  type SlateReconciliationReport,
} from "./slateReconciliation";
import {
  assessAutomationGate,
  type AutomationGateReport,
} from "./automationGate";
import { slateService } from "./slateService";
import { linesService } from "./linesService";
import { generatePredictionsForSlate } from "./automodelService";
import { publishSlate } from "./slatePublishService";
import {
  shouldAutoPublishMorningSlate,
  publishDecisionLabel,
} from "./morningSlatePublishPolicy";
import { runStarterRefreshCycle } from "../../scripts/operator/refresh-starters";
import { runMissingPitcherCycle } from "../../scripts/operator/ingest-missing-pitchers";
import { runSeasonPitchingCycle } from "../../scripts/operator/backfill-season-pitching-stats";
import { loadGameIdMap } from "./_idMaps";
import type { Sport } from "../types/domain/Sport";

// ─── Pure gate helpers — re-exported from automationOrchestratorGates ───
//
// The pure helpers (env-flag readers, effective-write-mode computation,
// blocked-report builder) live in a sibling module that does NOT import
// supabase / provider clients, so the gates themselves can be unit-tested
// without DB env. Re-exported here for callers that already have
// `automationOrchestrator` imported.
export {
  ORCHESTRATOR_GATE_ENV,
  PER_STEP_ENV_VARS,
  isOrchestratorGateEnabled,
  readPerStepGates,
  computeEffectiveWriteMode,
  buildOrchestratorBlockedReport,
} from "./automationOrchestratorGates";
export type { AutomationEnv, PerStepKey } from "./automationOrchestratorGates";

import {
  PER_STEP_ENV_VARS,
  isOrchestratorGateEnabled,
  readPerStepGates,
  computeEffectiveWriteMode,
  type AutomationEnv,
  type PerStepKey,
} from "./automationOrchestratorGates";

// ─── Step + report types ─────────────────────────────────────────────────

export type AutomationStepName =
  | "p0_provider_mode_audit"
  | "p2_provider_date_alignment"
  | "p2_5_slate_reconciliation"
  | "s1_slate_ingest"
  | "s3_starter_refresh_first"
  | "s4_missing_pitcher_ingest"
  | "s5_season_pitching"
  | "s7_lines_v2_refresh"
  | "s8_sharp_signals_refresh"
  | "g1_automation_gate"
  | "m1_starter_refresh_final"
  | "m2_automodel"
  | "s11_publish_gate";

export type StepMode =
  | "dry_run"        // ran in dry-run mode (no write)
  | "wrote"          // ran and wrote to DB
  | "skipped"        // step had no work (empty slate, no candidates)
  | "blocked"        // upstream gate prevented the step
  | "failed";        // step ran but errored

export type AutomationStepReport = {
  name: AutomationStepName;
  mode: StepMode;
  duration_ms: number;
  reason: string;
  details?: Record<string, unknown>;
  error_message?: string;
};

export type AutomationRunReport = {
  requested_date: string;
  sport: Sport;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  orchestrator_gate_enabled: boolean;
  per_step_gates: Record<PerStepKey, boolean>;
  effective_write_mode: Record<PerStepKey, boolean>;
  provider_modes: {
    slate: string;
    odds: string;
    sharp_signal: string;
    player_stats: string;
    eligible_for_apply: boolean;
    reason: string | null;
  };
  bdl_game_count: number | null;
  sharp_ev_count: number | null;
  reconciliation: {
    status: "ok" | "warn" | "fail_closed" | "skipped" | null;
    overlap_pct: number | null;
    matched: number | null;
    bdl_only_matchups: string[];
    sharp_only_matchups: string[];
  };
  provider_date_alignment: {
    status: "ok" | "warn" | "fail_closed" | "skipped" | null;
    matched: number | null;
    wrong_date: number | null;
  };
  steps: AutomationStepReport[];
  publish_decision:
    | "auto_publish_enabled"
    | "hold_as_draft"
    | "skipped_blocked";
  publish_decision_label: string;
  overall_status: "ok" | "blocked" | "degraded" | "failed";
  blocking_reasons: string[];
  warnings: string[];
  /**
   * True iff today's slate (post-cycle) is in a state where the Daily
   * Edge route would surface games for the requested_date — i.e.
   * `slateState === "today_published"`. False under all other states.
   * Computed by re-probing the games table after the orchestrator
   * completes; no separate DB transaction needed.
   */
  ui_safe: boolean;
};

// ─── Orchestrator implementation ─────────────────────────────────────────

/**
 * Compute the orchestrator run report. Pure-ish: the only side effects
 * are HTTP calls to providers (BDL, SharpAPI, MLB Stats) and (when env
 * flags allow) per-step service writes. No console output, no readline.
 */
export async function runSlateCycleAutomated(opts: {
  sport: Sport;
  date: string;
  env?: AutomationEnv;
}): Promise<AutomationRunReport> {
  const env = opts.env ?? process.env;
  const orchestratorGate = isOrchestratorGateEnabled(env);
  const perStepGates = readPerStepGates(env);
  const startedAt = new Date();
  const steps: AutomationStepReport[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // ── P0. Provider mode audit ──────────────────────────────────────────
  const t0p = Date.now();
  const providerModeReport: ProviderModeReport = assessProviderModes(env);
  steps.push({
    name: "p0_provider_mode_audit",
    mode: providerModeReport.eligibleForApply ? "dry_run" : "blocked",
    duration_ms: Date.now() - t0p,
    reason: providerModeReport.eligibleForApply
      ? "all required providers set to real_api"
      : providerModeReport.reason ?? "provider modes block apply",
    details: {
      modes: providerModeReport.modes.map((m) => ({
        name: m.name,
        env_key: m.envKey,
        status: m.status,
      })),
      blocking_providers: providerModeReport.blockingProviders.map((b) => b.envKey),
    },
  });
  const providerModeBlocking = !providerModeReport.eligibleForApply;
  if (providerModeBlocking) {
    blockingReasons.push(
      `provider mode audit failed: ${providerModeReport.reason ?? "non-real_api providers detected"}`
    );
  }

  // Provider-mode mapping for the report top-level field.
  const modeByName: Record<string, string> = {};
  for (const m of providerModeReport.modes) modeByName[m.name] = m.status;

  // ── P2. Provider date alignment ───────────────────────────────────────
  let alignment: ProviderDateAlignmentReport | null = null;
  const sharpKey = env.SHARPAPI_KEY;
  const t0a = Date.now();
  if (!sharpKey) {
    warnings.push("SHARPAPI_KEY missing — provider date alignment skipped");
    steps.push({
      name: "p2_provider_date_alignment",
      mode: "skipped",
      duration_ms: Date.now() - t0a,
      reason: "SHARPAPI_KEY missing",
    });
  } else {
    try {
      const client = new SharpApiClient(sharpKey);
      const gameIdByExternalProbe = await loadGameIdMap(opts.sport, opts.date);
      const slateSize = gameIdByExternalProbe.size > 0 ? gameIdByExternalProbe.size : 9;
      alignment = await assessProviderDateAlignment(client, opts.sport, opts.date, {
        slate_size: slateSize,
      });
      steps.push({
        name: "p2_provider_date_alignment",
        mode: alignment.status === "fail_closed" ? "blocked" : "dry_run",
        duration_ms: Date.now() - t0a,
        reason: alignment.reason,
        details: {
          status: alignment.status,
          matched: alignment.matched,
          wrong_date: alignment.wrong_date,
          threshold: alignment.threshold,
          slate_size: alignment.slate_size,
        },
      });
      if (alignment.status === "fail_closed") {
        warnings.push(
          `provider date alignment fail_closed: ${alignment.reason} (warning — not a hard block in V1)`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`provider date alignment failed: ${msg}`);
      steps.push({
        name: "p2_provider_date_alignment",
        mode: "failed",
        duration_ms: Date.now() - t0a,
        reason: msg,
        error_message: msg,
      });
    }
  }

  // ── P2.5. Slate reconciliation ───────────────────────────────────────
  let reconciliation: SlateReconciliationReport | null = null;
  let bdlGameCount: number | null = null;
  let sharpEvCount: number | null = null;
  const t0r = Date.now();
  if (!sharpKey) {
    steps.push({
      name: "p2_5_slate_reconciliation",
      mode: "skipped",
      duration_ms: Date.now() - t0r,
      reason: "SHARPAPI_KEY missing",
    });
  } else {
    try {
      const slateProvider = getSlateProvider();
      const bdlGames = await slateProvider.getGames(opts.date, opts.sport);
      bdlGameCount = bdlGames.length;

      // Resolve BDL external team_ids → abbreviations.
      const teamExtIds = new Set<number>();
      for (const g of bdlGames) {
        if (g.home_team_external_id !== null) teamExtIds.add(g.home_team_external_id);
        if (g.away_team_external_id !== null) teamExtIds.add(g.away_team_external_id);
      }
      const abbrByExt = new Map<number, string>();
      if (teamExtIds.size > 0) {
        const { data: teamRows } = await supabase
          .from("teams")
          .select("external_id, abbreviation")
          .in("external_id", [...teamExtIds]);
        for (const r of (teamRows ?? []) as Array<{ external_id: number; abbreviation: string }>) {
          abbrByExt.set(r.external_id, r.abbreviation);
        }
      }
      const bdlPairs = bdlGames
        .map((g) => ({
          away_abbr: abbrByExt.get(g.away_team_external_id ?? -1) ?? "",
          home_abbr: abbrByExt.get(g.home_team_external_id ?? -1) ?? "",
        }))
        .filter((p) => p.away_abbr !== "" && p.home_abbr !== "");

      const client = new SharpApiClient(sharpKey);
      const ev = await discoverEventsFromOpportunities(client, opts.sport, opts.date);
      sharpEvCount = ev.events.length;
      const sharpPairs = ev.events.map((e) => ({ home: e.home, away: e.away }));

      reconciliation = reconcileBdlVsSharpEv(bdlPairs, sharpPairs);
      steps.push({
        name: "p2_5_slate_reconciliation",
        mode: reconciliation.status === "fail_closed" ? "blocked" : "dry_run",
        duration_ms: Date.now() - t0r,
        reason: reconciliation.reason,
        details: {
          status: reconciliation.status,
          bdl_count: reconciliation.bdlCount,
          sharp_ev_count: reconciliation.sharpEvCount,
          matched: reconciliation.matchedCount,
          overlap_pct: reconciliation.overlapPct,
          bdl_only: reconciliation.bdlOnlyMatchups,
          sharp_only: reconciliation.sharpOnlyMatchups,
        },
      });
      if (reconciliation.status === "fail_closed") {
        blockingReasons.push(
          `slate reconciliation fail_closed: ${reconciliation.reason}`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      blockingReasons.push(`slate reconciliation failed: ${msg}`);
      steps.push({
        name: "p2_5_slate_reconciliation",
        mode: "failed",
        duration_ms: Date.now() - t0r,
        reason: msg,
        error_message: msg,
      });
    }
  }

  const reconciliationBlocking =
    reconciliation !== null && reconciliation.status === "fail_closed";
  const dataLayerBlocked = providerModeBlocking || reconciliationBlocking;

  // ── Helper: per-step effective write mode ─────────────────────────────
  const effectiveWriteMode = {} as Record<PerStepKey, boolean>;
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    effectiveWriteMode[k] = computeEffectiveWriteMode({
      orchestratorGate,
      perStepGate: perStepGates[k],
      upstreamBlocked: dataLayerBlocked,
    });
  }

  // ── S1. Slate ingest ─────────────────────────────────────────────────
  steps.push(await runStep("s1_slate_ingest", effectiveWriteMode.slate, "slate", async (writeMode) => {
    const res = await slateService.refreshGames(opts.sport, opts.date, undefined, {
      dryRun: !writeMode,
    });
    return {
      details: { records_updated: res.records_updated, api_calls: res.api_calls_made },
      reason: writeMode
        ? `wrote ${res.records_updated} game row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} game row(s)`,
    };
  }));

  // ── S3. Starter refresh (first pass) ─────────────────────────────────
  const gameIdByExternalAfterS1 = await loadGameIdMap(opts.sport, opts.date);
  const slateSizeAfterS1 = gameIdByExternalAfterS1.size;
  steps.push(await runStep("s3_starter_refresh_first", effectiveWriteMode.starter, "starter", async (writeMode) => {
    const res = await runStarterRefreshCycle({
      sport: opts.sport,
      date: opts.date,
      writeMode,
      limit: writeMode ? Math.max(1, slateSizeAfterS1) : undefined,
      log: () => undefined,
    });
    return {
      details: {
        status: res.status,
        games_in_slate: res.games_in_slate,
        planned_writes: res.planned_writes,
        games_updated: res.games_updated,
        sides_written: res.sides_written,
      },
      reason: starterReasonFromStatus(res.status, res, writeMode),
    };
  }));

  // ── S4. Missing-pitcher ingest ───────────────────────────────────────
  steps.push(await runStep("s4_missing_pitcher_ingest", effectiveWriteMode.pitcher, "pitcher", async (writeMode) => {
    const res = await runMissingPitcherCycle({
      sport: opts.sport,
      date: opts.date,
      writeMode,
      limit: writeMode ? Math.max(1, 50) : undefined,
      log: () => undefined,
    });
    return {
      details: {
        status: res.status,
        unique_candidates: res.unique_candidates,
        planned_inserts_total: res.planned_inserts_total,
        rows_inserted: res.rows_inserted,
      },
      reason: pitcherReasonFromStatus(res.status, res, writeMode),
    };
  }));

  // ── S5. Season-pitching stats ─────────────────────────────────────────
  steps.push(await runStep("s5_season_pitching", effectiveWriteMode.season, "season", async (writeMode) => {
    const res = await runSeasonPitchingCycle({
      sport: opts.sport,
      slateDate: opts.date,
      writeMode,
      log: () => undefined,
    });
    return {
      details: {
        status: res.status,
        planned_inserts: res.planned_inserts,
        planned_updates: res.planned_updates,
        rows_written: res.rows_written,
        rows_dry_run: res.rows_dry_run,
        errors: res.errors,
      },
      reason: seasonReasonFromStatus(res.status, res, writeMode),
    };
  }));

  // ── S7. Lines V2 refresh ──────────────────────────────────────────────
  steps.push(await runStep("s7_lines_v2_refresh", effectiveWriteMode.lines, "lines", async (writeMode) => {
    const res = await linesService.refreshGameLinesV2(opts.sport, opts.date, {
      dryRun: !writeMode,
    });
    return {
      details: { records_updated: res.records_updated, api_calls: res.api_calls_made },
      reason: writeMode
        ? `wrote ${res.records_updated} line row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} line row(s)`,
    };
  }));

  // ── S8. Sharp signals refresh ─────────────────────────────────────────
  steps.push(await runStep("s8_sharp_signals_refresh", effectiveWriteMode.signals, "signals", async (writeMode) => {
    const res = await linesService.refreshSharpSignals(opts.sport, opts.date, {
      dryRun: !writeMode,
    });
    return {
      details: { records_updated: res.records_updated, api_calls: res.api_calls_made },
      reason: writeMode
        ? `wrote ${res.records_updated} signal row(s); api_calls=${res.api_calls_made}`
        : `dry-run; would write ${res.records_updated} signal row(s)`,
    };
  }));

  // ── G1. Automation gate (post-refresh) ────────────────────────────────
  const t0g = Date.now();
  let g1Report: AutomationGateReport | null = null;
  try {
    g1Report = await assessAutomationGate(opts.sport, opts.date, {
      providerAlignment: alignment,
    });
    steps.push({
      name: "g1_automation_gate",
      mode: g1Report.overall === "fail_closed" ? "blocked" : "dry_run",
      duration_ms: Date.now() - t0g,
      reason: `overall=${g1Report.overall}`,
      details: {
        overall: g1Report.overall,
        reasons: g1Report.reasons,
      },
    });
    if (g1Report.overall === "fail_closed") {
      blockingReasons.push(
        `automation gate fail_closed: ${(g1Report.reasons ?? []).join("; ")}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`automation gate failed: ${msg}`);
    steps.push({
      name: "g1_automation_gate",
      mode: "failed",
      duration_ms: Date.now() - t0g,
      reason: msg,
      error_message: msg,
    });
  }
  const gateBlocking = g1Report !== null && g1Report.overall === "fail_closed";

  // ── M1. Starter refresh (final pass before model) ─────────────────────
  steps.push(await runStep("m1_starter_refresh_final", effectiveWriteMode.starter, "starter", async (writeMode) => {
    const res = await runStarterRefreshCycle({
      sport: opts.sport,
      date: opts.date,
      writeMode,
      limit: writeMode ? Math.max(1, slateSizeAfterS1) : undefined,
      log: () => undefined,
    });
    return {
      details: {
        status: res.status,
        sides_written: res.sides_written,
        games_updated: res.games_updated,
      },
      reason: starterReasonFromStatus(res.status, res, writeMode),
    };
  }));

  // ── M2. Automodel + reviewer + breakdown ──────────────────────────────
  const m2Blocked = gateBlocking || dataLayerBlocked;
  steps.push(await runStep(
    "m2_automodel",
    !m2Blocked && effectiveWriteMode.automodel,
    "automodel",
    async (writeMode) => {
      const res = await generatePredictionsForSlate(opts.sport, opts.date, "morning_draft", {
        writeToDb: writeMode,
      });
      return {
        details: {
          game_count: res.game_count,
          held_count: res.held_count,
          pick_null_counts: res.pick_null_counts,
          errors: res.errors.length,
        },
        reason: writeMode
          ? `wrote ${res.predictions.length} prediction(s); held=${res.held_count}`
          : `dry-run; would write ${res.predictions.length} prediction(s); held=${res.held_count}`,
      };
    },
    m2Blocked ? "blocked by upstream gate (provider/reconciliation/G1)" : undefined
  ));

  // ── S11. Publish gate ────────────────────────────────────────────────
  // R-19 Phase 1 (C4) — HOLD-as-draft default. Auto-publish only when
  // MORNING_SLATE_AUTO_PUBLISH=true is explicitly set. Even if set, an
  // upstream block still skips publish.
  const t0pub = Date.now();
  const autoPublish = shouldAutoPublishMorningSlate(env);
  let publishDecision: AutomationRunReport["publish_decision"];
  let publishMode: StepMode;
  let publishReason: string;
  if (dataLayerBlocked || gateBlocking) {
    publishDecision = "skipped_blocked";
    publishMode = "blocked";
    publishReason = "publish skipped — upstream gate blocked the cycle";
  } else if (autoPublish && orchestratorGate) {
    // Auto-publish is on AND orchestrator gate is enabled. Run publishSlate.
    publishDecision = "auto_publish_enabled";
    try {
      const publishRes = await publishSlate(opts.sport, opts.date);
      publishMode = "wrote";
      publishReason = `auto-publish: promoted ${publishRes.promoted} game(s); ${publishDecisionLabel(true)}`;
      steps.push({
        name: "s11_publish_gate",
        mode: publishMode,
        duration_ms: Date.now() - t0pub,
        reason: publishReason,
        details: { promoted: publishRes.promoted, decision: publishDecisionLabel(true) },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      publishMode = "failed";
      publishReason = `auto-publish failed: ${msg}`;
      steps.push({
        name: "s11_publish_gate",
        mode: publishMode,
        duration_ms: Date.now() - t0pub,
        reason: publishReason,
        error_message: msg,
      });
      warnings.push(publishReason);
    }
  } else {
    publishDecision = "hold_as_draft";
    publishMode = "skipped";
    publishReason = `publish skipped — ${publishDecisionLabel(false)}`;
    steps.push({
      name: "s11_publish_gate",
      mode: publishMode,
      duration_ms: Date.now() - t0pub,
      reason: publishReason,
      details: { decision: publishDecisionLabel(false) },
    });
  }

  // ── Compute ui_safe: is the slate in a state where Daily Edge would
  // surface today's games? Re-probe games table for visible (published/
  // final) status on the requested date.
  let uiSafe = false;
  try {
    const { data: visibleProbe } = await supabase
      .from("games")
      .select("slate_status")
      .eq("sport", opts.sport)
      .eq("slate_date", opts.date)
      .in("slate_status", ["published", "final"])
      .limit(1);
    uiSafe = (visibleProbe ?? []).length > 0;
  } catch (e) {
    warnings.push(
      `ui_safe probe failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // ── Overall status ───────────────────────────────────────────────────
  let overall: AutomationRunReport["overall_status"];
  const anyStepFailed = steps.some((s) => s.mode === "failed");
  if (blockingReasons.length > 0) overall = "blocked";
  else if (anyStepFailed) overall = "failed";
  else if (warnings.length > 0) overall = "degraded";
  else overall = "ok";

  const finishedAt = new Date();
  return {
    requested_date: opts.date,
    sport: opts.sport,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    orchestrator_gate_enabled: orchestratorGate,
    per_step_gates: perStepGates,
    effective_write_mode: effectiveWriteMode,
    provider_modes: {
      slate: modeByName["Slate"] ?? "unset",
      odds: modeByName["Odds"] ?? "unset",
      sharp_signal: modeByName["Sharp Signal"] ?? "unset",
      player_stats: modeByName["Player Stats"] ?? "unset",
      eligible_for_apply: providerModeReport.eligibleForApply,
      reason: providerModeReport.reason,
    },
    bdl_game_count: bdlGameCount,
    sharp_ev_count: sharpEvCount,
    reconciliation: {
      status: reconciliation?.status ?? (sharpKey ? null : "skipped"),
      overlap_pct: reconciliation?.overlapPct ?? null,
      matched: reconciliation?.matchedCount ?? null,
      bdl_only_matchups: reconciliation?.bdlOnlyMatchups ?? [],
      sharp_only_matchups: reconciliation?.sharpOnlyMatchups ?? [],
    },
    provider_date_alignment: {
      status: alignment?.status ?? (sharpKey ? null : "skipped"),
      matched: alignment?.matched ?? null,
      wrong_date: alignment?.wrong_date ?? null,
    },
    steps,
    publish_decision: publishDecision,
    publish_decision_label: publishDecisionLabel(
      publishDecision === "auto_publish_enabled"
    ),
    overall_status: overall,
    blocking_reasons: blockingReasons,
    warnings,
    ui_safe: uiSafe,
  };
}

// ─── Step runner helper ──────────────────────────────────────────────────

/**
 * Tiny wrapper around the "call a service, catch errors, build a
 * StepResult" pattern. Eliminates duplicated try/catch blocks across
 * S1–M2. The blockedReason argument forces a "blocked" outcome without
 * even calling the inner function — used for M2 when an upstream gate
 * already failed.
 */
async function runStep(
  name: AutomationStepName,
  effectiveWriteMode: boolean,
  perStepKey: PerStepKey,
  inner: (writeMode: boolean) => Promise<{ details: Record<string, unknown>; reason: string }>,
  blockedReason?: string
): Promise<AutomationStepReport> {
  const t0 = Date.now();
  if (blockedReason !== undefined) {
    return {
      name,
      mode: "blocked",
      duration_ms: Date.now() - t0,
      reason: blockedReason,
      details: { per_step_env_var: PER_STEP_ENV_VARS[perStepKey] },
    };
  }
  try {
    const { details, reason } = await inner(effectiveWriteMode);
    return {
      name,
      mode: effectiveWriteMode ? "wrote" : "dry_run",
      duration_ms: Date.now() - t0,
      reason,
      details: { ...details, per_step_env_var: PER_STEP_ENV_VARS[perStepKey] },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      name,
      mode: "failed",
      duration_ms: Date.now() - t0,
      reason: `failed: ${msg}`,
      error_message: msg,
      details: { per_step_env_var: PER_STEP_ENV_VARS[perStepKey] },
    };
  }
}

// ─── Status → reason helpers (mirror operator strings for parity) ───────

function starterReasonFromStatus(
  status: string,
  res: { planned_writes?: number; sides_written?: number; games_updated?: number; message?: string },
  writeMode: boolean
): string {
  if (status === "wrote") {
    return `wrote ${res.sides_written ?? 0} side(s) across ${res.games_updated ?? 0} game(s)`;
  }
  if (status === "dry_run") {
    return `dry-run; planned ${res.planned_writes ?? 0} game write(s)`;
  }
  if (status === "no_changes") {
    return writeMode ? "no starter changes proposed" : "no starter changes (dry-run)";
  }
  if (status === "empty_slate") return "empty slate";
  if (status === "cancelled") return "cancelled (confirm returned false)";
  if (status === "failed") return `failed: ${res.message ?? "unknown"}`;
  return status;
}

function pitcherReasonFromStatus(
  status: string,
  res: { planned_inserts_after_limit?: number; planned_inserts_total?: number; rows_inserted?: number; skipped_existing?: number; message?: string },
  _writeMode: boolean
): string {
  if (status === "wrote") {
    return `inserted ${res.rows_inserted ?? 0} player row(s); skipped_existing=${res.skipped_existing ?? 0}`;
  }
  if (status === "dry_run") {
    return `dry-run; would insert ${res.planned_inserts_after_limit ?? 0} of ${res.planned_inserts_total ?? 0} planned`;
  }
  if (status === "no_changes") return "every probable starter already in players";
  if (status === "cancelled") return "cancelled (confirm returned false)";
  if (status === "failed") return `failed: ${res.message ?? "unknown"}`;
  return status;
}

function seasonReasonFromStatus(
  status: string,
  res: { planned_inserts?: number; planned_updates?: number; rows_written?: number; rows_dry_run?: number; errors?: number; message?: string },
  _writeMode: boolean
): string {
  if (status === "wrote") {
    return `inserted/updated ${res.rows_written ?? 0} season row(s); errors=${res.errors ?? 0}`;
  }
  if (status === "dry_run") {
    return `dry-run; would write ${res.rows_dry_run ?? 0} row(s) (${res.planned_inserts ?? 0} INSERT + ${res.planned_updates ?? 0} UPDATE)`;
  }
  if (status === "no_changes") return "every slate starter already has a fresh season row";
  if (status === "empty_slate") return "no slate starters resolved";
  if (status === "cancelled") return "cancelled (confirm returned false)";
  if (status === "failed") return `failed: ${res.message ?? "unknown"}`;
  return status;
}

