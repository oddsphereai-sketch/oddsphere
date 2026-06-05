/**
 * Phase 4.2.C.1.R-17 Step 1 — Automation orchestrator (dry-run only).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/automation/run-slate-cycle.ts \
 *     --sport mlb --date 2026-06-04
 *
 * What this does (Step 1 — read-only planner + reporter):
 *   1. Resolves the target slate date
 *   2. Runs provider date alignment preflight (calls SharpAPI /splits)
 *   3. Inspects current DB state (games, predictions, lines, signals)
 *   4. Decides which existing operators WOULD need to run based on
 *      coverage + staleness rules
 *   5. Runs the extended automation gate
 *   6. Emits a unified status report + final cycle decision
 *
 * What this does NOT do in Step 1:
 *   • Invoke any write operators (no --apply mode here)
 *   • Touch any DB row
 *   • Run automodel/reviewer
 *   • Activate cron
 *   • Schema/DDL changes
 *
 * Step 2 (future) will add per-step invocation + write gates. Step 3
 * will add cron scheduling. Per Daniel's R-17 Step 1 scoping: foundation
 * + observability first; orchestration writes + cron remain separate
 * approval gates.
 */

import {
  parseCommonCliOptions,
} from "../_cliCommon";
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

// ─── Step planner ────────────────────────────────────────────────────

type StepStatus = "would_run" | "skipped" | "blocked" | "not_invoked_step1";

type PlannedStep = {
  order: number;
  name: string;
  operator_path: string;
  status: StepStatus;
  reason: string;
};

/**
 * Decide which operators would run in a full apply cycle based on the
 * current DB state + provider alignment. Pure planner — does not call
 * any operator. Step 2 will replace `not_invoked_step1` with actual
 * invocation paths.
 */
function planSteps(
  alignment: ProviderDateAlignmentReport | null,
  gate: AutomationGateReport
): PlannedStep[] {
  const steps: PlannedStep[] = [];
  const align = alignment;
  const failClosed = align !== null && align.status === "fail_closed";
  const aggregate = gate.aggregate;

  // P1+P2: pre-flight already ran
  steps.push({
    order: 0,
    name: "P1. Resolve slate date",
    operator_path: "(inline)",
    status: "would_run",
    reason: `slate = ${gate.date}`,
  });
  steps.push({
    order: 1,
    name: "P2. Provider date alignment preflight",
    operator_path: "lib/services/providerDateAlignment.ts",
    status: "would_run",
    reason: align
      ? `${align.matched}/${align.slate_size} matches (threshold ${align.threshold}, status=${align.status})`
      : "not run",
  });

  // S1: slate ingest — only if current games count is suspicious
  steps.push({
    order: 2,
    name: "S1. Slate ingest (games rows)",
    operator_path: "scripts/operator/refresh-slate.ts",
    status: failClosed
      ? "blocked"
      : aggregate.total_games === 0
        ? "would_run"
        : "skipped",
    reason: failClosed
      ? "blocked by provider rollover"
      : aggregate.total_games === 0
        ? "no games for this slate yet"
        : `${aggregate.total_games} games already present`,
  });

  // S3: starter refresh — first pass (always recommended for safety)
  steps.push({
    order: 3,
    name: "S3. Starter refresh (first pass)",
    operator_path: "scripts/operator/refresh-starters.ts",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover"
      : `starters complete in ${aggregate.games_with_complete_starters}/${aggregate.total_games} games`,
  });

  // S4: missing-pitcher ingest — only if starter refresh would surface new
  steps.push({
    order: 4,
    name: "S4. Missing-pitcher ingest (conditional)",
    operator_path: "scripts/operator/ingest-missing-pitchers.ts",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover"
      : "conditional on S3 surfacing new candidates",
  });

  // S5: season-pitching stats refresh for newly-ingested pitchers only
  steps.push({
    order: 5,
    name: "S5. Season-pitching stats (new pitchers only)",
    operator_path: "scripts/operator/backfill-season-pitching-stats.ts",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover"
      : "conditional on S4 inserting new pitchers",
  });

  // S6: bullpen refresh — periodic
  steps.push({
    order: 6,
    name: "S6. Bullpen / team-stats refresh",
    operator_path: "scripts/operator/refresh-mlb-stats-from-splits.ts",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover"
      : "periodic; cheap; always runs",
  });

  // S7: lines V2 refresh
  steps.push({
    order: 7,
    name: "S7. Lines V2 refresh (R-16D + R-16E + R-16G-A)",
    operator_path: "scripts/operator/refresh-lines.ts --strategy v2",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover (would only write stale data)"
      : `ML ${aggregate.games_with_ml_lines}/${aggregate.total_games}, Total ${aggregate.games_with_total_lines}/${aggregate.total_games}, FI ${aggregate.games_with_fi_lines}/${aggregate.total_games}`,
  });

  // S8: sharp signals refresh
  steps.push({
    order: 8,
    name: "S8. Sharp signals refresh",
    operator_path: "scripts/operator/refresh-sharp-signals.ts",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked by provider rollover"
      : `signals in ${aggregate.games_with_sharp_signals}/${aggregate.total_games} games`,
  });

  // M1: final starter refresh (second pass)
  steps.push({
    order: 9,
    name: "M1. Starter refresh (final pass before model)",
    operator_path: "scripts/operator/refresh-starters.ts (final)",
    status: failClosed ? "blocked" : "would_run",
    reason: failClosed
      ? "blocked"
      : "safety pass to catch late lineup changes",
  });

  // G1: gate (already runs as part of this script — show it as the decision point)
  const gateStatus =
    gate.overall === "fail_closed"
      ? "blocked"
      : "would_run";
  steps.push({
    order: 10,
    name: "G1. Automation gate (coverage + staleness)",
    operator_path: "lib/services/automationGate.ts (this script)",
    status: gateStatus,
    reason: `overall=${gate.overall} · per-market holds: ML ${aggregate.ml_hold_count}/${aggregate.total_games}, OU ${aggregate.ou_hold_count}/${aggregate.total_games}, NRFI ${aggregate.nrfi_hold_count}/${aggregate.total_games}`,
  });

  // M2: automodel + reviewer — only if gate passed
  const modelBlocked = gate.overall === "fail_closed" || failClosed;
  steps.push({
    order: 11,
    name: "M2. Automodel + reviewer + breakdown",
    operator_path: "scripts/operator/automodel-morning-card.ts --write",
    status: modelBlocked ? "blocked" : "would_run",
    reason: modelBlocked
      ? `blocked by ${failClosed ? "provider rollover" : "gate fail_closed"}`
      : `would write 9 game_predictions with per-game hold decisions from G1`,
  });

  // Step 1 caveat — none of these actually invoke today
  for (const s of steps) {
    if (s.status === "would_run") s.status = "not_invoked_step1";
  }

  return steps;
}

