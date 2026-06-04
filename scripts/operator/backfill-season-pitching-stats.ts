/**
 * Phase 4.2.C.1.R-11 — operator backfill for season-level pitching
 * stats (ERA / WHIP / IP / K / BB / W-L / GP / GS).
 *
 * USAGE:
 *   Per-player (explicit ids — requires --season):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-season-pitching-stats.ts \
 *       --player-ids 6287,6289 --season 2026 [--write]
 *
 *   Slate-date (defaults --season from slate year — H-6.3b resolver):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-season-pitching-stats.ts \
 *       --slate-date 2026-06-04 [--season 2026] [--write]
 *
 *   Skip-existing variant (only INSERT rows that don't exist yet):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-season-pitching-stats.ts \
 *       --slate-date 2026-06-04 --no-overwrite-existing [--write]
 *
 *   Explicit season mismatch override (rare):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-season-pitching-stats.ts \
 *       --slate-date 2026-06-04 --season 2025 --allow-season-mismatch [--write]
 *
 * GATING — writes require BOTH:
 *   • CLI flag: --write
 *   • Env var:  SEASON_PITCHING_DB_WRITES_ENABLED=true
 * Slate-date mode prompts interactive y/N before writes; per-player
 * mode doesn't (id list is already explicit).
 *
 * SCOPE:
 *   • Reads:  players, player_season_stats (existence + nulled-guard),
 *             games (slate starter resolution), MLB Stats API
 *   • Writes: player_season_stats — ONLY the season-level pitching_*
 *             columns + updated_at. NEVER touches first_inning_*
 *             columns. PostgREST UPSERT semantics preserve any FI
 *             values on existing rows.
 *   • Never writes: predictions / games / lines / sharp_signals /
 *             slate_status / schema / cron / env.
 *
 * NULLED-SEASON GUARD: matches the FI backfill behavior. Rows where
 * pitching_ip + pitching_era + pitching_k + batting_ab are ALL null
 * (the Cole-style cleanup signature) are skipped — refusing to
 * repopulate a deliberately-nulled row.
 *
 * EXPECTED DRY-RUN FOR 2026-06-04 (as of audit):
 *   • 15 INSERT — the H-3a missing-pitcher cohort (no row in DB)
 *   • 2 UPDATE — Wheeler + Imanaga (existing 2026 rows, stale stats)
 *   • 1 SKIP   — TOR @ ATL away (no probable starter set; not a row to write)
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";
import {
  searchPersonByNameDob,
  getPitcherSeasonStats,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import {
  persistSeasonPitchingStats,
  SEASON_PITCHING_WRITE_ENV_FLAG,
  type PersistResult as SeasonPersistResult,
} from "../../lib/services/seasonPitchingStatsWriter";
import {
  persistMlbPersonId,
  type PersistResult as FiPersistResult,
} from "../../lib/services/firstInningStatsWriter";

/** Discriminated union covering the kinds emitted by both writers. */
type AnyPersistResult = FiPersistResult | SeasonPersistResult;
import {
  dedupePlayerIds,
  loadSlateStarterPlayerIds,
  resolveMlbStatsIdFromDbRow,
  type IdResolution,
  type MlbStatsIdSource,
} from "../../lib/services/firstInningResolver";
import { resolveOperatorSeason } from "../../lib/services/firstInningSeasonResolver";
import { readBoolFlag, readStringFlag } from "./_cliCommon";

type DbPlayer = {
  id: number;
  full_name: string;
  dob: string | null;
  mlb_person_id: number | null;
  provider_ids: Record<string, unknown> | null;
};

type SeasonRowGuard = {
  player_id: number;
  pitching_ip: number | null;
  pitching_era: number | null;
  pitching_k: number | null;
  batting_ab: number | null;
  /** R-11: included so the cleanup-signature check can distinguish
   * a true Cole-style cleanup row (FI also null) from an FI-only row
   * left behind by the R-2 step 5 FI backfill (FI populated, season
   * pitching columns still null). */
  first_inning_era: number | null;
};

/**
 * R-11 5-field cleanup signature — same logic the writer uses
 * internally. Pre-check here so the operator's planning output
 * (INSERT vs UPDATE vs SKIP_NULLED) matches what the writer will
 * actually do at write time.
 */
