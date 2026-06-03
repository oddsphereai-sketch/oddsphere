/**
 * Phase 4.2.A — Operator script: hide a slate (any → hidden) for rollback.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/hide-slate.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--verbose] \
 *     [--reason "text"] \
 *     [--apply]
 *
 * GUARDS (defense in depth, mirrors refresh-slate.ts):
 *   1. Writes require TWO keys: --apply AND SLATE_HIDE_DB_WRITES_ENABLED=true.
 *      Without both, the script runs dry-run regardless of --apply.
 *
 *   2. --apply also triggers an interactive y/N confirmation showing the
 *      exact sport/date and game count about to be hidden.
 *
 * WHEN TO USE:
 *   • Bad slate published by cron and needs to revert immediately
 *   • Investigation: pull a slate off the public surface while debugging
 *   • Disaster recovery during early launch
 *
 * SEPARATE FLAG FROM publish-slate ON PURPOSE:
 *   Publishing and hiding are different risk actions. We want explicit,
 *   distinct env opt-ins so an operator can't accidentally hide when
 *   meaning to publish (or vice versa).
 *
 * WRITES (when --apply confirmed):
 *   • games.slate_status: any state → 'hidden' (idempotent on hidden)
 *   • admin_audit_log: one row with action_type='slate.hide' and the
 *     optional --reason payload
 *   • No other tables touched.
 *
 * EFFECT:
 *   • Immediately removes the slate from /api/lab/daily-edge (route
 *     filters to slate_status IN ('published', 'final')).
 *   • UI falls back to the most recent visible slate. Phase 4.2's
 *     resolveSlateDate() handles this gracefully — members see "stale"
 *     content but no broken page.
 *
 * REVERSAL:
 *   • To un-hide: re-run publish-slate.ts on the same (sport, date).
 *     slatePublishService.publishSlate promotes hidden→published, which
 *     is the manual-revival path documented in V2.1 Part 9.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readBoolFlag,
  readStringFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import { hideSlate, getPublishStatus } from "../../lib/services/slatePublishService";
import type { Sport } from "../../lib/types/domain/Sport";
import type { SlateStatus } from "../../lib/types/domain/Grade";

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.SLATE_HIDE_DB_WRITES_ENABLED === "true";
  return {
    applyRequested,
    envEnabled,
    canApply: applyRequested && envEnabled,
  };
}

function refuseApplyMisconfig(
  applyRequested: boolean,
  envEnabled: boolean
): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires SLATE_HIDE_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any slate_status UPDATE.",
      "  Separate gate from publish-slate — these are different risk actions.",
      "  To opt in for this command:",
      "",
      "    SLATE_HIDE_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/hide-slate.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

// ─── snapshot helpers ─────────────────────────────────────────────────

async function loadSlateRows(
  sport: Sport,
  date: string
): Promise<Array<{ id: number; status: string; slate_status: SlateStatus }>> {
  const { data, error } = await supabase
    .from("games")
    .select("id, status, slate_status")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (error) {
    throw new Error(`loadSlateRows failed: ${error.message}`);
  }
  return (data ?? []) as Array<{ id: number; status: string; slate_status: SlateStatus }>;
}

function statusBreakdown(
  rows: Array<{ slate_status: SlateStatus }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.slate_status] = (out[r.slate_status] ?? 0) + 1;
  return out;
}

function countWouldHide(
  rows: Array<{ slate_status: SlateStatus }>
): number {
  return rows.filter((r) => r.slate_status !== "hidden").length;
}

async function confirmApply(
  sport: Sport,
  date: string,
  wouldHide: number,
  total: number,
  reason: string | null
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to HIDE slate for sport=${sport} date=${date}.\n` +
        `  Total games on slate: ${total}\n` +
        `  Games to retract (any → hidden): ${wouldHide}\n` +
        `  Games already hidden (no-op): ${total - wouldHide}\n` +
        `  Reason recorded in audit: ${reason ?? "(none)"}\n` +
        `  IMPACT: the slate immediately disappears from /api/lab/daily-edge.\n` +
        `  The UI will fall back to the most recent visible slate.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);
  const reason = readStringFlag(argv, "--reason") ?? null;

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[hide-slate] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } sport=${common.sport} date=${common.date} verbose=${common.verbose}` +
      (reason !== null ? ` reason="${reason}"` : "")
  );
  if (!writeMode) {
    console.log("           DRY RUN — NO DB WRITES");
  }

  // Pre-state snapshot
  const rows = await loadSlateRows(common.sport, common.date);
  const breakdown = statusBreakdown(rows);
  const collective = await getPublishStatus(common.sport, common.date);
  const wouldHide = countWouldHide(rows);

  console.log();
  console.log("━━━ Pre-state ━━━");
  console.log(`  Total games on slate: ${rows.length}`);
  console.log(`  Collective slate status: ${collective}`);
  console.log(`  Status breakdown:`);
  if (Object.keys(breakdown).length === 0) {
    console.log(`    (none — empty slate)`);
  } else {
    for (const [s, n] of Object.entries(breakdown).sort()) {
      console.log(`    ${s.padEnd(12)} : ${n}`);
    }
  }

  if (common.verbose && rows.length > 0) {
    console.log();
    console.log("  Per-game status (verbose):");
    for (const r of rows) {
      console.log(`    game_id=${r.id} status=${r.status} slate_status=${r.slate_status}`);
    }
  }

  console.log();
  console.log("━━━ Action plan ━━━");
  if (rows.length === 0) {
    console.log("  No games on this slate. hideSlate will be a no-op.");
  } else if (wouldHide === 0) {
    console.log(`  All ${rows.length} games already hidden. hideSlate will be a no-op.`);
  } else {
    console.log(`  Would retract ${wouldHide} game(s) to slate_status='hidden'.`);
    console.log(`  Skipping ${rows.length - wouldHide} game(s) already hidden.`);
    console.log(`  After write: /api/lab/daily-edge will not surface this slate.`);
  }

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    if (rows.length === 0) {
      console.log("  🟡 Empty slate. Nothing to hide.");
    } else if (wouldHide === 0) {
      console.log("  🟢 Already entirely hidden. No action needed.");
    } else {
      console.log(`  🟢 Ready to hide ${wouldHide} game(s).`);
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: confirm + write
  const confirmed = await confirmApply(
    common.sport,
    common.date,
    wouldHide,
    rows.length,
    reason
  );
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via slatePublishService.hideSlate…");
  const result = await hideSlate(common.sport, common.date, reason ?? undefined);
  console.log(`  hidden: ${result.hidden}`);

  // Post-state
  const postRows = await loadSlateRows(common.sport, common.date);
  const postBreakdown = statusBreakdown(postRows);
  const postCollective = await getPublishStatus(common.sport, common.date);

  console.log();
  console.log("━━━ Post-state ━━━");
  console.log(`  Collective slate status: ${postCollective}`);
  console.log(`  Status breakdown:`);
  for (const [s, n] of Object.entries(postBreakdown).sort()) {
    console.log(`    ${s.padEnd(12)} : ${n}`);
  }

  console.log();
  console.log("APPLY complete. To un-hide: re-run scripts/operator/publish-slate.ts");
  console.log(`  on the same (sport=${common.sport}, date=${common.date}). publishSlate is the manual revival path.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
