/**
 * Phase 4.2.C.1.H-2 — DRY-RUN missing-pitcher player ingestion operator.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/ingest-missing-pitchers.ts --date 2026-06-03
 *
 * READ-ONLY by design. Phase H-3 will add the two-key write path
 * (`PLAYER_INGEST_DB_WRITES_ENABLED=true` + `--apply`); until then,
 * `--write` is rejected at the CLI surface.
 *
 * FLOW:
 *   1. Fetch MLB Stats `/api/v1/schedule?date=...&hydrate=probablePitcher`.
 *   2. Collect every unique probable-starter MLB person id + that
 *      pitcher's MLB Stats team id (which we'll use for team_id
 *      enrichment).
 *   3. Partition into already-in-DB vs missing — checks both
 *      `players.mlb_person_id` and the JSONB fallback
 *      `players.provider_ids -> mlb_stats -> id`.
 *   4. For each missing id, fetch `/people/{id}` and build a planned
 *      insert via `planPlayerInsertFromMlbProfile` (pure helper).
 *   5. Print a per-pitcher plan table + summary.
 *
 * SAFETY:
 *   • No DB writes — every Supabase call is SELECT.
 *   • `--write` rejected via `rejectWriteFlag`.
 *   • No starter / stats / prediction writes; no publish / hide / unlock;
 *     no cron / env / Vercel changes.
 *
 * The H-3 phase will reuse the planner output verbatim — keep the row
 * shape stable.
 */

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
  type PlannedPlayerInsert,
  type PlannerSkipReason,
} from "../../lib/services/missingPlayerIngestPlanner";
import { readStringFlag, rejectWriteFlag, todayUTC } from "./_cliCommon";

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

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  rejectWriteFlag(process.argv);

  const date = readStringFlag(process.argv, "--date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`✗ invalid --date "${date}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  console.log(
    `[ingest-missing-pitchers] mode=DRY-RUN sport=mlb date=${date}`
  );
  console.log(`             DRY RUN — NO DB WRITES`);
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

  // 7. Print per-candidate output, grouped.
  const planned = rows.filter((r) => r.outcome.kind === "plan");
  const skippedExisting = rows.filter((r) => r.outcome.kind === "skip_existing");
  const skippedMissing = rows.filter((r) => r.outcome.kind === "skip_missing_fields");

  console.log();
  console.log(`━━━ Planned inserts (${planned.length}) ━━━`);
  if (planned.length === 0) {
    console.log("  (none — every probable starter is already in players)");
  }
  for (const r of planned) {
    if (r.outcome.kind !== "plan") continue;
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
  const teamIdAssigned = planned.filter(
    (r) => r.outcome.kind === "plan" && r.outcome.insert.team_id !== null
  ).length;

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  Unique probable-starter MLB person IDs:   ${allCandidates.length}`);
  console.log(`  Planned inserts:                           ${planned.length}`);
  console.log(`  Skipped (already in players):              ${skippedExisting.length}`);
  console.log(`  Skipped (missing required fields):         ${skippedMissing.length}`);
  if (planned.length > 0) {
    console.log(`  team_id assigned: ${teamIdAssigned} of ${planned.length}`);
  }
  console.log(`  MLB Stats API calls used: ` +
    `1 (/schedule) + ${planned.length + skippedMissing.length} (/people)`);
  console.log();
  console.log("  DRY RUN — NO DB WRITES PERFORMED.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
