/**
 * Phase 3.x.0d / refactored in Phase 4.2.C.1.F — operator backfill for
 * first-inning pitcher stats.
 *
 * USAGE:
 *   Per-player (explicit ids):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --player-ids 6272,6274 --season 2025 [--write]
 *
 *   Slate-date (resolves probable starters automatically):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --slate-date 2026-05-22 --season 2025 [--write]
 *
 * GATING — writes require BOTH:
 *   • CLI flag: --write
 *   • Env var:  FIRST_INNING_DB_WRITES_ENABLED=true
 * Slate-date mode additionally prompts interactive y/N (since the
 * starter list is implicit). Per-player mode does not re-prompt
 * because the id list is already explicit on the command line.
 *
 * ID-RESOLUTION PRIORITY (Phase 4.2.C.1.F):
 *   1. provider_ids.mlb_stats.id   (from Phase 4.2.C.1.M mapping)
 *   2. players.mlb_person_id       (legacy Phase 3.x column)
 *   3. searchPersonByNameDob()     (last resort; requires players.dob)
 *
 * NULLED-SEASON GUARD: if the target player_season_stats row matches
 * the "cleanup" signature (pitching_ip + pitching_era + pitching_k +
 * batting_ab all null — e.g. Cole after Phase 4.2.C.1.S.A-cole-cleanup),
 * the operator skips the FI write to avoid re-polluting the cleaned
 * row. A future operator can add --force-nulled if we need to override.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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
import {
  dedupePlayerIds,
  isFullyNulledSeasonRow,
  loadSlateStarterPlayerIds,
  resolveMlbStatsIdFromDbRow,
  type IdResolution,
  type MlbStatsIdSource,
} from "../../lib/services/firstInningResolver";
import { readBoolFlag, readStringFlag } from "./_cliCommon";

type DbPlayer = {
  id: number;
  full_name: string;
  dob: string | null;
  mlb_person_id: number | null;
  provider_ids: Record<string, unknown> | null;
};

type SeasonRow = {
  player_id: number;
  pitching_ip: number | null;
  pitching_era: number | null;
  pitching_k: number | null;
  batting_ab: number | null;
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
  if (error !== null) {
    throw new Error(`load players failed: ${error.message}`);
  }
  return ((data as unknown) ?? []) as DbPlayer[];
}

async function loadNulledGuardRows(
  playerIds: number[],
  season: number
): Promise<Map<number, SeasonRow>> {
  const { data, error } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_ip, pitching_era, pitching_k, batting_ab")
    .in("player_id", playerIds)
    .eq("season", season)
    .eq("season_type", "regular");
  if (error !== null) {
    throw new Error(`load season rows failed: ${error.message}`);
  }
  const out = new Map<number, SeasonRow>();
  for (const r of ((data as unknown) ?? []) as SeasonRow[]) {
    out.set(r.player_id, r);
  }
  return out;
}

async function confirmSlateApply(
  starters: Array<{ id: number; full_name: string }>
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `\nAbout to refresh first-inning stats for ${starters.length} starter(s):\n` +
        starters
          .map((s) => `  • player_id=${s.id}  ${s.full_name}`)
          .join("\n") +
        `\n\n  This will UPDATE player_season_stats.first_inning_* columns only.\n` +
        `  Other columns (batting_*, pitching_*) are not touched.\n` +
        `  Players in the nulled-cleanup state are skipped.\n` +
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

  // Validate input mode: exactly one of --player-ids / --slate-date
  if (playerIdsRaw === undefined && slateDateRaw === undefined) {
    console.error(
      "✗ Missing input: pass either --player-ids <id1,id2,...> OR --slate-date <YYYY-MM-DD>"
    );
    process.exit(1);
  }
  if (playerIdsRaw !== undefined && slateDateRaw !== undefined) {
    console.error(
      "✗ Mutually exclusive: pass --player-ids OR --slate-date, not both"
    );
    process.exit(1);
  }
  const season = seasonRaw !== undefined ? parseInt(seasonRaw, 10) : NaN;
  if (!Number.isFinite(season) || season < 2020 || season > 2099) {
    console.error("✗ Missing or invalid --season <YYYY>");
    process.exit(1);
  }

  // Two-key gate
  let write = false;
  if (writeFlag) {
    const envEnabled = process.env.FIRST_INNING_DB_WRITES_ENABLED === "true";
    if (!envEnabled) {
      console.error(
        "✗ --write requires FIRST_INNING_DB_WRITES_ENABLED=true in the env.\n" +
          "  Two-key gate: both the CLI flag AND the env var must be present\n" +
          "  before any DB write executes."
      );
      process.exit(1);
    }
    write = true;
  }

  const mode = slateDateRaw !== undefined ? "slate-date" : "player-ids";
  const targetLabel =
    mode === "slate-date" ? `slate=${slateDateRaw}` : `player_ids=${playerIdsRaw}`;
  console.log(
    `[backfill-fi-stats] mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  season=${season}  ${targetLabel}`
  );
  console.log("─".repeat(64));

  // ── Resolve player_ids ──────────────────────────────────────────────
  let playerIds: number[];
  if (slateDateRaw !== undefined) {
    const slateIds = await loadSlateStarterPlayerIds(supabase, slateDateRaw);
    playerIds = slateIds;
    console.log(
      `Resolved ${playerIds.length} unique starter player_id(s) from games (slate_date=${slateDateRaw})`
    );
  } else {
    playerIds = dedupePlayerIds(parsePlayerIds(playerIdsRaw!));
    if (playerIds.length === 0) {
      console.error(
        `✗ Could not parse any valid IDs from --player-ids "${playerIdsRaw}"`
      );
      process.exit(1);
    }
    console.log(`Caller-provided ${playerIds.length} player_id(s) after dedupe`);
  }
  if (playerIds.length === 0) {
    console.log("(no player_ids resolved — exiting)");
    return;
  }

  // ── Load player rows ────────────────────────────────────────────────
  const players = await loadPlayers(playerIds);
  const playerById = new Map<number, DbPlayer>(players.map((p) => [p.id, p]));
  const found = new Set(players.map((p) => p.id));
  for (const id of playerIds) {
    if (!found.has(id)) console.log(`  ! player_id=${id} not found in DB; skipping`);
  }

  // ── Pre-load season rows for the nulled-cleanup guard ──────────────
  const nulledGuardRows = await loadNulledGuardRows(playerIds, season);

  // ── Plan summary (for interactive confirmation in slate mode) ───────
  if (mode === "slate-date" && write) {
    const startersForPrompt = playerIds
      .filter((id) => playerById.has(id))
      .map((id) => ({ id, full_name: playerById.get(id)!.full_name }));
    const confirmed = await confirmSlateApply(startersForPrompt);
    if (!confirmed) {
      console.log("Cancelled by operator. No writes performed.");
      return;
    }
  }

  // ── Process each player ─────────────────────────────────────────────
  let countSourceProvider = 0;
  let countSourceMlbPersonId = 0;
  let countSourceNameDob = 0;
  let countSkippedNulled = 0;
  let countSkippedMissingDob = 0;
  let countSkippedNoRow = 0;
  let countWritten = 0;
  let countDryRun = 0;
  let countErrors = 0;
  let mlbApiCalls = 0;

  for (const p of players) {
    console.log(
      `\n${p.full_name} (player_id=${p.id}, dob=${p.dob ?? "null"}, ` +
        `existing_mlb_person_id=${p.mlb_person_id ?? "null"})`
    );

    // Cole/nulled-season guard — short-circuit before any HTTP call
    const seasonRow = nulledGuardRows.get(p.id);
    if (isFullyNulledSeasonRow(seasonRow)) {
      console.log(
        "  ⏭  SKIPPED (player_season_stats row is in nulled-cleanup state; refusing to repopulate)"
      );
      countSkippedNulled++;
      continue;
    }

    // ID resolution (provider_ids → players.mlb_person_id → name+DOB)
    const initialResolution: IdResolution = resolveMlbStatsIdFromDbRow(p);
    let mlbId: number | null = null;
    let source: MlbStatsIdSource;
    if (initialResolution.kind === "ok") {
      mlbId = initialResolution.mlbId;
      source = initialResolution.source;
      if (source === "provider_ids_mlb_stats") countSourceProvider++;
      else if (source === "players_mlb_person_id") countSourceMlbPersonId++;
    } else if (initialResolution.kind === "skip") {
      console.log(`  ⏭  SKIPPED (missing dob — cannot resolve via name+DOB)`);
      countSkippedMissingDob++;
      continue;
    } else {
      // kind === "needs_search"  → fall back to name+DOB
      const person = await searchPersonByNameDob(p.full_name, p.dob!);
      mlbApiCalls++;
      if (person === null) {
        console.log(
          "  ✗  ID resolution failed (no MLB Person via name+DOB search); skipping"
        );
        countErrors++;
        continue;
      }
      mlbId = person.id;
      source = "name_dob_search";
      countSourceNameDob++;
    }
    console.log(`  → MLB Person ID = ${mlbId}  [source: ${sourceLabel(source)}]`);

    // Persist mlb_person_id back to players if needed (defensive guard
    // in the writer refuses to overwrite a different existing value).
    const r1 = await persistMlbPersonId(p.id, mlbId, { write });
    console.log(`  persistMlbPersonId: ${formatResult(r1)}`);

    await sleep(500);

    // Fetch FI from MLB Stats API
    const stats = await getPitcherFirstInningStats(mlbId, season);
    mlbApiCalls++;
    if (stats === null) {
      console.log(
        "  ✗  could not fetch first-inning stats from MLB Stats API"
      );
      countErrors++;
      continue;
    }
    console.log(
      `  → FI: era=${stats.first_inning_era} starts=${stats.first_inning_starts}` +
        ` ip=${stats.first_inning_innings_pitched?.toFixed(3) ?? "null"}` +
        ` er=${stats.first_inning_earned_runs} r=${stats.first_inning_runs_allowed}` +
        ` whip=${stats.first_inning_whip}`
    );

    const r2 = await persistFirstInningStats(p.id, season, stats, { write });
    console.log(`  persistFirstInningStats: ${formatResult(r2)}`);
    if (r2.kind === "updated") countWritten++;
    else if (r2.kind === "dry_run") countDryRun++;
    else if (r2.kind === "skipped_no_row") countSkippedNoRow++;
    else if (r2.kind === "error") countErrors++;

    await sleep(500);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log(`mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  complete.`);
  console.log("\nID-resolution sources:");
  console.log(`  provider_ids.mlb_stats.id : ${countSourceProvider}`);
  console.log(`  players.mlb_person_id     : ${countSourceMlbPersonId}`);
  console.log(`  name+DOB search           : ${countSourceNameDob}`);
  console.log("\nDispositions:");
  console.log(`  ${write ? "Written" : "Would write"} (dry-run): ${write ? countWritten : countDryRun}`);
  console.log(`  Skipped (nulled-cleanup):  ${countSkippedNulled}`);
  console.log(`  Skipped (missing dob):     ${countSkippedMissingDob}`);
  console.log(`  Skipped (no season row):   ${countSkippedNoRow}`);
  console.log(`  Errors:                    ${countErrors}`);
  console.log(`\nMLB Stats API calls used:  ${mlbApiCalls}`);
  if (!write) {
    console.log("\nDRY RUN — NO DB WRITES PERFORMED.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
