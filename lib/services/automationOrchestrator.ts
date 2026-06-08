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
import { auditMarketCoverage } from "./marketCoverageAudit";
import { supabase as supabaseClient } from "../db/supabase";
import { generatePredictionsForSlate } from "./automodelService";
import { publishSlate } from "./slatePublishService";
import {
  shouldAutoPublishMorningSlate,
  publishDecisionLabel,
} from "./morningSlatePublishPolicy";
import { runStarterRefreshCycle } from "../../scripts/operator/refresh-starters";
import { runMissingPitcherCycle } from "../../scripts/operator/ingest-missing-pitchers";
import { runSeasonPitchingCycle } from "../../scripts/operator/backfill-season-pitching-stats";
import { runFirstInningCycle } from "../../scripts/operator/backfill-first-inning-stats";
// Push 3B-6 — model readiness audit + repair (in-cycle guardrail).
import { auditMlbModelReadiness, repairMlbModelReadiness } from "./modelReadinessService";
import { loadGameIdMap } from "./_idMaps";
import {
  assessMinimumGameCount,
  assessStarterCoverage,
  assessInProgressGames,
  anyGateFailedClosed,
  type MinimumGameCountResult,
  type StarterCoverageResult,
  type InProgressGamesResult,
} from "./automationSlateSafetyGates";
import {
  assessSlateLockSnapshot,
  deriveLockWarnings,
  anyLockWarningBlocks,
  extractLockMissExclusions,
  type SlateLockSnapshotResult,
  type LockWarning,
} from "./automationSlateLockSnapshot";
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
  STEP_PROVIDER_DEPS,
  isOrchestratorGateEnabled,
  readPerStepGates,
  computeEffectiveWriteMode,
  computeEffectiveWriteModeV2,
  defaultProviderHealth,
  buildOrchestratorBlockedReport,
  shouldDemoteAlignmentForGate,
} from "./automationOrchestratorGates";
export type {
  AutomationEnv,
  PerStepKey,
  ProviderKind,
  ProviderHealth,
  ProviderHealthStatus,
} from "./automationOrchestratorGates";

import {
  PER_STEP_ENV_VARS,
  STEP_PROVIDER_DEPS,
  isOrchestratorGateEnabled,
  readPerStepGates,
  computeEffectiveWriteMode,
  computeEffectiveWriteModeV2,
  defaultProviderHealth,
  shouldDemoteAlignmentForGate,
  type AutomationEnv,
  type PerStepKey,
  type ProviderHealth,
} from "./automationOrchestratorGates";

// ─── Step + report types ─────────────────────────────────────────────────

