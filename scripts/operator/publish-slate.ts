/**
 * Phase 4.2.A — Operator script: publish a slate (draft → published)
 * for one sport/date.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/publish-slate.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--verbose] \
 *     [--apply]
 *
 * GUARDS (defense in depth, mirrors refresh-slate.ts):
 *   1. Writes require TWO keys: --apply AND SLATE_PUBLISH_DB_WRITES_ENABLED=true.
 *      Without both, the script runs dry-run regardless of --apply.
 *
 *   2. --apply also triggers an interactive y/N confirmation showing the
 *      exact sport/date and game count about to be published.
 *
 * WRITES (when --apply confirmed):
 *   • games.slate_status: 'draft' (or 'hidden') → 'published'
 *   • admin_audit_log: one row with action_type='slate.publish'
 *   • No other tables touched.
 *
 * DEFAULT BEHAVIOR (no --apply): DRY-RUN
 *   • Reads slate via slatePublishService.getPublishStatus(sport, date)
 *   • Lists current statuses for every game on the slate
 *   • Reports how many games WOULD be promoted (skips already-published
 *     and already-final games — publishSlate is idempotent on those)
 *   • Prints DRY RUN — NO DB WRITES banner
 *
 * IDEMPOTENCY:
 *   • publishSlate is a no-op on slates that are already entirely
 *     published or final. Re-running prints "0 promoted" and exits clean.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readBoolFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import { publishSlate, getPublishStatus } from "../../lib/services/slatePublishService";
import type { Sport } from "../../lib/types/domain/Sport";
import type { SlateStatus } from "../../lib/types/domain/Grade";

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.SLATE_PUBLISH_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires SLATE_PUBLISH_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any slate_status UPDATE.",
      "  To opt in for this command:",
      "",
      "    SLATE_PUBLISH_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/publish-slate.ts --apply [...flags]",
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

function countWouldPromote(
  rows: Array<{ slate_status: SlateStatus }>
): number {
  return rows.filter((r) => r.slate_status !== "published" && r.slate_status !== "final").length;
}

async function confirmApply(
  sport: Sport,
  date: string,
  wouldPromote: number,
  total: number
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to PUBLISH slate for sport=${sport} date=${date}.\n` +
        `  Total games on slate: ${total}\n` +
        `  Games to promote (draft/hidden → published): ${wouldPromote}\n` +
        `  Games already published/final (no-op): ${total - wouldPromote}\n` +
        `  One audit row will be written to admin_audit_log.\n` +
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

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[publish-slate] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } sport=${common.sport} date=${common.date} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("              DRY RUN — NO DB WRITES");
  }

  // Pre-state snapshot
  const rows = await loadSlateRows(common.sport, common.date);
  const breakdown = statusBreakdown(rows);
  const collective = await getPublishStatus(common.sport, common.date);
  const wouldPromote = countWouldPromote(rows);

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
    console.log("  No games on this slate. publishSlate will be a no-op.");
  } else if (wouldPromote === 0) {
    console.log(`  All ${rows.length} games already published/final. publishSlate will be a no-op.`);
  } else {
    console.log(`  Would promote ${wouldPromote} game(s) to slate_status='published'.`);
    console.log(`  Skipping ${rows.length - wouldPromote} game(s) already published/final.`);
  }

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    if (rows.length === 0) {
      console.log("  🟡 Empty slate. Run refresh-slate.ts first to populate games.");
    } else if (wouldPromote === 0) {
      console.log("  🟢 Already entirely published/final. No action needed.");
    } else {
      console.log(`  🟢 Ready to publish ${wouldPromote} game(s).`);
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: confirm + write
  const confirmed = await confirmApply(common.sport, common.date, wouldPromote, rows.length);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via slatePublishService.publishSlate…");
  const result = await publishSlate(common.sport, common.date);
  console.log(`  promoted: ${result.promoted}`);

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
  console.log("APPLY complete. The slate is now visible to members via");
  console.log("/api/lab/daily-edge filtered to slate_status IN (published, final).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
