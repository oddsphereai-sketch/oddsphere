/**
 * Phase 3.x.0d — operator backfill for first-inning pitcher stats.
 *
 * Default behavior is DRY-RUN. To execute writes you must pass BOTH:
 *   • CLI flag: --write
 *   • Env var:  FIRST_INNING_DB_WRITES_ENABLED=true
 *
 * Usage:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --player-ids 6272,6274 --season 2025
 *
 *   Write (two-key):
 *     FIRST_INNING_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --player-ids 6272,6274 --season 2025 --write
 */
import { supabase } from "../../lib/db/supabase";
import {
  searchPersonByNameDob,
  getPitcherFirstInningStats,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import {
  persistMlbPersonId,
  persistFirstInningStats,
  type PersistResult,
} from "../../lib/services/firstInningStatsWriter";
import { readBoolFlag, readStringFlag } from "./_cliCommon";

type DbPlayer = {
  id: number;
  full_name: string;
  dob: string | null;
  mlb_person_id: number | null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function formatResult(r: PersistResult): string {
  switch (r.kind) {
    case "dry_run":
      return "DRY-RUN (no DB write performed)";
    case "updated":
      return `UPDATED ${r.rows_affected} row(s)`;
    case "skipped_no_row":
      return "SKIPPED (no matching row)";
    case "skipped_conflict":
      return `SKIPPED (${r.reason})`;
    case "error":
      return `ERROR: ${r.reason}`;
  }
}

function parsePlayerIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const playerIdsRaw = readStringFlag(argv, "--player-ids");
  const seasonRaw = readStringFlag(argv, "--season");
  const writeFlag = readBoolFlag(argv, "--write");

  if (!playerIdsRaw) {
    console.error("✗ Missing required --player-ids <id1,id2,...>");
    process.exit(1);
  }
  const playerIds = parsePlayerIds(playerIdsRaw);
  if (playerIds.length === 0) {
    console.error(`✗ Could not parse any valid IDs from --player-ids "${playerIdsRaw}"`);
    process.exit(1);
  }
  const season = seasonRaw ? parseInt(seasonRaw, 10) : NaN;
  if (!Number.isFinite(season) || season < 2020 || season > 2099) {
    console.error("✗ Missing or invalid --season <YYYY>");
    process.exit(1);
  }

  // Two-key gate (inline, not _cliCommon — that helper is AUTOMODEL-specific)
  let write = false;
  if (writeFlag) {
    const envEnabled = process.env.FIRST_INNING_DB_WRITES_ENABLED === "true";
    if (!envEnabled) {
      console.error(
        "✗ --write requires FIRST_INNING_DB_WRITES_ENABLED=true in the env.\n" +
          "  Two-key gate: both the CLI flag AND the env var must be present\n" +
          "  before any DB write executes. To opt in for this command:\n\n" +
          "    FIRST_INNING_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n" +
          "      scripts/operator/backfill-first-inning-stats.ts \\\n" +
          "      --player-ids " + playerIds.join(",") + " --season " + season + " --write\n"
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(
    `[backfill-fi-stats] mode=${write ? "WRITE" : "DRY-RUN"}  season=${season}  player_ids=${playerIds.join(",")}`
  );
  console.log("─".repeat(64));

  // Read player rows from DB (read-only; no env-gate needed for reads).
  const { data: playersRaw, error: readErr } = await supabase
    .from("players")
    .select("id, full_name, dob, mlb_person_id")
    .in("id", playerIds);
  if (readErr) {
    console.error(`✗ DB read error: ${readErr.message}`);
    process.exit(1);
  }
  const players = (playersRaw as DbPlayer[] | null) ?? [];
  if (players.length === 0) {
    console.error("✗ No matching players found for the given --player-ids");
    process.exit(1);
  }
  const found = new Set(players.map((p) => p.id));
  for (const id of playerIds) {
    if (!found.has(id)) console.log(`  ! player_id=${id} not found in DB; skipping`);
  }

  for (const p of players) {
    console.log(`\n${p.full_name} (id=${p.id}, dob=${p.dob ?? "null"}, existing_mlb_id=${p.mlb_person_id ?? "null"})`);

    if (p.dob === null) {
      console.log("  ✗ player.dob is null — cannot resolve MLB Person ID safely; skipping");
      continue;
    }

    const person = await searchPersonByNameDob(p.full_name, p.dob);
    if (!person) {
      console.log("  ✗ could not resolve MLB Person ID via name+DOB match");
      continue;
    }
    console.log(`  → MLB Person ID resolved: ${person.id}`);

    const r1 = await persistMlbPersonId(p.id, person.id, { write });
    console.log(`  persistMlbPersonId: ${formatResult(r1)}`);

    await sleep(500);

    const stats = await getPitcherFirstInningStats(person.id, season);
    if (!stats) {
      console.log("  ✗ could not fetch first-inning stats from MLB Stats API");
      continue;
    }
    console.log(
      `  → FI stats: era=${stats.first_inning_era} starts=${stats.first_inning_starts} ip=${stats.first_inning_innings_pitched?.toFixed(3) ?? "null"} er=${stats.first_inning_earned_runs} r=${stats.first_inning_runs_allowed} whip=${stats.first_inning_whip}`
    );

    const r2 = await persistFirstInningStats(p.id, season, stats, { write });
    console.log(`  persistFirstInningStats: ${formatResult(r2)}`);

    await sleep(500);
  }

  console.log("\n" + "─".repeat(64));
  console.log(`mode=${write ? "WRITE" : "DRY-RUN"} complete.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
