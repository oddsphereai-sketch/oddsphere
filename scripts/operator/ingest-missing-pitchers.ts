/**
 * Phase 4.2.C.1.H-2 / H-3a — missing-pitcher player ingestion operator.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-missing-pitchers.ts --date 2026-06-03
 *
 *   Apply (two-key gate + interactive y/N + required --limit):
 *     PLAYER_INGEST_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-missing-pitchers.ts \
 *       --date 2026-06-03 --limit 1 --apply
 *
 * WRITE GATING (defense in depth, mirrors backfill-provider-mappings):
 *   1. `--apply` flag AND `PLAYER_INGEST_DB_WRITES_ENABLED=true` env
 *      must BOTH be present. Without both, the script runs dry-run.
 *   2. `--limit N` is REQUIRED in apply mode (no accidental large
 *      inserts). N must be ≥ 1; ≤ 0 is rejected.
 *   3. Interactive y/N confirmation listing the exact rows about to be
 *      inserted.
 *   4. Per-row INSERT loop — duplicates skipped via existing-row
 *      pre-flight; the partial UNIQUE index on `mlb_person_id` is the
 *      DB-level safety net if a race produces a collision.
 *
 * FLOW:
 *   1. Fetch MLB Stats `/api/v1/schedule?date=...&hydrate=probablePitcher`.
 *   2. Collect every unique probable-starter MLB person id + that
 *      pitcher's MLB Stats team id.
 *   3. Partition into already-in-DB vs missing — checks both
 *      `players.mlb_person_id` and the JSONB fallback
 *      `players.provider_ids -> mlb_stats -> id`.
 *   4. For each missing id, fetch `/people/{id}` and build a planned
 *      insert via `planPlayerInsertFromMlbProfile` (pure helper).
 *   5. Sort by `mlb_person_id` ASC for deterministic output, then
 *      truncate to `--limit` if set.
 *   6. Print per-pitcher plan table + summary.
 *   7. (apply only) y/N confirm + per-row INSERT.
 *
 * NEVER WRITES:
 *   • games.{home,away}_pitcher_id (that's the refresh-starters operator)
 *   • player_season_stats / player_splits (stats operators)
 *   • predictions / publication state / cron / env / Vercel
 *   • Existing `players` rows (insert-only; skip if row exists)
 *
 * ROW SHAPE:
 *   • `external_id = NULL` (Phase H-0 convention — MLB-only player).
 *   • `mlb_person_id = <MLB Stats id>` (top-level column + JSONB mirror).
 *   • `provider_ids.mlb_stats = { id, source, ingested_at }`.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";
import {
  fetchMlbStatsScheduleRaw,
  getPersonById,
  type MlbPersonProfile,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import {
  mlbStatsTeamIdToAbbr,
  parseMlbStatsSchedule,
  type ParsedScheduleGame,
} from "../../lib/services/starterResolver";
import {
  planPlayerInsertFromMlbProfile,
  truncatePlannedInserts,
  type PlannedPlayerInsert,
  type PlannerSkipReason,
} from "../../lib/services/missingPlayerIngestPlanner";
import {
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  todayUTC,
} from "./_cliCommon";

// ─── Internal shapes ─────────────────────────────────────────────────

interface ScheduleCandidate {
  mlbPersonId: number;
  mlbStatsTeamId: number | null;
  fullNameFromSchedule: string | null;
}

type PerCandidateOutcome =
  | { kind: "plan"; profile: MlbPersonProfile; insert: PlannedPlayerInsert }
  | { kind: "skip_existing"; reason: "mlb_person_id_in_db" | "provider_ids_mlb_stats_in_db" }
  | { kind: "skip_missing_fields"; reason: PlannerSkipReason | "profile_fetch_failed" };

interface PerCandidateRow {
  cand: ScheduleCandidate;
  outcome: PerCandidateOutcome;
}

// ─── Apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled =
    process.env.PLAYER_INGEST_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires PLAYER_INGEST_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any players INSERT.",
      "  To opt in for this command:",
      "",
      "    PLAYER_INGEST_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/ingest-missing-pitchers.ts \\",
      "      --date YYYY-MM-DD --limit N --apply",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(rows: PlannedPlayerInsert[]): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log();
    console.log(`About to INSERT ${rows.length} row(s) into players:`);
    for (const r of rows) {
      console.log(
        `  pid=${r.mlb_person_id}  ${r.full_name.padEnd(22)}  ` +
          `team_id=${r.team_id ?? "null"}  pos=${r.position_abbr ?? "—"}  ` +
          `throws=${r.throws ?? "—"}  external_id=NULL`
      );
    }
    console.log();
    const ans = await rl.question(`Continue with ${rows.length} INSERT(s)? [y/N]: `);
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  // --write is the wrong flag for this operator; clear error rather than
  // silently dry-running.
  if (process.argv.includes("--write")) {
    console.error(
      "✗ --write is not supported by this script. Use --apply (with PLAYER_INGEST_DB_WRITES_ENABLED=true)."
    );
    process.exit(1);
  }

  const gate = resolveApplyGate(process.argv);
  refuseApplyMisconfig(gate.applyRequested, gate.envEnabled);
  const writeMode = gate.canApply;

  const date = readStringFlag(process.argv, "--date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`✗ invalid --date "${date}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  // --limit is REQUIRED in apply mode to prevent accidental large
  // inserts. Dry-run accepts an optional --limit for parity / preview.
  const limit = readNumberFlag(process.argv, "--limit");
  if (writeMode) {
    if (limit === undefined) {
      console.error(
        "✗ --limit is required when --apply is set. Pass --limit 1 for a single-row smoke."
      );
      process.exit(1);
    }
    if (limit <= 0) {
      console.error(`✗ --limit must be >= 1 in apply mode (got ${limit}).`);
      process.exit(1);
    }
  }

  console.log(
    `[ingest-missing-pitchers] mode=${writeMode ? "APPLY" : "DRY-RUN"} sport=mlb date=${date}` +
      (limit !== undefined ? ` limit=${limit}` : "")
  );
  if (!writeMode) console.log(`             DRY RUN — NO DB WRITES`);
  console.log();

  // 1. Fetch + parse MLB Stats /schedule
  console.log(`Fetching MLB Stats /schedule…`);
  const raw = await fetchMlbStatsScheduleRaw(date);
  if (raw === null) {
    console.error(
      `✗ MLB Stats /schedule fetch returned null for ${date}. Aborting — without the schedule we have no candidates.`
    );
    process.exit(1);
  }
  const schedule: ParsedScheduleGame[] = parseMlbStatsSchedule(raw);
  console.log(`  parsed ${schedule.length} schedule game(s).`);

  // 2. Collect unique candidates. Dedupe by mlb_person_id; keep the
  // first-seen (game, side) so we have a stable team-id context.
  const candidatesById = new Map<number, ScheduleCandidate>();
  for (const g of schedule) {
    if (g.homeProbable !== null && !candidatesById.has(g.homeProbable.externalId)) {
      candidatesById.set(g.homeProbable.externalId, {
        mlbPersonId: g.homeProbable.externalId,
        mlbStatsTeamId: g.homeTeamId,
        fullNameFromSchedule: g.homeProbable.fullName,
      });
    }
    if (g.awayProbable !== null && !candidatesById.has(g.awayProbable.externalId)) {
      candidatesById.set(g.awayProbable.externalId, {
        mlbPersonId: g.awayProbable.externalId,
        mlbStatsTeamId: g.awayTeamId,
        fullNameFromSchedule: g.awayProbable.fullName,
      });
    }
  }
  const allCandidates = Array.from(candidatesById.values());
  console.log(`Unique probable-starter MLB person IDs: ${allCandidates.length}`);

  // 3. Partition: which mlb_person_ids are already in players?
  const allIds = allCandidates.map((c) => c.mlbPersonId);
  const existingByMlbPersonId = new Set<number>();
  if (allIds.length > 0) {
    const { data, error } = await supabase
      .from("players")
      .select("id, mlb_person_id")
      .in("mlb_person_id", allIds);
    if (error !== null) {
      console.error(`✗ players (by mlb_person_id) lookup failed: ${error.message}`);
      process.exit(1);
    }
    for (const r of (data ?? []) as Array<{ mlb_person_id: number }>) {
      existingByMlbPersonId.add(r.mlb_person_id);
    }
  }

  // 4. JSONB fallback: for ids not caught by step 3, check
  // provider_ids.mlb_stats.id. Per-id .eq() because Supabase's .in()
  // on JSONB-path filters is unreliable for arrays; N is small.
  const existingByProviderIds = new Set<number>();
  const unresolvedAfterStep3 = allIds.filter((id) => !existingByMlbPersonId.has(id));
  for (const id of unresolvedAfterStep3) {
    const { data, error } = await supabase
      .from("players")
      .select("id")
      .eq("provider_ids->mlb_stats->>id", String(id))
      .limit(1);
    if (error !== null) {
      console.error(`✗ players (provider_ids fallback) for id=${id} failed: ${error.message}`);
      process.exit(1);
    }
    if ((data ?? []).length > 0) existingByProviderIds.add(id);
  }

  // 5. Resolve team_id for each candidate's MLB Stats team id.
  // Build a single SELECT against teams by abbreviation.
  const mlbTeamIdsNeeded = new Set<number>();
  for (const c of allCandidates) {
    if (c.mlbStatsTeamId !== null) mlbTeamIdsNeeded.add(c.mlbStatsTeamId);
  }
  const abbrsNeeded = Array.from(mlbTeamIdsNeeded)
    .map((id) => mlbStatsTeamIdToAbbr(id))
    .filter((a): a is string => a !== null);
  const dbTeamIdByAbbr = new Map<string, number>();
  if (abbrsNeeded.length > 0) {
    const { data } = await supabase
      .from("teams")
      .select("id, abbreviation")
      .eq("sport", "mlb")
      .in("abbreviation", abbrsNeeded);
    for (const t of (data ?? []) as Array<{ id: number; abbreviation: string }>) {
      dbTeamIdByAbbr.set(t.abbreviation, t.id);
    }
  }

  function resolveTeamId(mlbStatsTeamId: number | null): number | null {
    if (mlbStatsTeamId === null) return null;
    const abbr = mlbStatsTeamIdToAbbr(mlbStatsTeamId);
    if (abbr === null) return null;
    return dbTeamIdByAbbr.get(abbr) ?? null;
  }

  // 6. For each candidate: skip-existing or fetch /people/{id} and plan.
  const ingestedAtIso = new Date().toISOString();
  const rows: PerCandidateRow[] = [];
  for (const cand of allCandidates) {
    if (existingByMlbPersonId.has(cand.mlbPersonId)) {
      rows.push({
        cand,
        outcome: { kind: "skip_existing", reason: "mlb_person_id_in_db" },
      });
      continue;
    }
    if (existingByProviderIds.has(cand.mlbPersonId)) {
      rows.push({
        cand,
        outcome: { kind: "skip_existing", reason: "provider_ids_mlb_stats_in_db" },
      });
      continue;
    }

    const profile = await getPersonById(cand.mlbPersonId);
    if (profile === null) {
      rows.push({
        cand,
        outcome: { kind: "skip_missing_fields", reason: "profile_fetch_failed" },
      });
      continue;
    }

    const teamId = resolveTeamId(cand.mlbStatsTeamId);
    const planned = planPlayerInsertFromMlbProfile(profile, {
      teamId,
      ingestedAtIso,
    });
    if (planned.kind === "skip") {
      rows.push({
        cand,
        outcome: { kind: "skip_missing_fields", reason: planned.reason },
      });
    } else {
      rows.push({
        cand,
        outcome: { kind: "plan", profile, insert: planned.insert },
      });
    }
  }

  // 7. Sort planned rows deterministically (by mlb_person_id ASC) and
  // apply --limit truncation. Sorting is essential so re-running with
  // the same --limit always picks the same rows.
  const allPlanned = rows
    .filter((r): r is PerCandidateRow & { outcome: { kind: "plan"; insert: PlannedPlayerInsert } } =>
      r.outcome.kind === "plan"
    )
    .sort((a, b) => a.cand.mlbPersonId - b.cand.mlbPersonId);
  const plannedAfterLimit = truncatePlannedInserts(allPlanned, limit);
  const skippedExisting = rows.filter((r) => r.outcome.kind === "skip_existing");
  const skippedMissing = rows.filter((r) => r.outcome.kind === "skip_missing_fields");
  const plannedHeldByLimit = allPlanned.length - plannedAfterLimit.length;

  console.log();
  console.log(
    `━━━ Planned inserts (${plannedAfterLimit.length}` +
      (plannedHeldByLimit > 0
        ? ` — of ${allPlanned.length} total, ${plannedHeldByLimit} held by --limit ${limit}`
        : "") +
      `) ━━━`
  );
  if (plannedAfterLimit.length === 0 && allPlanned.length === 0) {
    console.log("  (none — every probable starter is already in players)");
  }
  for (const r of plannedAfterLimit) {
    const i = r.outcome.insert;
    console.log(
      `  pid=${r.cand.mlbPersonId}  ${i.full_name.padEnd(22)} ` +
        `dob=${i.dob ?? "—"} pos=${i.position_abbr ?? "—"} ` +
        `throws=${i.throws ?? "—"} bats=${i.bats ?? "—"} ` +
        `team_id=${i.team_id ?? "null"} active=${i.active}`
    );
    console.log(
      `     external_id=NULL  provider_ids.mlb_stats={ id:${i.provider_ids.mlb_stats.id}, ` +
        `source:"${i.provider_ids.mlb_stats.source}", ingested_at:"${i.provider_ids.mlb_stats.ingested_at}" }`
    );
  }

  console.log();
  console.log(`━━━ Skipped — already in players (${skippedExisting.length}) ━━━`);
  for (const r of skippedExisting) {
    if (r.outcome.kind !== "skip_existing") continue;
    console.log(
      `  pid=${r.cand.mlbPersonId}  (${r.outcome.reason})` +
        `  ${r.cand.fullNameFromSchedule ?? ""}`
    );
  }

  if (skippedMissing.length > 0) {
    console.log();
    console.log(`━━━ Skipped — missing required fields (${skippedMissing.length}) ━━━`);
    for (const r of skippedMissing) {
      if (r.outcome.kind !== "skip_missing_fields") continue;
      console.log(
        `  pid=${r.cand.mlbPersonId}  reason=${r.outcome.reason}` +
          `  ${r.cand.fullNameFromSchedule ?? ""}`
      );
    }
  }

  // 8. Summary
  const teamIdAssigned = plannedAfterLimit.filter(
    (r) => r.outcome.insert.team_id !== null
  ).length;

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  Unique probable-starter MLB person IDs:   ${allCandidates.length}`);
  console.log(`  Planned inserts (total, pre-limit):        ${allPlanned.length}`);
  if (limit !== undefined) {
    console.log(`  Planned inserts (after --limit ${limit}):       ${plannedAfterLimit.length}`);
  }
  console.log(`  Skipped (already in players):              ${skippedExisting.length}`);
  console.log(`  Skipped (missing required fields):         ${skippedMissing.length}`);
  if (plannedAfterLimit.length > 0) {
    console.log(`  team_id assigned: ${teamIdAssigned} of ${plannedAfterLimit.length}`);
  }
  console.log(`  MLB Stats API calls used: ` +
    `1 (/schedule) + ${allPlanned.length + skippedMissing.length} (/people)`);
  console.log();

  // 9. Dry-run exit OR apply path.
  if (!writeMode) {
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    if (gate.applyRequested && !gate.envEnabled) {
      // unreachable — refuseApplyMisconfig already exited — but keeps
      // the intent explicit if a future refactor reorders the gates.
      console.log("  (--apply was set but env gate missing; would have refused.)");
    }
    return;
  }

  if (plannedAfterLimit.length === 0) {
    console.log("  Nothing to insert (post-limit). Exiting without writes.");
    return;
  }

  // ── APPLY: confirm + per-row INSERT ──────────────────────────────────
  const confirmed = await confirmApply(plannedAfterLimit.map((r) => r.outcome.insert));
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing INSERT(s)…");
  let wrote = 0;
  let errored = 0;
  for (const r of plannedAfterLimit) {
    const ins = r.outcome.insert;
    const { error } = await supabase.from("players").insert(ins);
    if (error !== null) {
      errored++;
      console.error(
        `  ✗ INSERT failed for pid=${ins.mlb_person_id} (${ins.full_name}): ${error.message}`
      );
      continue;
    }
    wrote++;
    console.log(`  ✓ INSERTed pid=${ins.mlb_person_id}  ${ins.full_name}`);
  }

  console.log();
  console.log(`━━━ Apply complete ━━━`);
  console.log(`  Rows inserted: ${wrote}`);
  console.log(`  Rows errored:  ${errored}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