export type AutomationStepName =
  | "p0_provider_mode_audit"
  | "p2_provider_date_alignment"
  | "p2_5_slate_reconciliation"
  // R-19 Phase 4a — slate-safety gates G1/G3 (fire early once BDL data
  // is in hand). G2 (g2_starter_coverage) fires late, after M1.
  | "g1_minimum_game_count"
  | "g3_in_progress_ingest"
  | "s1_slate_ingest"
  | "s3_starter_refresh_first"
  | "s4_missing_pitcher_ingest"
  | "s5_season_pitching"
  // Phase 6B.31b — first-inning splits refresh for slate probable
  // starters. Reuses the same operator helper as the standalone
  // backfill CLI. Writer is scoped to first_inning_* columns only
  // (defense-in-depth in the writer + payload). Runs AFTER S5 (paired
  // with season-pitching since both write to player_season_stats with
  // disjoint column sets) and BEFORE S5.5 readiness audit (so the
  // audit sees the freshest first-inning state).
  | "s6_first_inning_refresh"
  // Push 3B-6 — readiness guardrail steps. Audit + repair + re-audit
  // run AFTER S5 (so pitcher stats are present) and BEFORE S7 (so
  // lines refresh sees the repaired starters/lineups/weather). Repair
  // delegates to existing safe helpers (BDL backfill, season-pitching,
  // lineup refresh, weather refresh) — NEVER writes predictions,
  // slate_status, locked_at, tracking, or model_version.
  | "s5_5_readiness_audit"
  | "s5_6_readiness_repair"
  | "s5_7_readiness_reaudit"
  | "s7_lines_v2_refresh"
  // Push 2 — slate-driven coverage audit + recovery. Runs after S7
  // to fill gaps where /opportunities/ev discovery missed an
  // expected game but /odds has it (e.g., SF@CHC + TB@MIA on
  // 2026-06-06). NEVER touches predictions.
  | "s7b_market_coverage_audit"
  | "s8_sharp_signals_refresh"
  | "g1_automation_gate"  // R-17 G1 — distinct from R-19 G1; legacy name kept
  | "m1_starter_refresh_final"
  | "g2_starter_coverage"
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
  /**
   * R-19 Phase 5d — true when the cron caller opted into intraday
   * mode via `?intraday=true` or `SLATE_CYCLE_INTRADAY_MODE=true` env.
   * When true: G3 (in-progress ingest) is a per-game exclusion, not
   * a slate-wide block; affected external_ids feed M2's exclusion
   * list. When false (morning default): G3 fail_closed aborts the
   * whole run (correct for late-fired morning cron).
   */
  intraday_mode: boolean;
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
  /**
   * R-19 Phase 5e — true when intraday mode was on AND provider date
   * alignment was fail_closed. In that case, the orchestrator demotes
   * the alignment status to "warn" before passing it to the R-17 G1
   * gate (so /opportunities/ev natural shrinkage doesn't block M2
   * slate-wide). This flag stays true on the top-level report so the
   * publish gate keeps auto-publish held even though G1 no longer
   * cascades to fail_closed. The original alignment status is preserved
   * on `provider_date_alignment.status` above. Always false in morning
   * mode regardless of alignment status — there, fail_closed cascades
   * to G1 fail_closed → blockingReasons → publish skipped_blocked.
   */
  intraday_alignment_degraded: boolean;
  /**
   * R-19 Phase 4a — slate-safety gate verdicts. Each is null when the
   * gate didn't run (e.g. P2.5 errored before BDL data was available
   * for G1/G3; G2 fires only after M1). When non-null, the verdict's
   * `status` drives blocking_reasons and the publish gate.
   */
  slate_safety_gates: {
    g1_minimum_game_count: MinimumGameCountResult | null;
    g2_starter_coverage: StarterCoverageResult | null;
    g3_in_progress_ingest: InProgressGamesResult | null;
  };
  /**
   * R-19 Phase 4b — per-game lock-state snapshot for the slate. Null
   * when the snapshot couldn't be built (slate not yet in DB or query
   * error). Informational: the slate-cycle orchestrator does NOT set
   * locked_at itself — `/api/cron/pregame-sweep` owns that transition.
   * M2 already respects locks via `respectLocks: true` (automodelService
   * default), so the snapshot tells operators WHAT was skipped and WHY
   * without changing behavior.
   */
  slate_lock_snapshot: SlateLockSnapshotResult | null;
  /**
   * R-19 Phase 4b (revised) — structured lock warnings derived from
   * the snapshot + env state. Each carries a code, severity, and
   * affected_count. A `lock_miss` (severity:block) is the launch-safety
   * critical case: games whose game_date is in the past with
   * locked_at = null. Pregame-sweep didn't fire; M2 must not run on
   * them. `lock_miss` warnings also push to `blocking_reasons` and
   * force m2 blocked. Warn-severity entries push to `warnings[]` only.
   */
  slate_lock_warnings: LockWarning[];
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
  /**
   * R-19 Phase 5d — when true, G3 (in-progress ingest) is downgraded
   * from slate-wide block to per-game exclusion. The affected
   * external_ids are union'd with lock_miss exclusions and fed to
   * M2's `excludeGameExternalIds` filter. Auto-publish still blocks
   * (so user-facing slate stays held), but the rest of the slate
   * keeps refreshing/predicting for future games. Default `false`
   * preserves the morning-run safety: G3 catches "cron fired too
   * late" and aborts the whole run.
   *
   * The route resolves this from `?intraday=true` query OR
   * `SLATE_CYCLE_INTRADAY_MODE=true` env via `isIntradayMode()`.
   */
  intradayMode?: boolean;
}): Promise<AutomationRunReport> {
  const env = opts.env ?? process.env;
  const orchestratorGate = isOrchestratorGateEnabled(env);
  const perStepGates = readPerStepGates(env);
  const intradayMode = opts.intradayMode === true;
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
  // R-19 Phase 4a — slate-safety gate verdicts. G1/G3 evaluate
  // immediately after P2.5 (BDL data in hand); G2 runs late, after M1.
  let g1Result: MinimumGameCountResult | null = null;
  let g2Result: StarterCoverageResult | null = null;
  let g3Result: InProgressGamesResult | null = null;
  // Holder for the raw BDL game payload — hoisted so G1/G3 can read
  // status + external_id after the reconciliation try block.
  let bdlGamesForGates: Array<{
    status?: string | null;
    external_id?: number | null;
  }> = [];
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
      // Capture the raw payload for G1/G3 evaluation after the
      // reconciliation push below. Includes `status` field per BDL
      // contract; SlateGameRecord exposes external_id and status.
      bdlGamesForGates = bdlGames.map((g) => ({
        status: (g as { status?: string | null }).status ?? null,
        external_id: (g as { external_id?: number | null }).external_id ?? null,
      }));

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

  // ── R-19 Phase 4a — G1. Minimum game count ───────────────────────────
  // Fires once BDL data is available. fail_closed → blocks all downstream
  // writes (cascades into dataLayerBlocked) AND auto-publish.
  const t0g1 = Date.now();
  if (bdlGameCount !== null) {
    g1Result = assessMinimumGameCount({
      sport: opts.sport,
      bdlGameCount,
    });
    steps.push({
      name: "g1_minimum_game_count",
      mode: g1Result.status === "fail_closed" ? "blocked" : "dry_run",
      duration_ms: Date.now() - t0g1,
      reason: g1Result.reason,
      details: {
        status: g1Result.status,
        threshold: g1Result.threshold,
        observed: g1Result.observed,
      },
    });
    if (g1Result.status === "fail_closed") {
      blockingReasons.push(`G1 minimum game count fail_closed: ${g1Result.reason}`);
    }
  } else {
    steps.push({
      name: "g1_minimum_game_count",
      mode: "skipped",
      duration_ms: Date.now() - t0g1,
      reason: "BDL game count unavailable (P2.5 errored or SHARPAPI_KEY missing)",
    });
  }

  // ── R-19 Phase 4a — G3. In-progress ingest ───────────────────────────
  // Fires once BDL data is available. fail_closed → blocks all downstream
  // writes (cascades into dataLayerBlocked) AND auto-publish. STATUS_
  // POSTPONED games are deliberately NOT counted as in-progress.
  const t0g3 = Date.now();
  if (bdlGamesForGates.length > 0) {
    g3Result = assessInProgressGames({
      sport: opts.sport,
      bdlGames: bdlGamesForGates,
    });
    // R-19 Phase 5d — In intraday mode, a fail_closed G3 result is
    // a per-game exclusion rather than a slate-wide block. The step
    // is shown as "dry_run" instead of "blocked" so operators see
    // that data continued to flow; the affected_external_ids feed
    // the per-game exclusion list, and the structured warning still
    // surfaces in the report.
    const g3StepMode: StepMode =
      g3Result.status === "fail_closed"
        ? (intradayMode ? "dry_run" : "blocked")
        : "dry_run";
    steps.push({
      name: "g3_in_progress_ingest",
      mode: g3StepMode,
      duration_ms: Date.now() - t0g3,
      reason: g3Result.reason,
      details: {
        status: g3Result.status,
        total_games: g3Result.totalGames,
        in_progress_count: g3Result.inProgressCount,
        affected_external_ids: g3Result.affectedExternalIds,
        intraday_mode: intradayMode,
      },
    });
    if (g3Result.status === "fail_closed") {
      if (intradayMode) {
        // Intraday: degrade to warning. Auto-publish still gates on
        // g3Blocking below (same pattern as lock_miss in Phase 5c).
        warnings.push(
          `R-19 Phase 5d intraday G3 exclusion: ${g3Result.inProgressCount} game(s) ` +
          `in progress per BDL; excluding from M2; future/unlocked games continue.`
        );
      } else {
        // Morning: slate-wide block (existing safety for late-fired cron).
        blockingReasons.push(`G3 in-progress ingest fail_closed: ${g3Result.reason}`);
      }
    }
  } else {
    steps.push({
      name: "g3_in_progress_ingest",
      mode: "skipped",
      duration_ms: Date.now() - t0g3,
      reason: "BDL game payload unavailable (P2.5 errored or SHARPAPI_KEY missing)",
    });
  }

  // dataLayerBlocked: G1 (minimum game count) ALWAYS cascades because
  // it's a structural problem with the slate. G3 (in-progress ingest)
  // cascades ONLY in morning mode — in intraday it becomes per-game.
  const g1Blocking = g1Result !== null && g1Result.status === "fail_closed";
  const g3Blocking = g3Result !== null && g3Result.status === "fail_closed";
  const g3SlateWideBlocking = g3Blocking && !intradayMode;
  // Retained for the top-level report shape (back-compat with the cron
  // route's response envelope) and for the m2Blocked composite below.
  // The per-step `effectiveWriteMode` map is now computed via V2 from
  // `providerHealth`, NOT from this single boolean — see Phase 6B.31c.
  const dataLayerBlocked =
    providerModeBlocking || reconciliationBlocking || g1Blocking || g3SlateWideBlocking;

  // ── Phase 6B.31c — Per-step provider-dependency gates ───────────────
  //
  // Each upstream gate signals a SPECIFIC provider's health. Steps then
  // consult only the providers they actually depend on. This stops
  // SharpAPI EV scarcity (a natural pattern outside morning windows)
  // from falsely blocking MLB-Stats-only steps like S5 season-pitching
  // and S6 first-inning refresh.
  //
  // Mapping rationale (each line = one gate → one provider signal):
  //   • reconciliationBlocking — `/opportunities/ev`-based gate; signals
  //     `sharpapi_ev_opportunities` only. Affects S8 sharp-signals
  //     (which actually consume EV data) but NOT S5/S6/S7.
  //   • g1Blocking / g3SlateWideBlocking — BDL-based gates; signal
  //     `bdl_slate`. Affects S1/S3/S4/M2 etc., but NOT S5/S6 (which
  //     consume MLB Stats only). If BDL truly has no games today, S5/S6
  //     will trivially find 0 starters to act on — no false write.
  //   • providerModeBlocking — master cross-cutting concern: if any
  //     required provider is in mock mode, NO write step should fire.
  //     Passed as `masterProviderBlock` to V2 (kills all writes).
  //
  // NOTE: there is no pre-flight gate for `sharpapi_odds_lines` today.
  // S7 lines refresh "self-canaries" — if /odds returns empty, it
  // writes 0 rows. A future canary can populate that field; for now
  // it stays `ok` and the step's own error counter is the signal.
  const providerHealth: ProviderHealth = defaultProviderHealth();
  if (reconciliationBlocking) {
    providerHealth.sharpapi_ev_opportunities = "fail_closed";
  }
  if (g1Blocking || g3SlateWideBlocking) {
    providerHealth.bdl_slate = "fail_closed";
  }

  const effectiveWriteMode = {} as Record<PerStepKey, boolean>;
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    effectiveWriteMode[k] = computeEffectiveWriteModeV2({
      orchestratorGate,
      perStepGate: perStepGates[k],
      masterProviderBlock: providerModeBlocking,
      stepDependencies: STEP_PROVIDER_DEPS[k],
      providerHealth,
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

  // ── S6. First-inning splits refresh (Phase 6B.31b) ───────────────────
  //
  // Refreshes player_season_stats.first_inning_* for every slate
  // probable starter via MLB Stats API `statSplits&sitCodes=i01`.
  // Writer is scoped to first_inning_* columns only — pitching_* and
  // batting_* are NEVER included in the payload (defense-in-depth in
  // firstInningStatsWriter + nulled-cleanup guard). Per-pitcher
  // failures are isolated in the helper and counted; the step
  // surfaces aggregate counts but never throws (the runStep catch
  // is a defensive backstop).
  steps.push(await runStep("s6_first_inning_refresh", effectiveWriteMode.first_inning, "first_inning", async (writeMode) => {
    const res = await runFirstInningCycle({
      sport: opts.sport,
      slateDate: opts.date,
      writeMode,
      log: () => undefined,
    });
    return {
      details: {
        status: res.status,
        planned_writes: res.planned_writes,
        rows_written: res.rows_written,
        rows_dry_run: res.rows_dry_run,
        skipped_nulled: res.skipped_nulled,
        skipped_missing_dob: res.skipped_missing_dob,
        errors: res.errors,
        mlb_api_calls: res.mlb_api_calls,
      },
      reason: firstInningReasonFromStatus(res.status, res, writeMode),
    };
  }));

  // ── S5.5 — Model readiness audit (read-only) ─────────────────────────
  //
  // Push 3B-6 — pre-model-generation guardrail. Inspects whether every
  // expected MLB game has the data needed for full-game V2.2 and FI V2
  // (starter assignment, season stats, lineups, FI/full-game market,
  // weather, park factor). NEVER writes. Surfaces per-game blockers
  // for the orchestrator report and feeds S5.6.
  let readinessAuditPre = await auditMlbModelReadiness({
    sport: opts.sport,
    date: opts.date,
  });
  steps.push(await runStep("s5_5_readiness_audit", false, "readiness", async () => {
    return {
      details: {
        games_total: readinessAuditPre.games_total,
        v22_ready: readinessAuditPre.v22_ready_count,
        fi_v2_ready: readinessAuditPre.fi_v2_ready_count,
        blocker_counts: readinessAuditPre.blocker_counts,
        pitchers_needing_stats_count: readinessAuditPre.pitchers_needing_stats.length,
      },
      reason: readinessAuditPre.games_total === 0
        ? "no slate"
        : `${readinessAuditPre.v22_ready_count}/${readinessAuditPre.games_total} V2.2-ready, ${readinessAuditPre.fi_v2_ready_count}/${readinessAuditPre.games_total} FI-V2-ready (read-only audit)`,
    };
  }));

  // ── S5.6 — Model readiness repair ───────────────────────────────────
  //
  // Push 3B-6 — gated by readiness per-step env + automodel env. Calls
  // existing safe helpers (BDL backfill, season-pitching, lineup,
  // weather) in order to fill the gaps identified in S5.5. NEVER
  // writes predictions, slate_status, locks, tracking, or model
  // version fields.
  steps.push(await runStep("s5_6_readiness_repair", effectiveWriteMode.readiness && effectiveWriteMode.automodel, "readiness", async (writeMode) => {
    const playerStatsProviderReal = process.env.PLAYER_STATS_PROVIDER === "real_api";
    const weatherProviderReal = process.env.WEATHER_PROVIDER === "real_api";
    const bdlWritesEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
    const r = await repairMlbModelReadiness({
      sport: opts.sport,
      date: opts.date,
      writeMode,
      providerGuards: { playerStatsProviderReal, weatherProviderReal, bdlWritesEnabled },
      audit: readinessAuditPre,
    });
    return {
      details: {
        write_mode: r.write_mode,
        reasons: r.reasons,
        bdl_linked: r.steps.bdl_players.linked ?? 0,
        bdl_created: r.steps.bdl_players.created ?? 0,
        pitcher_rows_written: r.steps.season_pitching.rows_written ?? 0,
        lineup_records_updated: r.steps.lineup.records_updated ?? 0,
        weather_records_updated: r.steps.weather.records_updated ?? 0,
      },
      reason: writeMode
        ? `repaired (${r.reasons.join(", ")})`
        : `dry-run; would attempt ${r.reasons.join(", ")}`,
    };
  }));

  // ── S5.7 — Model readiness re-audit (read-only) ─────────────────────
  //
  // Confirms the repair closed the gaps. If the residual blockers
  // exist they're surfaced here so the operator/G1 gate can hold the
  // affected game/market without blocking the whole slate.
  const readinessAuditPost = await auditMlbModelReadiness({
    sport: opts.sport,
    date: opts.date,
  });
  steps.push(await runStep("s5_7_readiness_reaudit", false, "readiness", async () => {
    const v22Delta = readinessAuditPost.v22_ready_count - readinessAuditPre.v22_ready_count;
    const fiDelta = readinessAuditPost.fi_v2_ready_count - readinessAuditPre.fi_v2_ready_count;
    return {
      details: {
        games_total: readinessAuditPost.games_total,
        v22_ready: readinessAuditPost.v22_ready_count,
        fi_v2_ready: readinessAuditPost.fi_v2_ready_count,
        v22_ready_delta: v22Delta,
        fi_v2_ready_delta: fiDelta,
        blocker_counts: readinessAuditPost.blocker_counts,
        residual_blocked_games: readinessAuditPost.per_game
          .filter((p) => !p.v22_ready)
          .map((p) => ({ matchup: p.matchup, external_id: p.external_id, blockers: p.blockers })),
      },
      reason: readinessAuditPost.games_total === 0
        ? "no slate"
        : `${readinessAuditPost.v22_ready_count}/${readinessAuditPost.games_total} V2.2-ready (Δ${v22Delta >= 0 ? "+" : ""}${v22Delta}), ${readinessAuditPost.fi_v2_ready_count}/${readinessAuditPost.games_total} FI-V2-ready (Δ${fiDelta >= 0 ? "+" : ""}${fiDelta})`,
    };
  }));
  // Update the closure ref so subsequent S7+ steps can see the
  // post-repair state if they need it.
  readinessAuditPre = readinessAuditPost;

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

  // ── S7B. Push 2 — Slate-driven market coverage audit + recovery ──────
  //
  // Runs immediately after the primary V2 lines refresh. For every
  // expected game that ended the S7 step with a missing market (ML or
  // Total), this step constructs candidate SharpAPI event_ids and
  // probes /odds directly. Recovered rows pass the same row-level
  // filters (mapMarketType, mapSportsbook, mapSide, alternate-line
  // drop, R-16G-A wrong-game guard) and are dedupe-inserted into the
  // `lines` table. NEVER touches predictions, slate_status, or
  // locked_at.
  //
  // Read-only when effectiveWriteMode.lines === false. Per-step env
  // override (SHARP_LINES_RECOVERY_DB_WRITES_ENABLED) is NOT consulted
  // here because we want recovery to follow the same write-mode as the
  // primary lines step — turning on lines writes implies turning on
  // gap-filling. Operator can disable recovery in a deploy emergency
  // by reverting this commit; lines V2 still runs.
  steps.push(await runStep("s7b_market_coverage_audit", effectiveWriteMode.lines, "lines", async (writeMode) => {
    try {
      const audit = await auditMarketCoverage({
        sport: opts.sport,
        date: opts.date,
        apply: writeMode,
        supabase: supabaseClient,
      });
      const a = audit.aggregate;
      const reason = writeMode
        ? `recovered=${a.recoveredCount} games; inserted=${a.rowsInserted} rows; ml_after=${a.mlAfterRecoveryCoverage}/${a.expectedGames}; total_after=${a.totalAfterRecoveryCoverage}/${a.expectedGames}; provider_true_missing=${a.providerTrueMissing}`
        : `dry-run; would recover ${a.recoveredCount} games; would insert ${a.rowsInserted} rows; ml_after=${a.mlAfterRecoveryCoverage}/${a.expectedGames}; total_after=${a.totalAfterRecoveryCoverage}/${a.expectedGames}`;
      if (a.providerHasDataDbMissing > 0) {
        warnings.push(
          `S7B: ${a.providerHasDataDbMissing} markets had provider data but DB was missing — recovery ${writeMode ? "wrote" : "would write"} ${a.rowsInserted} rows`,
        );
      }
      if (a.rejectedWrongGameCount > 0) {
        warnings.push(
          `S7B: wrong-game guard rejected ${a.rejectedWrongGameCount} candidate row(s) — no cross-game contamination`,
        );
      }
      return {
        details: {
          expected_games: a.expectedGames,
          ml_db_coverage: a.mlDbCoverage,
          ml_after_recovery: a.mlAfterRecoveryCoverage,
          total_db_coverage: a.totalDbCoverage,
          total_after_recovery: a.totalAfterRecoveryCoverage,
          spread_db_coverage: a.spreadDbCoverage,
          fi_db_coverage: a.fiDbCoverage,
          provider_has_data_db_missing: a.providerHasDataDbMissing,
          provider_true_missing: a.providerTrueMissing,
          recovered_count: a.recoveredCount,
          wrong_game_rejected: a.rejectedWrongGameCount,
          parser_drop: a.parserDropCount,
          provider_error: a.providerErrorCount,
          rate_limited: a.rateLimitCount,
          rows_inserted: a.rowsInserted,
          rows_skipped_duplicate: a.rowsSkippedDuplicate,
        },
        reason,
      };
    } catch (e) {
      // Audit failure should never block the slate-cycle — log the
      // warning and continue. The primary lines refresh at S7 already
      // succeeded; predictions can still run.
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`S7B audit failed (non-fatal): ${msg}`);
      return {
        details: { error: msg },
        reason: `audit failed (non-fatal): ${msg}`,
      };
    }
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
  // R-19 Phase 5e — Intraday-aware alignment cascade. In intraday mode,
  // SharpAPI /opportunities/ev shrinks naturally as games complete and as
  // markets tighten — the alignment canary at the slate level fires
  // false-positively. Demote fail_closed → "warn" before passing to the
  // R-17 G1 gate so a single slate-level signal doesn't block M2 for
  // every eligible future game. The underlying alignment status still
  // surfaces on the top-level `provider_date_alignment` field of the
  // report, AND `intraday_alignment_degraded` is set so the publish gate
  // can keep auto-publish held. P2.5 reconciliation, R-17 G1 per-game
  // stale-line / coverage checks, and Phase 5c/5d per-game exclusions
  // all remain strict.
  const intradayAlignmentDegraded = shouldDemoteAlignmentForGate({
    intradayMode,
    alignmentStatus: alignment?.status ?? null,
  });
  const alignmentForGate: ProviderDateAlignmentReport | null =
    intradayAlignmentDegraded && alignment !== null
      ? { ...alignment, status: "warn" }
      : alignment;
  if (intradayAlignmentDegraded) {
    warnings.push(
      `R-19 Phase 5e intraday alignment soften: alignment.status=fail_closed ` +
        `(matched=${alignment?.matched}, threshold=${alignment?.threshold}, ` +
        `slate_size=${alignment?.slate_size}) demoted to "warn" before R-17 G1; ` +
        `publish stays held; per-game checks remain strict`
    );
  }

  const t0g = Date.now();
  let g1Report: AutomationGateReport | null = null;
  try {
    g1Report = await assessAutomationGate(opts.sport, opts.date, {
      providerAlignment: alignmentForGate,
    });
    steps.push({
      name: "g1_automation_gate",
      mode: g1Report.overall === "fail_closed" ? "blocked" : "dry_run",
      duration_ms: Date.now() - t0g,
      reason: `overall=${g1Report.overall}`,
      details: {
        overall: g1Report.overall,
        reasons: g1Report.reasons,
        intraday_alignment_demoted: intradayAlignmentDegraded,
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

  // ── R-19 Phase 4a — G2. Starter coverage (post-M1) ───────────────────
  // Now that S3 + M1 have run (in write or dry-run mode), query the
  // games table for the slate and check starter coverage. In pure
  // dry-run with an empty slate, the helper returns "deferred" — the
  // gate doesn't fail and doesn't pass, it just notes that there's
  // no DB state to evaluate yet.
  //
  // R-19 Phase 4b — the same query is reused to build the lock-state
  // snapshot. Pull external_id + game_date + the joined
  // game_predictions.locked_at so we can run BOTH the G2 helper and
  // assessSlateLockSnapshot on one query result.
  const t0g2 = Date.now();
  type SlateRow = {
    external_id: number;
    game_date: string | null;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
    home_team: { abbreviation: string } | null;
    away_team: { abbreviation: string } | null;
    game_predictions: { locked_at: string | null }[] | null;
  };
  let slateRows: SlateRow[] = [];
  try {
    const { data } = await supabase
      .from("games")
      .select(
        "external_id, game_date, home_pitcher_id, away_pitcher_id, " +
        "home_team:home_team_id ( abbreviation ), " +
        "away_team:away_team_id ( abbreviation ), " +
        "game_predictions ( locked_at )"
      )
      .eq("sport", opts.sport)
      .eq("slate_date", opts.date);
    slateRows = (data ?? []) as unknown as SlateRow[];
    g2Result = assessStarterCoverage({
      sport: opts.sport,
      games: slateRows.map((r) => ({
        external_id: r.external_id,
        home_pitcher_id: r.home_pitcher_id,
        away_pitcher_id: r.away_pitcher_id,
      })),
    });
    // R-19 Phase 5g.4 — G2 step mode reflects the new tri-state
    // semantics. "fail_closed" is now reserved for catastrophic coverage
    // (below 50% OR ≥3 games missing both starters). "partial_ok" is
    // the new per-game-exclusion path — gate did its job by tagging the
    // missing-starter games but the slate as a whole still ran. Both
    // "ok" and "partial_ok" report as "dry_run" (the gate doesn't write
    // anything — informational only).
    let g2Mode: StepMode;
    if (g2Result.status === "fail_closed") g2Mode = "blocked";
    else if (g2Result.status === "deferred") g2Mode = "skipped";
    else g2Mode = "dry_run";
    steps.push({
      name: "g2_starter_coverage",
      mode: g2Mode,
      duration_ms: Date.now() - t0g2,
      reason: g2Result.reason,
      details: {
        status: g2Result.status,
        total_games: g2Result.totalGames,
        games_with_both_starters: g2Result.gamesWithBothStarters,
        games_missing_one: g2Result.gamesMissingOne,
        games_missing_both: g2Result.gamesMissingBoth,
        coverage_pct: g2Result.coveragePct,
        threshold: g2Result.threshold,
        catastrophic_threshold_pct: g2Result.catastrophicThreshold,
        catastrophic_missing_both_threshold: g2Result.catastrophicMissingBothThreshold,
        starter_warning_external_ids: g2Result.starter_warning_external_ids,
        m2_excluded_external_ids: g2Result.m2_excluded_external_ids,
        held_reasons: g2Result.held_reasons,
      },
    });
    if (g2Result.status === "fail_closed") {
      blockingReasons.push(`G2 starter coverage fail_closed (catastrophic): ${g2Result.reason}`);
    } else if (g2Result.status === "partial_ok") {
      // Phase 6B.30C — per-game policy split. Warning list flags every
      // missing-starter game for operator visibility; M2 exclusion only
      // applies to missing-both games. Surface both counts so operators
      // see what was warned vs what was actually excluded from M2.
      warnings.push(
        `G2 starter coverage partial_ok: ${g2Result.starter_warning_external_ids.length} ` +
        `warning(s), ${g2Result.m2_excluded_external_ids.length} M2 exclusion(s) — ` +
        `${g2Result.reason}`
      );
    } else if (g2Result.status === "deferred") {
      warnings.push(
        `G2 starter coverage deferred — slate not yet in DB; gate will re-evaluate on next run after S1 has written`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`G2 starter coverage query failed: ${msg}`);
    steps.push({
      name: "g2_starter_coverage",
      mode: "failed",
      duration_ms: Date.now() - t0g2,
      reason: msg,
      error_message: msg,
    });
  }
  const g2Blocking = g2Result !== null && g2Result.status === "fail_closed";

  // ── R-19 Phase 4b — Slate lock snapshot ──────────────────────────────
  // Build the lock-state snapshot from the same `slateRows` payload G2
  // just used. INFORMATIONAL ONLY — the snapshot does NOT block any
  // step. The actual lock guarantees flow through:
  //   • automodelService(respectLocks=true) → Layer 2 filter excludes
  //     locked games from snapshot/model
  //   • ingestScoresModel Layer 1 guard → rejects writes to locked rows
  //   • /api/cron/pregame-sweep → owns the entering_lock → locked
  //     transition (sets locked_at = NOW())
  //
  // The orchestrator never sets locked_at itself; this separation
  // keeps slate-cycle and pregame-sweep single-purpose.
  let lockSnapshot: SlateLockSnapshotResult | null = null;
  if (slateRows.length > 0) {
    lockSnapshot = assessSlateLockSnapshot({
      sport: opts.sport,
      now: startedAt,
      games: slateRows.map((r) => {
        const lockedAt = r.game_predictions?.[0]?.locked_at ?? null;
        const home = r.home_team?.abbreviation ?? "";
        const away = r.away_team?.abbreviation ?? "";
        const matchup =
          home !== "" && away !== "" ? `${away}@${home}` : null;
        return {
          game_external_id: r.external_id,
          game_date: r.game_date,
          locked_at: lockedAt,
          matchup,
        };
      }),
    });
  }

  // ── R-19 Phase 4b (revised) — Lock warning derivation ────────────────
  // The snapshot answers "what's the lock state?". This step answers
  // "is the lock state safe for unattended automation?". Three codes:
  //
  //   • lock_miss — already_started > 0 AND already_locked === 0. Games
  //     started without ever being locked → pregame-sweep didn't fire.
  //     Severity: BLOCK. M2 must not run; the cron is operating on a
  //     stale slate.
  //   • entering_lock_no_transition — games inside T-60 but slate-cycle
  //     doesn't flip locked_at. Severity: WARN. Operators need to know
  //     pregame-sweep is the only path that performs the transition.
  //   • pregame_sweep_not_active — PREGAME_SWEEP_CRON_ACTIVE env flag is
  //     not "true". Until the operator schedules pregame-sweep AND
  //     flips this flag, no game's locked_at ever transitions from
  //     null → set. Severity: WARN.
  const lockWarnings = deriveLockWarnings({
    snapshot: lockSnapshot,
    env: env as { PREGAME_SWEEP_CRON_ACTIVE?: string | undefined },
  });
  // Push warn-severity messages to the existing warnings[] surface.
  for (const w of lockWarnings) {
    if (w.severity === "warn") warnings.push(w.message);
  }
  // R-19 Phase 5c — lock_miss is now a PER-GAME exclusion rather
  // than a slate-wide M2 block. The block-severity warning still
  // fires (it's the safety signal an operator needs to see), but the
  // orchestrator handles it by:
  //   (1) pulling the affected games out of M2's input via
  //       excludeGameExternalIds (computed below).
  //   (2) gating the publish step on lockMissBlocking — auto-publish
  //       stays held when any game was excluded, even if the rest of
  //       the slate processed cleanly.
  //   (3) surfacing the block-severity warning message as a degraded
  //       warning so operators see it, but NOT pushing it into
  //       blocking_reasons (which would cascade and shut M2 down
  //       entirely).
  const lockMissBlocking = anyLockWarningBlocks(lockWarnings);
  if (lockMissBlocking) {
    for (const w of lockWarnings) {
      if (w.severity === "block") {
        warnings.push(`R-19 Phase 5c lock_miss exclusion: ${w.message}`);
      }
    }
  }
  // Per-game exclusion list — fed to M2's generatePredictionsForSlate.
  // Empty when snapshot is null (slate not in DB) or no already_started
  // games exist (the healthy state).
  const lockMissExclusions = extractLockMissExclusions(lockSnapshot);
  // R-19 Phase 5d — intraday G3 exclusions. In morning mode this is
  // always empty (G3 fail_closed cascades into dataLayerBlocked
  // instead). In intraday mode, G3.affectedExternalIds becomes a
  // per-game exclusion that's union'd with lock_miss below.
  const g3IntradayExclusions: number[] =
    intradayMode && g3Result !== null && g3Result.status === "fail_closed"
      ? [...g3Result.affectedExternalIds]
      : [];
  // Phase 6B.30C — G2 M2 exclusions use the policy-split
  // `m2_excluded_external_ids` (NOT the warning list). Policy:
  //   • status="ok" with single-side-missing starter → warning only;
  //     V2.2 emits real-data fallback prediction (data_quality_tier="
  //     fallback", provisional=true, Best Angle gated).
  //   • status="ok"/"partial_ok" with missing_both → excluded; V2.2
  //     has no fallback for zero starter info; 6B.30A surfaces a
  //     pending card customer-side.
  //   • status="fail_closed" (catastrophic) → all warned games
  //     excluded as defense-in-depth; m2Blocked cascade also hard-blocks
  //     M2 entirely at the orchestrator step.
  //   • status="deferred" → empty (no games in DB yet).
  // Empty list when G2 errored.
  const g2Exclusions: number[] =
    g2Result !== null && g2Result.status !== "deferred"
      ? [...g2Result.m2_excluded_external_ids]
      : [];
  // Combined per-game exclusion set passed to M2. Union of:
  //   • lock_miss (snapshot.already_started + null locked_at)
  //   • intraday G3 (BDL says STATUS_IN_PROGRESS / STATUS_FINAL)
  //   • G2 starter coverage (any game missing ≥1 starter)
  // Sorted ascending for deterministic operator-log output.
  const m2ExclusionSet = new Set<number>([
    ...lockMissExclusions,
    ...g3IntradayExclusions,
    ...g2Exclusions,
  ]);
  const combinedM2Exclusions = [...m2ExclusionSet].sort((a, b) => a - b);

  // ── M2. Automodel + reviewer + breakdown ──────────────────────────────
  // m2Blocked covers structural problems that affect the WHOLE slate:
  //   • gateBlocking — R-17 G1 automation gate (lines stale, FI coverage)
  //   • dataLayerBlocked — provider mode, reconciliation, R-19 G1 (min
  //     game count), R-19 G3 (in-progress ingest)
  //   • g2Blocking — R-19 G2 starter coverage too low
  //
  // R-19 Phase 5c — lock_miss is NO LONGER a slate-wide M2 block. It
  // becomes a PER-GAME exclusion: the affected external_ids flow into
  // generatePredictionsForSlate as `excludeGameExternalIds`. M2 runs
  // for the remaining eligible games. Auto-publish stays held (handled
  // separately in S11).
  //
  // If lockMissExclusions covers EVERY game on the slate (no eligible
  // games remain), M2 still runs but writes 0 predictions; the report
  // makes the situation visible via `excluded_for_lock_miss` count
  // matching `lock_snapshot.total_games`.
  //
  // Lock awareness: generatePredictionsForSlate uses respectLocks=true
  // (Phase 4.2.B) — locked games excluded via DB query. Union'd with
  // the caller-supplied `excludeGameExternalIds` set so both flavors
  // of exclusion flow through the same filter pipeline.
  // Phase 6B.31c — narrower m2Blocked composite. The provider-dependency
  // checks (sharpapi_odds_lines, mlb_stats, bdl_slate, providerMode) are
  // already enforced via effectiveWriteMode.automodel (V2 path). What's
  // left here are MODEL-SPECIFIC gates that V2 doesn't know about:
  //   • gateBlocking  — R-17 automation gate (per-game stale lines,
  //                     missing ML/total/starter coverage)
  //   • g2Blocking    — R-19 G2 (starter coverage too low to model)
  // Notably NOT included: reconciliationBlocking (EV-based, doesn't
  // affect model). Provider-mode / G1 / G3 are inherited from V2 via
  // effectiveWriteMode.automodel, no double-counting needed.
  const m2Blocked = gateBlocking || g2Blocking;
  steps.push(await runStep(
    "m2_automodel",
    !m2Blocked && effectiveWriteMode.automodel,
    "automodel",
    async (writeMode) => {
      const res = await generatePredictionsForSlate(opts.sport, opts.date, "morning_draft", {
        writeToDb: writeMode,
        excludeGameExternalIds: combinedM2Exclusions,
      });
      // R-19 Phase 4b — report lock-skipped counts alongside model output.
      // `lock_skipped_by_layer_2` = games excluded by automodelService's
      // respectLocks filter (i.e. already_locked games).
      // R-19 Phase 5c — `excluded_for_lock_miss` is the per-game
      // lock_miss exclusion list applied this run.
      // R-19 Phase 5d — `excluded_for_g3_intraday` is the per-game
      // in-progress exclusion (intraday mode only).
      const lockSkippedByLayer2 = lockSnapshot?.already_locked_games ?? 0;
      const excludedForLockMissCount = lockMissExclusions.length;
      const excludedForG3IntradayCount = g3IntradayExclusions.length;
      const excludedForG2Count = g2Exclusions.length;
      const totalExclusions = combinedM2Exclusions.length;
      return {
        details: {
          game_count: res.game_count,
          held_count: res.held_count,
          pick_null_counts: res.pick_null_counts,
          errors: res.errors.length,
          excluded_for_lock_miss: excludedForLockMissCount,
          excluded_for_lock_miss_external_ids: lockMissExclusions,
          excluded_for_g3_intraday: excludedForG3IntradayCount,
          excluded_for_g3_intraday_external_ids: g3IntradayExclusions,
          excluded_for_g2_starter_coverage: excludedForG2Count,
          excluded_for_g2_starter_coverage_external_ids: g2Exclusions,
          // Phase 6B.30C — policy-split visibility. Warning list is the
          // full set of games flagged for missing starters (all sides);
          // m2-excluded is the subset actually filtered out from M2 (only
          // missing_both under non-catastrophic status). Operators
          // reading this see exactly what was flagged vs what was held.
          g2_starter_warning_count:
            g2Result?.starter_warning_external_ids.length ?? 0,
          g2_starter_warning_external_ids:
            g2Result?.starter_warning_external_ids ?? [],
          g2_held_reasons: g2Result?.held_reasons ?? {},
          total_per_game_exclusions: totalExclusions,
          combined_exclusion_external_ids: combinedM2Exclusions,
          intraday_mode: intradayMode,
          lock_snapshot: lockSnapshot !== null ? {
            total_games: lockSnapshot.total_games,
            unlocked_games: lockSnapshot.unlocked_games,
            would_lock_games: lockSnapshot.would_lock_games,
            already_locked_games: lockSnapshot.already_locked_games,
            already_started_games: lockSnapshot.already_started_games,
            effectively_locked_count: lockSnapshot.effectively_locked_count,
            lock_skipped_by_layer_2: lockSkippedByLayer2,
          } : null,
        },
        reason: writeMode
          ? `wrote ${res.predictions.length} prediction(s); held=${res.held_count}; lock_skipped_layer2=${lockSkippedByLayer2}; excluded_for_lock_miss=${excludedForLockMissCount}; excluded_for_g3_intraday=${excludedForG3IntradayCount}; excluded_for_g2=${excludedForG2Count}`
          : `dry-run; would write ${res.predictions.length} prediction(s); held=${res.held_count}; lock_skipped_layer2=${lockSkippedByLayer2}; excluded_for_lock_miss=${excludedForLockMissCount}; excluded_for_g3_intraday=${excludedForG3IntradayCount}; excluded_for_g2=${excludedForG2Count}`,
      };
    },
    m2Blocked
      ? "blocked by upstream gate (provider/reconciliation/R-17 G1/R-19 G1-G2-G3)"
      : undefined
  ));

  // ── S11. Publish gate ────────────────────────────────────────────────
  // R-19 Phase 1 (C4) — HOLD-as-draft default. Auto-publish only when
  // MORNING_SLATE_AUTO_PUBLISH=true is explicitly set. Even if set, an
  // upstream block still skips publish.
  // R-19 Phase 4a — `anyGateFailedClosed(G1, G2, G3)` is the explicit
  // safety check that prevents auto-publish from firing on a slate
  // with too few games, missing starters, or already-in-progress
  // games. Belt-and-braces: dataLayerBlocked already cascades G1/G3,
  // gateBlocking covers R-17 G1, and we add G2 here so a late-firing
  // starter-coverage failure also blocks publish.
  // R-19 Phase 5c — lockMissBlocking ALSO blocks auto-publish even
  // though it's no longer in blocking_reasons. ANY game excluded via
  // lock_miss means at least one row on the slate didn't get a fresh
  // prediction this run, so auto-publish must stay held. The operator
  // can still publish manually via publish-slate.ts after reviewing.
  // R-19 Phase 5d — G3 intraday exclusions ALSO block auto-publish.
  // In intraday mode, G3 fail_closed no longer cascades to
  // slateSafetyBlocking via anyGateFailedClosed (which still checks
  // g3Result.status === "fail_closed"). To preserve the safety
  // property "publish stays held when any game was excluded", we
  // also check g3IntradayBlocking here. The publish gate considers
  // BOTH per-game block sources, regardless of their cascade status
  // in dataLayerBlocked.
  const t0pub = Date.now();
  const autoPublish = shouldAutoPublishMorningSlate(env);
  // R-19 Phase 5d — slate-safety block excludes G3 in intraday mode
  // (G3 there is a per-game exclusion, not a slate-wide block). G1
  // (min game count) and G2 (starter coverage) continue to count.
  // The compound check `anyGateFailedClosed` is preserved for other
  // callers that want the strict three-gate behavior.
  const slateSafetyBlocking = intradayMode
    ? (g1Result !== null && g1Result.status === "fail_closed") ||
      (g2Result !== null && g2Result.status === "fail_closed")
    : anyGateFailedClosed(g1Result, g2Result, g3Result);
  const g3IntradayBlocking = intradayMode && g3IntradayExclusions.length > 0;
  // R-19 Phase 5e — intraday alignment degradation also holds publish.
  // Even though the cascade is softened for the R-17 G1 gate's overall
  // status, the original alignment.status=fail_closed signals partial
  // provider coverage that operators should review before publishing.
  // `intradayAlignmentDegraded` was computed in the G1 section above.
  let publishDecision: AutomationRunReport["publish_decision"];
  let publishMode: StepMode;
  let publishReason: string;
  if (
    dataLayerBlocked ||
    gateBlocking ||
    slateSafetyBlocking ||
    lockMissBlocking ||
    g3IntradayBlocking ||
    intradayAlignmentDegraded
  ) {
    publishDecision = "skipped_blocked";
    publishMode = "blocked";
    if (
      (lockMissBlocking || g3IntradayBlocking || intradayAlignmentDegraded) &&
      !(dataLayerBlocked || gateBlocking || slateSafetyBlocking)
    ) {
      const totalSkipped = combinedM2Exclusions.length;
      const parts: string[] = [];
      if (lockMissExclusions.length > 0)
        parts.push(`lock_miss=${lockMissExclusions.length}`);
      if (g3IntradayExclusions.length > 0)
        parts.push(`g3_intraday=${g3IntradayExclusions.length}`);
      if (intradayAlignmentDegraded)
        parts.push(`intraday_alignment_degraded=true`);
      publishReason =
        `publish skipped — ${totalSkipped} game(s) excluded from M2 ` +
        `(${parts.join(", ")}); auto-publish held until next clean cycle`;
    } else if (slateSafetyBlocking) {
      publishReason = "publish skipped — slate-safety gate (G1/G2/G3) blocked the cycle";
    } else {
      publishReason = "publish skipped — upstream gate blocked the cycle";
    }
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
    intraday_mode: intradayMode,
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
    intraday_alignment_degraded: intradayAlignmentDegraded,
    slate_safety_gates: {
      g1_minimum_game_count: g1Result,
      g2_starter_coverage: g2Result,
      g3_in_progress_ingest: g3Result,
    },
    slate_lock_snapshot: lockSnapshot,
    slate_lock_warnings: lockWarnings,
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

function firstInningReasonFromStatus(
  status: string,
  res: { planned_writes?: number; rows_written?: number; rows_dry_run?: number; errors?: number; skipped_nulled?: number; skipped_missing_dob?: number; mlb_api_calls?: number; message?: string },
  _writeMode: boolean
): string {
  if (status === "wrote") {
    return `refreshed ${res.rows_written ?? 0} first-inning row(s); errors=${res.errors ?? 0}; api_calls=${res.mlb_api_calls ?? 0}`;
  }
  if (status === "dry_run") {
    return `dry-run; would refresh ${res.rows_dry_run ?? 0} first-inning row(s); api_calls=${res.mlb_api_calls ?? 0}`;
  }
  if (status === "no_changes") return "no slate starters with usable FI data";
  if (status === "empty_slate") return "no slate starters resolved";
  if (status === "cancelled") return "cancelled (confirm returned false)";
  if (status === "failed") return `failed: ${res.message ?? "unknown"}`;
  return status;
}

