/**
 * Phase 4.2.C.1.M-manual — operator script to map the 3 players whose
 * DB DOB is wrong, blocking the regular name+DOB-driven matcher.
 *
 * SCOPE (tightly limited):
 *   • Hardcoded 3 mappings only — Wyatt Langford, Elly De La Cruz,
 *     Davis Martin.
 *   • Writes ONLY `players.provider_ids` (the same JSONB the main
 *     operator writes), using the same read-then-merge `writeMapping`.
 *   • Does NOT modify players.dob, players.external_id, or any other
 *     column.
 *   • Does NOT touch stats, predictions, games, or any other table.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/manual-map-provider-ids.ts
 *
 *   Apply (TWO-key gate + interactive y/N):
 *     PROVIDER_MAPPING_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/manual-map-provider-ids.ts --apply
 *
 * SAFETY CHECKS:
 *   • Verifies each row exists in DB.
 *   • Verifies DB full_name matches the expected name (mismatch ⇒ abort).
 *   • If the row already has `provider_ids.bdl` or `provider_ids.mlb_stats`,
 *     the script compares against the intended IDs and refuses to
 *     proceed on disagreement.
 *   • Re-running this script after a successful apply is a no-op for
 *     the same 3 rows (writeMapping merge is idempotent when target
 *     IDs match).
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";
import {
  buildMlbStatsBlock,
  writeMapping,
} from "../../lib/services/providerMappingService";

// ─── Hardcoded mappings ───────────────────────────────────────────────

const MAPPING_METHOD = "manual_wrong_db_dob_v1";

type ManualMapping = {
  player_id: number;
  expected_full_name: string;
  mlb_stats_id: number;
  bdl_id: number;
  bdl_full_name: string; // for the `name` field in the bdl block
  note: string;          // why this needed manual override
};

const MAPPINGS: ManualMapping[] = [
  {
    player_id: 6243,
    expected_full_name: "Wyatt Langford",
    mlb_stats_id: 694671,
    bdl_id: 268,
    bdl_full_name: "Wyatt Langford",
    note: "DB dob=2001-11-30, MLB+BDL agree on 2001-11-15",
  },
  {
    player_id: 6264,
    expected_full_name: "Elly De La Cruz",
    mlb_stats_id: 682829,
    bdl_id: 745,
    bdl_full_name: "Elly De La Cruz",
    note: "DB dob=2001-12-11, MLB+BDL agree on 2002-01-11",
  },
  {
    player_id: 6277,
    expected_full_name: "Davis Martin",
    mlb_stats_id: 663436,
    bdl_id: 618,
    bdl_full_name: "Davis Martin",
    note: "DB dob=1997-04-04, MLB+BDL agree on 1997-01-04",
  },
];

// ─── apply gate (mirrors backfill-provider-mappings.ts pattern) ──────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = argv.includes("--apply");
  const envEnabled =
    process.env.PROVIDER_MAPPING_DB_WRITES_ENABLED === "true";
  return {
    applyRequested,
    envEnabled,
    canApply: applyRequested && envEnabled,
  };
}

function refuseApplyMisconfig(applyRequested: boolean, envEnabled: boolean): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires PROVIDER_MAPPING_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any provider_ids UPDATE.",
      "",
      "    PROVIDER_MAPPING_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/manual-map-provider-ids.ts --apply",
    ].join("\n")
  );
  process.exit(1);
}

// ─── manual block builder (inline; not in providerMappingService) ────

function buildManualBdlBlock(
  bdlId: number,
  bdlName: string,
  now: Date = new Date()
): {
  id: number;
  name: string;
  mapped_via: string;
  confidence: "high";
  mapped_at: string;
} {
  return {
    id: bdlId,
    name: bdlName,
    mapped_via: MAPPING_METHOD,
    confidence: "high",
    mapped_at: now.toISOString(),
  };
}

// ─── per-row inspection ───────────────────────────────────────────────

type RowCheck = {
  mapping: ManualMapping;
  db_row: { id: number; full_name: string; provider_ids: Record<string, unknown> | null } | null;
  full_name_ok: boolean;
  existing_bdl_id: number | null;
  existing_mlb_stats_id: number | null;
  conflict: string | null; // populated if existing provider_ids disagrees
};

async function inspectRows(): Promise<RowCheck[]> {
  const ids = MAPPINGS.map((m) => m.player_id);
  const { data, error } = await supabase
    .from("players")
    .select("id, full_name, provider_ids")
    .in("id", ids);
  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }
  const byId = new Map(
    (data ?? []).map((r) => [r.id as number, r as { id: number; full_name: string; provider_ids: Record<string, unknown> | null }])
  );
  const out: RowCheck[] = [];
  for (const mapping of MAPPINGS) {
    const row = byId.get(mapping.player_id) ?? null;
    let full_name_ok = false;
    let existingBdlId: number | null = null;
    let existingMlbStatsId: number | null = null;
    let conflict: string | null = null;
    if (row !== null) {
      full_name_ok = row.full_name === mapping.expected_full_name;
      if (!full_name_ok) {
        conflict = `db full_name "${row.full_name}" !== expected "${mapping.expected_full_name}"`;
      }
      const pi = (row.provider_ids ?? {}) as Record<string, unknown>;
      const bdl = pi.bdl as { id?: number } | undefined;
      const mlbStats = pi.mlb_stats as { id?: number } | undefined;
      if (typeof bdl?.id === "number") existingBdlId = bdl.id;
      if (typeof mlbStats?.id === "number") existingMlbStatsId = mlbStats.id;
      // Refuse if existing IDs disagree with intended
      if (
        existingBdlId !== null &&
        existingBdlId !== mapping.bdl_id
      ) {
        conflict =
          (conflict !== null ? conflict + "; " : "") +
          `existing provider_ids.bdl.id=${existingBdlId} !== intended ${mapping.bdl_id}`;
      }
      if (
        existingMlbStatsId !== null &&
        existingMlbStatsId !== mapping.mlb_stats_id
      ) {
        conflict =
          (conflict !== null ? conflict + "; " : "") +
          `existing provider_ids.mlb_stats.id=${existingMlbStatsId} !== intended ${mapping.mlb_stats_id}`;
      }
    } else {
      conflict = `player_id=${mapping.player_id} not found in DB`;
    }
    out.push({
      mapping,
      db_row: row,
      full_name_ok,
      existing_bdl_id: existingBdlId,
      existing_mlb_stats_id: existingMlbStatsId,
      conflict,
    });
  }
  return out;
}

// ─── confirmation ─────────────────────────────────────────────────────

async function confirmApply(plannedWrites: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UPDATE players.provider_ids for ${plannedWrites} row(s).\n` +
        `  Each UPDATE writes provider_ids = (existing_keys ∪ { mlb_stats, bdl }).\n` +
        `  No other columns are touched. mapped_via="${MAPPING_METHOD}".\n` +
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
  const gate = resolveApplyGate(argv);
  refuseApplyMisconfig(gate.applyRequested, gate.envEnabled);
  const writeMode = gate.canApply;

  console.log(
    `[manual-map-provider-ids] mode=${writeMode ? "APPLY" : "DRY-RUN"}`
  );
  if (!writeMode) {
    console.log("             DRY RUN — NO DB WRITES");
  }

  console.log();
  console.log(`━━━ Hardcoded mappings (${MAPPINGS.length}) ━━━`);
  for (const m of MAPPINGS) {
    console.log(
      `  player_id=${m.player_id} ${m.expected_full_name.padEnd(20)}` +
        ` → mlb_stats.id=${m.mlb_stats_id}  bdl.id=${m.bdl_id}` +
        `\n     note: ${m.note}`
    );
  }

  console.log();
  console.log("━━━ Inspecting DB rows ━━━");
  const checks = await inspectRows();
  for (const c of checks) {
    if (c.db_row === null) {
      console.log(`  ✗ player_id=${c.mapping.player_id} — NOT FOUND in DB`);
      continue;
    }
    console.log(
      `  player_id=${c.db_row.id} db_full_name="${c.db_row.full_name}"` +
        ` full_name_ok=${c.full_name_ok}` +
        ` existing_bdl=${c.existing_bdl_id ?? "—"}` +
        ` existing_mlb=${c.existing_mlb_stats_id ?? "—"}`
    );
    if (c.conflict !== null) {
      console.log(`     ⚠ conflict: ${c.conflict}`);
    }
  }

  const conflicts = checks.filter((c) => c.conflict !== null);
  if (conflicts.length > 0) {
    console.log();
    console.log(`✗ Aborting: ${conflicts.length} row(s) have conflicts.`);
    console.log("  Fix the conflict source before re-running.");
    process.exit(1);
  }

  console.log();
  console.log("━━━ Plan ━━━");
  console.log(`  ${MAPPINGS.length} rows to UPDATE.`);
  console.log(`  Each row's provider_ids will gain:`);
  console.log(`    mlb_stats = { id, last_seen_at }`);
  console.log(`    bdl       = { id, name, mapped_via: "${MAPPING_METHOD}", confidence: "high", mapped_at }`);
  console.log(`  Existing keys in provider_ids (if any) are preserved (read-then-merge).`);
  console.log(`  players.dob, players.external_id, players.mlb_person_id are NOT touched.`);

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    console.log(`  Would write ${MAPPINGS.length} provider_ids updates.`);
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    console.log();
    console.log("  To apply (with explicit env flag):");
    console.log("    PROVIDER_MAPPING_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\");
    console.log("      scripts/operator/manual-map-provider-ids.ts --apply");
    return;
  }

  // ── APPLY: confirm + write ──────────────────────────────────────────
  const confirmed = await confirmApply(MAPPINGS.length);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing provider_ids updates…");
  const now = new Date();
  let written = 0;
  let errors = 0;
  for (const m of MAPPINGS) {
    const proposed: Record<string, unknown> = {
      mlb_stats: buildMlbStatsBlock(m.mlb_stats_id, now),
      bdl: buildManualBdlBlock(m.bdl_id, m.bdl_full_name, now),
    };
    try {
      await writeMapping(supabase, m.player_id, proposed);
      written++;
      console.log(
        `  ✓ player_id=${m.player_id} ${m.expected_full_name} → mlb=${m.mlb_stats_id}, bdl=${m.bdl_id}`
      );
    } catch (e) {
      errors++;
      console.error(
        `  ✗ player_id=${m.player_id} ${m.expected_full_name}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  console.log();
  console.log("━━━ Apply complete ━━━");
  console.log(`  Rows updated:     ${written}`);
  console.log(`  Errors:           ${errors}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
