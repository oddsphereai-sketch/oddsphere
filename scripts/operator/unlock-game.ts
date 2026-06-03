/**
 * Phase 4.2.B — Operator script: unlock a single game by clearing
 * game_predictions.locked_at. Emergency-only tool.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/unlock-game.ts \
 *     [--sport mlb] --date YYYY-MM-DD --external-id <bdl_id> \
 *     [--reason "text"] [--verbose] [--apply]
 *
 * WHEN TO USE (per Phase 4.2.B planning):
 *   • A game was locked at T-60, then postponed/rescheduled. The lock
 *     formula sees the new game_date but won't auto-unlock (V1 chose
 *     operator-driven unlock to avoid acting on chaotic line/lineup data
 *     during a postponement window).
 *   • The lock fired by mistake (timezone bug, bad game_date in DB).
 *   • Pre-launch testing: unlock a manually-locked test game.
 *
 * NOT FOR ROUTINE USE. Unlocking a game lets cron overwrite the public
 * prediction. If the operator is uncertain whether the game is actually
 * postponed or just delayed, hide-slate.ts is the safer rollback.
 *
 * GUARDS (defense in depth, mirrors publish-slate / hide-slate):
 *   1. Writes require TWO keys: --apply AND SLATE_UNLOCK_DB_WRITES_ENABLED=true.
 *      Without both, the script runs dry-run regardless of --apply.
 *   2. --apply also triggers an interactive y/N confirmation showing the
 *      exact sport/date/external_id and the current locked_at value
 *      about to be cleared.
 *   3. The script targets exactly ONE game per invocation (--external-id
 *      is required for apply). No bulk unlock; if multiple games need
 *      unlocking, run the script multiple times.
 *
 * SEPARATE FLAG FROM publish-slate / hide-slate ON PURPOSE:
 *   Unlocking is a different risk action (lets cron overwrite a locked
 *   public prediction). We want explicit, distinct env opt-ins so an
 *   operator can't accidentally unlock when meaning to publish/hide.
 *
 * WRITES (when --apply confirmed):
 *   • game_predictions.locked_at: <timestamp> → NULL (single game)
 *   • admin_audit_log: one row with action_type='game_prediction.unlock'
 *     carrying { sport, date, game_id, external_id, prior_locked_at, reason }
 *   • No other tables touched.
 *
 * EFFECT:
 *   • On the next pregame-sweep cron run, the game's prediction can be
 *     refreshed by auto-model writes again. If the rescheduled game's
 *     new game_date is still > 60 min away, the prediction will update
 *     normally; if it's < 60 min away, the game will re-lock immediately
 *     after the next refresh.
 *
 * RE-LOCK (no script needed):
 *   • Re-locking happens automatically on the next pregame-sweep that
 *     observes the game in the T-60 window. There's no manual "lock"
 *     operator script — locking is purely cron-driven.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.SLATE_UNLOCK_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires SLATE_UNLOCK_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before locked_at is cleared.",
      "  Separate gate from publish-slate AND hide-slate — these are",
      "  distinct risk actions.",
      "  To opt in for this command:",
      "",
      "    SLATE_UNLOCK_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/unlock-game.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

// ─── target game lookup ───────────────────────────────────────────────

type TargetGame = {
  game_id: number;
  external_id: number;
  game_date: string | null;
  slate_status: string;
  locked_at: string | null;
};

async function loadTargetGame(
  sport: Sport,
  date: string,
  externalId: number
): Promise<TargetGame | null> {
  const { data, error } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, slate_status, game_predictions ( locked_at )"
    )
    .eq("sport", sport)
    .eq("slate_date", date)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null;
    throw new Error(`loadTargetGame failed: ${error.message}`);
  }
  if (data === null) return null;
  const row = data as unknown as {
    id: number;
    external_id: number;
    game_date: string | null;
    slate_status: string;
    game_predictions: Array<{ locked_at: string | null }> | null;
  };
  return {
    game_id: row.id,
    external_id: row.external_id,
    game_date: row.game_date,
    slate_status: row.slate_status,
    locked_at: row.game_predictions?.[0]?.locked_at ?? null,
  };
}

async function confirmApply(
  sport: Sport,
  date: string,
  game: TargetGame,
  reason: string | null
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UNLOCK a single game prediction.\n` +
        `  sport=${sport} date=${date}\n` +
        `  external_id=${game.external_id} game_id=${game.game_id}\n` +
        `  game_date=${game.game_date ?? "(null)"}\n` +
        `  current locked_at=${game.locked_at}\n` +
        `  reason=${reason ?? "(none)"}\n` +
        `  IMPACT: the next pregame-sweep cron run can refresh this\n` +
        `  prediction again, OR re-lock it immediately if game_date - now\n` +
        `  is already inside the 60 min window.\n` +
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
  const externalId = readNumberFlag(argv, "--external-id");
  const reason = readStringFlag(argv, "--reason") ?? null;

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  if (writeMode && externalId === undefined) {
    console.error(
      "✗ --external-id <bdl_id> is required when --apply is set.\n" +
        "  This script targets exactly ONE game per invocation. To unlock\n" +
        "  multiple games, run the script once per game."
    );
    process.exit(1);
  }

  console.log(
    `[unlock-game] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } sport=${common.sport} date=${common.date} verbose=${common.verbose}` +
      (externalId !== undefined ? ` external_id=${externalId}` : "") +
      (reason !== null ? ` reason="${reason}"` : "")
  );
  if (!writeMode) {
    console.log("             DRY RUN — NO DB WRITES");
  }

  if (externalId === undefined) {
    console.log();
    console.log("━━━ Dry-run summary ━━━");
    console.log(
      "  No --external-id provided. Dry-run lists currently locked games"
    );
    console.log("  on the slate for visibility, but won't write.");
    console.log();
    // List all locked games on this slate as a navigation aid.
    const { data, error } = await supabase
      .from("games")
      .select(
        "external_id, game_date, slate_status, game_predictions ( locked_at )"
      )
      .eq("sport", common.sport)
      .eq("slate_date", common.date);
    if (error) {
      console.error("Slate scan failed:", error.message);
      process.exit(1);
    }
    type Row = {
      external_id: number;
      game_date: string | null;
      slate_status: string;
      game_predictions: Array<{ locked_at: string | null }> | null;
    };
    const rows = (data ?? []) as Row[];
    const locked = rows.filter(
      (r) => (r.game_predictions?.[0]?.locked_at ?? null) !== null
    );
    console.log(`  Total games on slate: ${rows.length}`);
    console.log(`  Locked games:         ${locked.length}`);
    if (locked.length === 0) {
      console.log("  → No locked games on this slate. Nothing to unlock.");
    } else {
      console.log();
      console.log("  Locked games (use --external-id <id> + --apply to unlock):");
      for (const r of locked) {
        const lockedAt = r.game_predictions?.[0]?.locked_at ?? "?";
        console.log(
          `    ext=${r.external_id} game_date=${r.game_date ?? "(null)"} locked_at=${lockedAt} status=${r.slate_status}`
        );
      }
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // Single-game target lookup
  const target = await loadTargetGame(common.sport, common.date, externalId);
  if (target === null) {
    console.error(
      `✗ No game found for sport=${common.sport} date=${common.date} external_id=${externalId}.\n` +
        `  Check the slate via dry-run (omit --external-id) to see available games.`
    );
    process.exit(1);
  }

  console.log();
  console.log("━━━ Target game ━━━");
  console.log(`  game_id:     ${target.game_id}`);
  console.log(`  external_id: ${target.external_id}`);
  console.log(`  game_date:   ${target.game_date ?? "(null)"}`);
  console.log(`  slate_status:${target.slate_status}`);
  console.log(`  locked_at:   ${target.locked_at ?? "(null)"}`);

  if (target.locked_at === null) {
    console.log();
    console.log("  🟢 This game is already unlocked. No action needed.");
    if (!writeMode) {
      console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    }
    return;
  }

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    console.log("  🟢 Ready to unlock. Re-run with --apply (+ env flag) to write.");
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: confirm + write
  const confirmed = await confirmApply(common.sport, common.date, target, reason);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing UPDATE game_predictions.locked_at = NULL…");
  const priorLockedAt = target.locked_at;
  const { error: updErr } = await supabase
    .from("game_predictions")
    .update({ locked_at: null })
    .eq("game_id", target.game_id);
  if (updErr) {
    console.error("✗ UPDATE failed:", updErr.message);
    process.exit(1);
  }

  // Audit row
  const { error: auditErr } = await supabase.from("admin_audit_log").insert({
    action_type: "game_prediction.unlock",
    target_table: "game_predictions",
    target_id: target.game_id,
    before_state: { locked_at: priorLockedAt },
    after_state: {
      sport: common.sport,
      date: common.date,
      game_id: target.game_id,
      external_id: target.external_id,
      prior_locked_at: priorLockedAt,
      reason,
    },
    source_type: "manual",
  });
  if (auditErr) {
    // Non-fatal — the unlock succeeded. Surface the audit failure so the
    // operator knows, but exit success because the primary state change
    // (locked_at cleared) is in place.
    console.log("  unlock succeeded.");
    console.log(`  ⚠ audit insert failed: ${auditErr.message}`);
    console.log("    Manually record this action if compliance requires it.");
    return;
  }

  console.log("  unlock succeeded.");
  console.log("  audit row written to admin_audit_log.");
  console.log();
  console.log("Next pregame-sweep cron run can refresh this prediction again.");
  console.log("If the rescheduled game_date is already within 60 min, the");
  console.log("game will re-lock on that same run after the refresh.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