function isFullyNulledCleanupRow(row: SeasonRowGuard | undefined): boolean {
  if (row === undefined) return false;
  return (
    row.pitching_ip === null &&
    row.pitching_era === null &&
    row.pitching_k === null &&
    row.batting_ab === null &&
    row.first_inning_era === null
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function formatResult(r: AnyPersistResult): string {
  switch (r.kind) {
    case "dry_run":
      return "DRY-RUN (no DB write performed)";
    case "updated":
      return `UPSERTed ${r.rows_affected} row(s)`;
    case "skipped_no_row":
      return "SKIPPED (no matching row)";
    case "skipped_empty":
      return `SKIPPED (${r.reason})`;
    case "skipped_nulled_cleanup":
      return `SKIPPED (${r.reason})`;
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

function sourceLabel(source: MlbStatsIdSource): string {
  switch (source) {
    case "provider_ids_mlb_stats":
      return "provider_ids.mlb_stats.id";
    case "players_mlb_person_id":
      return "players.mlb_person_id";
    case "name_dob_search":
      return "name+DOB search";
  }
}

async function loadPlayers(playerIds: number[]): Promise<DbPlayer[]> {
  const { data, error } = await supabase
    .from("players")
    .select("id, full_name, dob, mlb_person_id, provider_ids")
    .in("id", playerIds);
  if (error !== null) throw new Error(`load players failed: ${error.message}`);
  return ((data as unknown) ?? []) as DbPlayer[];
}

async function loadSeasonRows(
  playerIds: number[],
  season: number
): Promise<Map<number, SeasonRowGuard>> {
  const { data, error } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_ip, pitching_era, pitching_k, batting_ab, first_inning_era")
    .in("player_id", playerIds)
    .eq("season", season)
    .eq("season_type", "regular");
  if (error !== null) throw new Error(`load season rows failed: ${error.message}`);
  const out = new Map<number, SeasonRowGuard>();
  for (const r of ((data as unknown) ?? []) as SeasonRowGuard[]) out.set(r.player_id, r);
  return out;
}

async function confirmSlateApply(
  starters: Array<{ id: number; full_name: string; willInsert: boolean }>
): Promise<boolean> {
  const inserts = starters.filter((s) => s.willInsert);
  const updates = starters.filter((s) => !s.willInsert);
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `\nAbout to refresh season pitching stats for ${starters.length} starter(s):\n\n` +
        `  INSERTs (${inserts.length} — no existing 2026 row):\n` +
        inserts.map((s) => `    • player_id=${s.id}  ${s.full_name}`).join("\n") +
        (inserts.length === 0 ? "    (none)" : "") +
        `\n\n  UPDATEs (${updates.length} — refresh existing row, season-cols only):\n` +
        updates.map((s) => `    • player_id=${s.id}  ${s.full_name}`).join("\n") +
        (updates.length === 0 ? "    (none)" : "") +
        `\n\n  Scope: pitching_* season columns + updated_at only.\n` +
        `  first_inning_* columns are NEVER included in the payload.\n` +
        `  Existing FI data on UPDATE rows is preserved by PostgREST.\n` +
        `  Cole-style nulled-cleanup rows are skipped.\n` +
        `\n  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const playerIdsRaw = readStringFlag(argv, "--player-ids");
  const slateDateRaw = readStringFlag(argv, "--slate-date");
  const seasonRaw = readStringFlag(argv, "--season");
  const writeFlag = readBoolFlag(argv, "--write");
  const allowSeasonMismatch = readBoolFlag(argv, "--allow-season-mismatch");
  const noOverwriteExisting = readBoolFlag(argv, "--no-overwrite-existing");

  if (playerIdsRaw === undefined && slateDateRaw === undefined) {
    console.error(
      "✗ Missing input: pass either --player-ids <id1,id2,...> OR --slate-date <YYYY-MM-DD>"
    );
    process.exit(1);
  }
  if (playerIdsRaw !== undefined && slateDateRaw !== undefined) {
    console.error("✗ Mutually exclusive: pass --player-ids OR --slate-date, not both");
    process.exit(1);
  }

  const seasonResolution = resolveOperatorSeason({
    slateDate: slateDateRaw,
    seasonFlag: seasonRaw,
    allowMismatch: allowSeasonMismatch,
  });
  if (seasonResolution.kind === "error") {
    console.error(`✗ ${seasonResolution.message}`);
    process.exit(1);
  }
  const season = seasonResolution.season;
  const seasonSource = seasonResolution.source;

  // Two-key write gate
  let write = false;
  if (writeFlag) {
    const envEnabled = process.env[SEASON_PITCHING_WRITE_ENV_FLAG] === "true";
    if (!envEnabled) {
      console.error(
        `✗ --write requires ${SEASON_PITCHING_WRITE_ENV_FLAG}=true in the env.\n` +
          `  Two-key gate: both the CLI flag AND the env var must be present\n` +
          `  before any DB write executes.`
      );
      process.exit(1);
    }
    write = true;
  }

  const mode = slateDateRaw !== undefined ? "slate-date" : "player-ids";
  const targetLabel =
    mode === "slate-date" ? `slate=${slateDateRaw}` : `player_ids=${playerIdsRaw}`;
  console.log(
    `[backfill-season-pitching] mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  season=${season} (${seasonSource})  ${targetLabel}  no_overwrite_existing=${noOverwriteExisting}`
  );
  console.log("─".repeat(72));

  // Resolve player_ids
  let playerIds: number[];
  if (slateDateRaw !== undefined) {
    playerIds = await loadSlateStarterPlayerIds(supabase, slateDateRaw);
    console.log(
      `Resolved ${playerIds.length} unique starter player_id(s) from games (slate_date=${slateDateRaw})`
    );
  } else {
    playerIds = dedupePlayerIds(parsePlayerIds(playerIdsRaw!));
    if (playerIds.length === 0) {
      console.error(`✗ Could not parse any valid IDs from --player-ids "${playerIdsRaw}"`);
      process.exit(1);
    }
    console.log(`Caller-provided ${playerIds.length} player_id(s) after dedupe`);
  }
  if (playerIds.length === 0) {
    console.log("(no player_ids resolved — exiting)");
    return;
  }

  const players = await loadPlayers(playerIds);
  const playerById = new Map<number, DbPlayer>(players.map((p) => [p.id, p]));
  const found = new Set(players.map((p) => p.id));
  for (const id of playerIds) {
    if (!found.has(id)) console.log(`  ! player_id=${id} not found in DB; skipping`);
  }

  const existingRows = await loadSeasonRows(playerIds, season);

  // Categorize each player as INSERT (no row), UPDATE (row exists), or
  // SKIP (no-overwrite flag + row exists, OR nulled-cleanup row).
  type Plan = { player: DbPlayer; action: "insert" | "update" | "skip_no_overwrite" | "skip_nulled" };
  const plans: Plan[] = [];
  for (const p of players) {
    const seasonRow = existingRows.get(p.id);
    if (isFullyNulledCleanupRow(seasonRow)) {
      // 5-field signature — pitching_* + batting_ab + first_inning_era
      // ALL null. Distinguishes true Cole-cleanup from an FI-only row.
      plans.push({ player: p, action: "skip_nulled" });
    } else if (seasonRow === undefined) {
      plans.push({ player: p, action: "insert" });
    } else if (noOverwriteExisting) {
      plans.push({ player: p, action: "skip_no_overwrite" });
    } else {
      // Either a complete row (Wheeler/Imanaga) OR an FI-only row
      // (the 15 H-3a pitchers). Both are valid update targets — the
      // writer's UPSERT touches season columns only and preserves
      // first_inning_* fields when present.
      plans.push({ player: p, action: "update" });
    }
  }

  console.log("\n━━━ Plan ━━━");
  const inserts = plans.filter((p) => p.action === "insert");
  const updates = plans.filter((p) => p.action === "update");
  const skipsNo = plans.filter((p) => p.action === "skip_no_overwrite");
  const skipsNulled = plans.filter((p) => p.action === "skip_nulled");
  console.log(`  INSERT (no existing 2026 row):           ${inserts.length}`);
  for (const pl of inserts) console.log(`    • pid=${pl.player.id}  ${pl.player.full_name}`);
  console.log(`  UPDATE (existing row, season-cols only): ${updates.length}`);
  for (const pl of updates) console.log(`    • pid=${pl.player.id}  ${pl.player.full_name}`);
  if (skipsNo.length > 0) {
    console.log(`  SKIP (--no-overwrite-existing):          ${skipsNo.length}`);
    for (const pl of skipsNo) console.log(`    • pid=${pl.player.id}  ${pl.player.full_name}`);
  }
  if (skipsNulled.length > 0) {
    console.log(`  SKIP (nulled-cleanup row):               ${skipsNulled.length}`);
    for (const pl of skipsNulled) console.log(`    • pid=${pl.player.id}  ${pl.player.full_name}`);
  }

  if (mode === "slate-date" && write) {
    const startersForPrompt = plans
      .filter((p) => p.action === "insert" || p.action === "update")
      .map((p) => ({ id: p.player.id, full_name: p.player.full_name, willInsert: p.action === "insert" }));
    const confirmed = await confirmSlateApply(startersForPrompt);
    if (!confirmed) {
      console.log("Cancelled by operator. No writes performed.");
      return;
    }
  }

  // Process each player
  let countSourceProvider = 0;
  let countSourceMlbPersonId = 0;
  let countSourceNameDob = 0;
  let countInsertedOrUpdated = 0;
  let countDryRun = 0;
  let countSkippedEmpty = 0;
  let countSkippedNulled = 0;
  let countSkippedNoOverwrite = 0;
  let countSkippedMissingDob = 0;
  let countErrors = 0;
  let mlbApiCalls = 0;

  for (const pl of plans) {
    const p = pl.player;
    console.log(
      `\n${p.full_name} (player_id=${p.id}, dob=${p.dob ?? "null"}, existing_mlb_person_id=${p.mlb_person_id ?? "null"})  → planned=${pl.action}`
    );

    if (pl.action === "skip_nulled") {
      console.log("  ⏭  SKIPPED (nulled-cleanup row; refusing to repopulate)");
      countSkippedNulled++;
      continue;
    }
    if (pl.action === "skip_no_overwrite") {
      console.log("  ⏭  SKIPPED (--no-overwrite-existing; row already present)");
      countSkippedNoOverwrite++;
      continue;
    }

    const initialResolution: IdResolution = resolveMlbStatsIdFromDbRow(p);
    let mlbId: number | null = null;
    let source: MlbStatsIdSource;
    if (initialResolution.kind === "ok") {
      mlbId = initialResolution.mlbId;
      source = initialResolution.source;
      if (source === "provider_ids_mlb_stats") countSourceProvider++;
      else if (source === "players_mlb_person_id") countSourceMlbPersonId++;
    } else if (initialResolution.kind === "skip") {
      console.log("  ⏭  SKIPPED (missing dob — cannot resolve via name+DOB)");
      countSkippedMissingDob++;
      continue;
    } else {
      const person = await searchPersonByNameDob(p.full_name, p.dob!);
      mlbApiCalls++;
      if (person === null) {
        console.log("  ✗  ID resolution failed (no MLB Person via name+DOB search)");
        countErrors++;
        continue;
      }
      mlbId = person.id;
      source = "name_dob_search";
      countSourceNameDob++;
    }
    console.log(`  → MLB Person ID = ${mlbId}  [source: ${sourceLabel(source)}]`);

    // Persist mlb_person_id back to players if needed (reuses FI writer's
    // defensive helper; refuses to overwrite a different existing value).
    const r1 = await persistMlbPersonId(p.id, mlbId, { write });
    console.log(`  persistMlbPersonId: ${formatResult(r1)}`);

    await sleep(500);

    const stats = await getPitcherSeasonStats(mlbId, season);
    mlbApiCalls++;
    if (stats === null) {
      console.log("  ✗  could not fetch season stats from MLB Stats API");
      countErrors++;
      continue;
    }
    if (stats.raw_source === "empty") {
      console.log("  ⏭  empty MLB Stats response (no 2026 aggregate) — skipping");
      countSkippedEmpty++;
      continue;
    }
    console.log(
      `  → SEASON: g=${stats.games_played} gs=${stats.games_started} w-l=${stats.wins}-${stats.losses}` +
        ` ip=${stats.innings_pitched?.toFixed(3) ?? "null"}` +
        ` era=${stats.era ?? "null"} whip=${stats.whip ?? "null"}` +
        ` k=${stats.strikeouts} bb=${stats.walks}` +
        ` k9=${stats.strikeouts_per_9?.toFixed(2) ?? "null"}`
    );

    const r2 = await persistSeasonPitchingStats(p.id, season, stats, { write });
    console.log(`  persistSeasonPitchingStats: ${formatResult(r2)}`);
    if (r2.kind === "updated") countInsertedOrUpdated++;
    else if (r2.kind === "dry_run") countDryRun++;
    else if (r2.kind === "skipped_empty") countSkippedEmpty++;
    else if (r2.kind === "skipped_nulled_cleanup") countSkippedNulled++;
    else if (r2.kind === "error") countErrors++;

    await sleep(500);
  }

  console.log("\n" + "─".repeat(72));
  console.log(`mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  complete.`);
  console.log("\nID-resolution sources:");
  console.log(`  provider_ids.mlb_stats.id : ${countSourceProvider}`);
  console.log(`  players.mlb_person_id     : ${countSourceMlbPersonId}`);
  console.log(`  name+DOB search           : ${countSourceNameDob}`);
  console.log("\nDispositions:");
  console.log(`  ${write ? "Written" : "Would write (dry-run)"}: ${write ? countInsertedOrUpdated : countDryRun}`);
  console.log(`  Skipped (empty stats):     ${countSkippedEmpty}`);
  console.log(`  Skipped (nulled-cleanup):  ${countSkippedNulled}`);
  console.log(`  Skipped (no-overwrite):    ${countSkippedNoOverwrite}`);
  console.log(`  Skipped (missing dob):     ${countSkippedMissingDob}`);
  console.log(`  Errors:                    ${countErrors}`);
  console.log(`\nMLB Stats API calls used:  ${mlbApiCalls}`);
  if (!write) {
    console.log("\nDRY RUN — NO DB WRITES PERFORMED.");
    console.log("first_inning_* columns are NEVER included in the payload — guaranteed by the writer's invariant + tests.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