// ─── Final cycle decision ────────────────────────────────────────────

type CycleDecision =
  | "would_run_model"
  | "would_hold_some_markets"
  | "would_abort_provider_mismatch"
  | "no_slate_in_db";

function decideCycle(
  alignment: ProviderDateAlignmentReport | null,
  gate: AutomationGateReport
): CycleDecision {
  if (gate.aggregate.total_games === 0) return "no_slate_in_db";
  if (alignment && alignment.status === "fail_closed")
    return "would_abort_provider_mismatch";
  if (gate.overall === "fail_closed") return "would_abort_provider_mismatch";
  const aggregate = gate.aggregate;
  if (
    aggregate.ml_hold_count === 0 &&
    aggregate.ou_hold_count === 0 &&
    aggregate.nrfi_hold_count === aggregate.total_games
  ) {
    // NRFI all-toss-up is normal; everything else clear
    return "would_run_model";
  }
  if (aggregate.ml_hold_count > 0 || aggregate.ou_hold_count > 0) {
    return "would_hold_some_markets";
  }
  return "would_run_model";
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);

  console.log(`[run-slate-cycle] R-17 Step 1 — DRY-RUN ONLY`);
  console.log(`  sport=${common.sport}  date=${common.date}`);
  console.log(`  This script makes NO writes. No env vars / flags can`);
  console.log(`  enable writes in Step 1. Step 2 will add apply mode.`);
  console.log();

  // P1. Resolve slate (just echoes the date for now — anchor logic is
  // already in the data services).
  console.log(`━━━ P1. Slate date ━━━`);
  console.log(`  slate_date: ${common.date}  sport: ${common.sport}`);

  // P3 first (cheap DB read; needed for slate_size in P2 threshold)
  console.log();
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

  // P2. Provider date alignment preflight
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
      console.log(`  expected_date:        ${alignment.expected_date}`);
      console.log(`  provider rows:        ${alignment.provider_rows_total}`);
      console.log(`  matched:              ${alignment.matched}`);
      console.log(`  wrong_date:           ${alignment.wrong_date}`);
      console.log(`  date_unparseable:     ${alignment.date_unparseable}`);
      console.log(`  threshold:            ${alignment.threshold} (${Math.round(alignment.threshold_ratio * 100)}% of ${alignment.slate_size})`);
      console.log(`  STATUS:               ${alignment.status.toUpperCase()}`);
      console.log(`  reason:               ${alignment.reason}`);
    } catch (e) {
      console.log(`  ✗ preflight failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // G1. Automation gate
  console.log();
  console.log(`━━━ G1. Automation gate ━━━`);
  const gate = await assessAutomationGate(common.sport, common.date, {
    providerAlignment: alignment,
  });
  console.log(`  overall:                ${gate.overall.toUpperCase()}`);
  console.log(`  starters complete:      ${gate.aggregate.games_with_complete_starters}/${gate.aggregate.total_games}`);
  console.log(`  ML lines coverage:      ${gate.aggregate.games_with_ml_lines}/${gate.aggregate.total_games}`);
  console.log(`  Total lines coverage:   ${gate.aggregate.games_with_total_lines}/${gate.aggregate.total_games}`);
  console.log(`  Spread lines coverage:  ${gate.aggregate.games_with_spread_lines}/${gate.aggregate.total_games}`);
  console.log(`  FI lines coverage:      ${gate.aggregate.games_with_fi_lines}/${gate.aggregate.total_games}  (best-effort)`);
  console.log(`  sharp_signals coverage: ${gate.aggregate.games_with_sharp_signals}/${gate.aggregate.total_games}`);
  console.log(`  stale-line games:       ${gate.aggregate.stale_line_games}`);
  console.log();
  console.log(`  Per-market hold counts: ML ${gate.aggregate.ml_hold_count}  OU ${gate.aggregate.ou_hold_count}  NRFI ${gate.aggregate.nrfi_hold_count}`);
  console.log();
  console.log(`  Reasons:`);
  for (const r of gate.reasons) console.log(`    · ${r}`);

  // Per-game gate decisions
  if (gate.per_game.length > 0) {
    console.log();
    console.log(`━━━ Per-game decisions ━━━`);
    console.log(`  game       starters   ml/tot/spr/fi   ML decision      OU decision      NRFI decision`);
    for (const row of gate.per_game) {
      const starters = `${row.starter_home_set ? "H" : "—"}${row.starter_away_set ? "A" : "—"}`;
      const counts = `${row.ml_lines}/${row.total_lines}/${row.spread_lines}/${row.fi_lines}`;
      const mlD = row.ml.decision === "play" ? "PLAY" : `HOLD: ${row.ml.reason ?? "?"}`;
      const ouD = row.ou.decision === "play" ? "PLAY" : `HOLD: ${row.ou.reason ?? "?"}`;
      const nrfiD = row.nrfi.decision === "play" ? "PLAY" : `HOLD: ${row.nrfi.reason ?? "?"}`;
      console.log(`  ${row.tag.padEnd(10)} ${starters.padEnd(10)} ${counts.padEnd(15)} ${mlD.padEnd(16)} ${ouD.padEnd(16)} ${nrfiD}`);
    }
  }

  // Step plan
  console.log();
  console.log(`━━━ Planned operator sequence (Step 1: detected, not invoked) ━━━`);
  const steps = planSteps(alignment, gate);
  for (const s of steps) {
    const statusLabel =
      s.status === "blocked"
        ? "🚫 BLOCKED"
        : s.status === "skipped"
          ? "↷ SKIP"
          : s.status === "not_invoked_step1"
            ? "○ would run (Step 2)"
            : s.status;
    console.log(`  ${String(s.order).padStart(2)}. ${statusLabel.padEnd(22)} ${s.name}`);
    console.log(`      ${s.operator_path}`);
    console.log(`      reason: ${s.reason}`);
  }

  // Final decision
  console.log();
  console.log(`━━━ Final cycle decision ━━━`);
  const decision = decideCycle(alignment, gate);
  const decisionLabel = (() => {
    switch (decision) {
      case "would_run_model": return "🟢 WOULD_RUN_MODEL";
      case "would_hold_some_markets": return "🟡 WOULD_HOLD_SOME_MARKETS";
      case "would_abort_provider_mismatch": return "🚫 WOULD_ABORT_PROVIDER_MISMATCH";
      case "no_slate_in_db": return "🚫 NO_SLATE_IN_DB";
    }
  })();
  console.log(`  decision: ${decisionLabel}`);
  switch (decision) {
    case "would_run_model":
      console.log(`  → Step 2 would proceed through M2 (automodel + reviewer).`);
      break;
    case "would_hold_some_markets":
      console.log(`  → Step 2 would write predictions with per-game holds for the markets above.`);
      break;
    case "would_abort_provider_mismatch":
      console.log(`  → Step 2 would ABORT before any writes; reader continues showing last-good state.`);
      break;
    case "no_slate_in_db":
      console.log(`  → Step 2 would invoke S1 slate ingest first to populate games rows.`);
      break;
  }

  console.log();
  console.log(`  DRY RUN — NO DB WRITES PERFORMED. (Step 1 is observation-only.)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
