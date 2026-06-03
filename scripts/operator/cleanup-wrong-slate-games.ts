/**
 * Phase 4.1.9.C-1c.iii — Operator script: delete a small, named set of
 * `games` rows that were inserted with the wrong home/away team_ids
 * (root cause: pre-fix teams.external_id misalignment).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/cleanup-wrong-slate-games.ts \
 *     [--verbose] [--apply]
 *
 * TARGET (hardcoded — small, explicit, audit-trail-friendly):
 *   game_ids: 14567, 14568, 14569, 14570, 14571, 14572
 *   external_ids: 5058662–5058667
 *   sport: mlb, slate_date: 2026-06-01, slate_status: draft
 *
 * GUARDS (defense in depth):
 *   1. Every row must currently satisfy ALL of:
 *        • sport='mlb', slate_date='2026-06-01', slate_status='draft'
 *      If any row deviates, the script refuses to proceed.
 *
 *   2. Every row must have ZERO dependent rows in:
 *        game_predictions, lines, line_history, sharp_signals,
 *        prop_predictions, lineups, weather_forecasts
 *      If any dependency is non-zero, the script refuses to proceed
 *      (defense in depth — these tables ON DELETE CASCADE, but we want
 *      to *prove* nothing valuable would be lost, not rely on cascade
 *      to delete unknown rows).
 *
 *   3. Writes require TWO keys: --apply AND GAMES_DB_DELETES_ENABLED=true.
 *      Without both, the script reports the cleanup scope and exits.
 *
 *   4. --apply triggers an interactive y/N confirmation listing every
 *      game_id about to be DELETED.
 *
 * WRITES (when confirmed):
 *   • Single DELETE: `DELETE FROM games WHERE id IN (14567,...,14572)`.
 *   • Per-row by-id deletion; no broader WHERE clause.
 *   • No DDL. No predictions, no lines, no sharp_signals, no team writes.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { readBoolFlag, readStringFlag } from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";

// ─── target scope (hardcoded — explicit and small) ────────────────────

const TARGET_GAME_IDS: ReadonlyArray<number> = [14567, 14568, 14569, 14570, 14571, 14572];
const EXPECTED_SPORT = "mlb";
const EXPECTED_SLATE_DATE = "2026-06-01";
const EXPECTED_SLATE_STATUS = "draft";
const EXPECTED_EXTERNAL_IDS = new Set([5058662, 5058663, 5058664, 5058665, 5058666, 5058667]);

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.GAMES_DB_DELETES_ENABLED === "true";
  return { applyRequested, envEnabled, canApply: applyRequested && envEnabled };
}

function refuseApplyMisconfig(applyRequested: boolean, envEnabled: boolean): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires GAMES_DB_DELETES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any games row is deleted.",
      "  To opt in for this command:",
      "",
      "    GAMES_DB_DELETES_ENABLED=true npx tsx --env-file=.env.local \\",
      "      scripts/operator/cleanup-wrong-slate-games.ts --apply",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(ids: ReadonlyArray<number>): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to DELETE ${ids.length} rows from games.\n` +
        `  game_ids: ${ids.join(", ")}\n` +
        `  sport=${EXPECTED_SPORT} slate_date=${EXPECTED_SLATE_DATE} slate_status=${EXPECTED_SLATE_STATUS}\n` +
        `  All pre-checks have passed. No downstream rows to cascade.\n` +
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
  const verbose = readBoolFlag(argv, "--verbose");
  // Reject any --sport/--date the operator might have supplied — this
  // script's scope is hardcoded by design.
  const stray = readStringFlag(argv, "--sport") ?? readStringFlag(argv, "--date");
  if (stray !== undefined) {
    console.error(
      "✗ This script has a hardcoded scope (specific game IDs for one slate).\n" +
        "  --sport and --date are not accepted. Edit the TARGET_GAME_IDS constant\n" +
        "  if a different cleanup scope is needed."
    );
    process.exit(1);
  }

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[cleanup-wrong-slate-games] mode=${writeMode ? "APPLY" : "DRY-RUN"} verbose=${verbose}`
  );
  console.log(`  target game_ids: ${TARGET_GAME_IDS.join(", ")}`);
  if (!writeMode) console.log("           DRY RUN — NO DB WRITES");

  // ─── Pre-check 1: rows match expected sport / slate_date / slate_status ───
  console.log();
  console.log("━━━ Pre-check 1 — row identity ━━━");
  const { data: rows, error: rowsErr } = await supabase
    .from("games")
    .select("id, external_id, sport, slate_date, slate_status, home_team_id, away_team_id, status")
    .in("id", [...TARGET_GAME_IDS])
    .order("id");
  if (rowsErr) {
    console.error(`✗ Query failed: ${rowsErr.message}`);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("  No matching rows. Cleanup may already be complete.");
    process.exit(0);
  }

  // Build a team-id → abbreviation map for the rows we're about to inspect
  const teamIdsInScope = Array.from(
    new Set(rows.flatMap((r) => [r.home_team_id, r.away_team_id]).filter((x): x is number => x !== null))
  );
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, name")
    .in("id", teamIdsInScope);
  const teamById = new Map<number, { abbreviation: string; name: string }>();
  for (const t of teams ?? []) teamById.set(t.id, { abbreviation: t.abbreviation, name: t.name });

  console.log(
    `  game_id | ext_id   | sport | slate_date | slate_status | game-level status      | away → home (current join)`
  );
  let identityOk = true;
  for (const r of rows) {
    const sport = r.sport === EXPECTED_SPORT ? "mlb ✓" : `${r.sport} ✗`;
    const sd = r.slate_date === EXPECTED_SLATE_DATE ? `${r.slate_date} ✓` : `${r.slate_date} ✗`;
    const ss = r.slate_status === EXPECTED_SLATE_STATUS ? `${r.slate_status} ✓` : `${r.slate_status} ✗`;
    const ext = EXPECTED_EXTERNAL_IDS.has(r.external_id) ? `${r.external_id} ✓` : `${r.external_id} ✗`;
    const away = r.away_team_id !== null ? teamById.get(r.away_team_id) : null;
    const home = r.home_team_id !== null ? teamById.get(r.home_team_id) : null;
    const join = `${away?.abbreviation ?? "?"} @ ${home?.abbreviation ?? "?"}`;
    const ok =
      r.sport === EXPECTED_SPORT &&
      r.slate_date === EXPECTED_SLATE_DATE &&
      r.slate_status === EXPECTED_SLATE_STATUS &&
      EXPECTED_EXTERNAL_IDS.has(r.external_id);
    if (!ok) identityOk = false;
    console.log(
      `  ${String(r.id).padEnd(7)} | ${ext.padEnd(11)} | ${sport.padEnd(5)} | ${sd.padEnd(14)} | ${ss.padEnd(12)} | ${String(r.status ?? "(null)").padEnd(22)} | ${join}`
    );
  }

  // Also check that we found ALL 6 expected ids
  const foundIds = new Set(rows.map((r) => r.id));
  const missing = TARGET_GAME_IDS.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    console.log(`  ⚠ Missing from DB (already deleted or never inserted): ${missing.join(", ")}`);
  }

  if (!identityOk) {
    console.error();
    console.error("✗ One or more rows failed identity pre-check. Cleanup ABORTED.");
    console.error("  The script will not delete rows whose sport/slate_date/slate_status/external_id");
    console.error("  doesn't match the expected scope.");
    process.exit(1);
  }

  // ─── Pre-check 2: zero downstream rows ───
  console.log();
  console.log("━━━ Pre-check 2 — downstream row counts (must all be 0) ━━━");
  const ids = [...TARGET_GAME_IDS];

  type Probe = { table: string; column?: string };
  const probes: Probe[] = [
    { table: "game_predictions" },
    { table: "lines" },
    { table: "line_history" },
    { table: "sharp_signals" },
    { table: "prop_predictions" },
    { table: "lineups" },
    { table: "weather_forecasts" },
  ];

  let depsOk = true;
  for (const p of probes) {
    const col = p.column ?? "game_id";
    const { count, error } = await supabase
      .from(p.table)
      .select("*", { count: "exact", head: true })
      .in(col, ids);
    if (error) {
      console.error(`✗ Probe failed on ${p.table}: ${error.message}`);
      process.exit(1);
    }
    const ok = (count ?? 0) === 0;
    if (!ok) depsOk = false;
    console.log(`  ${p.table.padEnd(20)} ${count ?? 0} rows  ${ok ? "✓" : "✗ NON-ZERO"}`);
  }

  if (!depsOk) {
    console.error();
    console.error("✗ One or more downstream tables have rows referencing the target games.");
    console.error("  Cleanup ABORTED. Investigate before proceeding — the previous diagnostic");
    console.error("  said these tables were empty for these games, so a non-zero count means");
    console.error("  something has changed since the audit ran.");
    process.exit(1);
  }

  // ─── Cleanup plan ───
  console.log();
  console.log("━━━ Cleanup plan ━━━");
  console.log("  Statement that would execute:");
  console.log(`    DELETE FROM games WHERE id IN (${TARGET_GAME_IDS.join(", ")});`);
  console.log();
  console.log("  Scope:");
  console.log(`    rows in games:           ${rows.length}`);
  console.log(`    cascade impact:          0 (verified above)`);
  console.log(`    other tables touched:    none`);
  console.log();
  console.log("  Rollback if needed:");
  console.log("    These rows came from an upstream BDL /games call. The slate refresh");
  console.log("    operator script (refresh-slate.ts) can re-fetch and re-upsert tonight's");
  console.log("    canonical slate (after the ET sports-day fix lands in 4.1.9.C-1c.iv).");
  console.log("    The 6 external_ids (5058662-5058667) are stable BDL identifiers, so");
  console.log("    BDL's response will reproduce them with the CORRECT team_ids this time.");

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    console.log(`  🟢 All pre-checks pass. ${rows.length} rows ready for deletion.`);
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    console.log();
    console.log("  To apply:");
    console.log("    GAMES_DB_DELETES_ENABLED=true npx tsx --env-file=.env.local \\");
    console.log("      scripts/operator/cleanup-wrong-slate-games.ts --apply");
    return;
  }

  // APPLY
  const confirmed = await confirmApply(TARGET_GAME_IDS);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Executing DELETE…");
  const { error: delErr, count: delCount } = await supabase
    .from("games")
    .delete({ count: "exact" })
    .in("id", [...TARGET_GAME_IDS]);
  if (delErr) {
    console.error(`✗ DELETE failed: ${delErr.message}`);
    process.exit(1);
  }
  console.log(`  Rows deleted: ${delCount ?? 0}`);

  // Verify post-state
  const { count: postCount } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .in("id", [...TARGET_GAME_IDS]);
  console.log(`  Rows remaining in scope: ${postCount ?? 0} (expected 0)`);

  console.log();
  console.log("APPLY complete.");
  console.log("Next step: 4.1.9.C-1c.iv — BDL ET sports-day correction, then re-run slate refresh.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
