/**
 * Phase 3.x.0d / refactored in Phase 4.2.C.1.F — operator backfill for
 * first-inning pitcher stats.
 *
 * Phase 6B.31b — body extracted into `runFirstInningCycle` so the
 * automation orchestrator can invoke it in-process as the new S6 step
 * (slate-cycle first-inning refresh). The standalone CLI (--player-ids
 * / --slate-date / --write) is preserved unchanged; `main()` parses
 * argv, validates the two-key write gate, then delegates to the helper.
 *
 * USAGE:
 *   Per-player (explicit ids — requires --season):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --player-ids 6272,6274 --season 2026 [--write]
 *
 *   Slate-date (defaults --season from slate year — Phase 4.2.C.1.H-6.3b):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --slate-date 2026-06-15 [--season 2026] [--write]
 *
 *   Explicit override (rare — write data under a different year than
 *   the slate; loud on purpose):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-first-inning-stats.ts \
 *       --slate-date 2026-06-15 --season 2025 --allow-season-mismatch [--write]
 *
 * SEASON RESOLUTION (Phase 4.2.C.1.H-6.3b):
 *   • --slate-date alone   → season defaults to slate-date's year
 *   • --season alone       → use the flag value
 *   • both, years match    → use the value (safe)
 *   • both, years differ   → FAIL unless --allow-season-mismatch
 *   • neither              → FAIL
 *
 * GATING — writes require BOTH:
 *   • CLI flag: --write
 *   • Env var:  FIRST_INNING_DB_WRITES_ENABLED=true
 * Slate-date mode additionally prompts interactive y/N (since the
 * starter list is implicit). Per-player mode does not re-prompt.
 *
 * SCOPE:
 *   • Reads:  players, player_season_stats (existence + nulled-guard),
 *             games (slate starter resolution), MLB Stats API
 *   • Writes: player_season_stats — ONLY the six first_inning_*
 *             columns + updated_at. NEVER touches pitching_* or
 *             batting_* columns. PostgREST UPSERT semantics preserve
 *             any season-aggregate values on existing rows.
 *   • Never writes: predictions / games / lines / sharp_signals /
 *             slate_status / locked_at / tracking / schema / cron / env.
 *
 * ID-RESOLUTION PRIORITY (Phase 4.2.C.1.F):
 *   1. provider_ids.mlb_stats.id
 *   2. players.mlb_person_id
 *   3. searchPersonByNameDob()    (requires players.dob)
 *
 * NULLED-SEASON GUARD: the FI writer's 4-field signature is used here
 * pre-flight so planning output matches what the writer will actually
 * do at write time.
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
import { resolveOperatorSeason } from "../../lib/services/firstInningSeasonResolver";
import { readBoolFlag, readStringFlag } from "./_cliCommon";
import type { Sport } from "../../lib/types/domain/Sport";

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

// ─── Extracted cycle helper (Phase 6B.31b) ──────────────────────────
//
// `runFirstInningCycle` lifts the body of main() so the automation
// orchestrator can invoke it in-process for the slate-date path. CLI
// behaviour for both --player-ids and --slate-date modes is unchanged —
// main() parses argv, validates the two-key write gate, then calls this
// helper.
//
// The helper never calls process.exit; it returns a structured
// `RunFirstInningResult`. Per-pitcher failures (network, ID resolution,
// empty stats) are isolated in the per-row loop and counted — they do
// NOT bubble. The helper only returns status="failed" when setup itself
// fails (season resolution error, DB load error, both inputs given,
// neither input given).

export type RunFirstInningArgs = {
  sport: Sport;
  /** Exactly one of slateDate / playerIds must be provided. */
  slateDate?: string;
  playerIds?: number[];
  /** Optional. When omitted with slateDate, derived via resolveOperatorSeason. */
  season?: number;
  allowSeasonMismatch?: boolean;
  writeMode: boolean;
  /**
   * Called before any writes in slate-date mode. Return false to abort.
   * When omitted AND writeMode=true, the helper auto-confirms.
   * Per-player mode never prompts.
   */
  confirm?: (
    starters: Array<{ id: number; full_name: string }>
  ) => Promise<boolean>;
  /** Logger; defaults to console.log. */
  log?: (msg: string) => void;
};

export type RunFirstInningStatus =
  | "dry_run"
  | "wrote"
  | "no_changes"
  | "cancelled"
  | "failed"
  | "empty_slate";

export type RunFirstInningResult = {
  status: RunFirstInningStatus;
  planned_writes: number;
  rows_written: number;
  rows_dry_run: number;
  skipped_nulled: number;
  skipped_missing_dob: number;
  /**
   * Per-pitcher failures (ID resolution, MLB API fetch failures, writer
   * errors). Counted and reported but do NOT cause the overall helper
   * to fail — the orchestrator can decide whether to escalate.
   */
  errors: number;
  mlb_api_calls: number;
  source_provider_ids: number;
  source_mlb_person_id: number;
  source_name_dob: number;
  message?: string;
};

function emptyCounts(): Omit<RunFirstInningResult, "status" | "message"> {
  return {
    planned_writes: 0,
    rows_written: 0,
    rows_dry_run: 0,
    skipped_nulled: 0,
    skipped_missing_dob: 0,
    errors: 0,
    mlb_api_calls: 0,
    source_provider_ids: 0,
    source_mlb_person_id: 0,
    source_name_dob: 0,
  };
}

export async function runFirstInningCycle(
  args: RunFirstInningArgs
): Promise<RunFirstInningResult> {
  const write = args.writeMode;
  const log = args.log ?? ((m: string) => console.log(m));
  const allowSeasonMismatch = args.allowSeasonMismatch === true;

  // Input validation — exactly one of slateDate / playerIds.
  if (args.slateDate === undefined && args.playerIds === undefined) {
    return {
      status: "failed",
      ...emptyCounts(),
      errors: 1,
      message: "Missing input: provide either slateDate or playerIds.",
    };
  }
  if (args.slateDate !== undefined && args.playerIds !== undefined) {
    return {
      status: "failed",
      ...emptyCounts(),
      errors: 1,
      message: "Mutually exclusive: provide slateDate OR playerIds, not both.",
    };
  }

  // Season resolution (same resolver as the season-pitching backfill).
  const seasonResolution = resolveOperatorSeason({
    slateDate: args.slateDate,
    seasonFlag: args.season !== undefined ? String(args.season) : undefined,
    allowMismatch: allowSeasonMismatch,
  });
  if (seasonResolution.kind === "error") {
    return {
      status: "failed",
      ...emptyCounts(),
      errors: 1,
      message: seasonResolution.message,
    };
  }
  const season = seasonResolution.season;
  const seasonSource = seasonResolution.source;

  const mode = args.slateDate !== undefined ? "slate-date" : "player-ids";
  const targetLabel =
    mode === "slate-date"
      ? `slate=${args.slateDate}`
      : `player_ids=${args.playerIds!.join(",")}`;
  log(
    `[backfill-fi-stats] mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  season=${season} (${seasonSource})  ${targetLabel}`
  );
  log("─".repeat(64));

  // ── Resolve player_ids ──────────────────────────────────────────────
  let playerIds: number[];
  if (args.slateDate !== undefined) {
    try {
      playerIds = await loadSlateStarterPlayerIds(supabase, args.slateDate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        status: "failed",
        ...emptyCounts(),
        errors: 1,
        message: `loadSlateStarterPlayerIds failed: ${msg}`,
      };
    }
    log(
      `Resolved ${playerIds.length} unique starter player_id(s) from games (slate_date=${args.slateDate})`
    );
  } else {
    playerIds = dedupePlayerIds(args.playerIds!);
    log(`Caller-provided ${playerIds.length} player_id(s) after dedupe`);
  }
  if (playerIds.length === 0) {
    log("(no player_ids resolved — exiting)");
    return { status: "empty_slate", ...emptyCounts() };
  }

  // ── Load player rows ────────────────────────────────────────────────
  let players: DbPlayer[];
  try {
    players = await loadPlayers(playerIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "failed",
      ...emptyCounts(),
      errors: 1,
      message: `loadPlayers failed: ${msg}`,
    };
  }
  const playerById = new Map<number, DbPlayer>(players.map((p) => [p.id, p]));
  const found = new Set(players.map((p) => p.id));
  for (const id of playerIds) {
    if (!found.has(id)) log(`  ! player_id=${id} not found in DB; skipping`);
  }

  // ── Pre-load season rows for the nulled-cleanup guard ──────────────
  let nulledGuardRows: Map<number, SeasonRow>;
  try {
    nulledGuardRows = await loadNulledGuardRows(playerIds, season);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "failed",
      ...emptyCounts(),
      errors: 1,
      message: `loadNulledGuardRows failed: ${msg}`,
    };
  }

  // ── Slate-mode confirmation ────────────────────────────────────────
  if (mode === "slate-date" && write) {
    const startersForPrompt = playerIds
      .filter((id) => playerById.has(id))
      .map((id) => ({ id, full_name: playerById.get(id)!.full_name }));
    const confirmed = args.confirm
      ? await args.confirm(startersForPrompt)
      : true;
    if (!confirmed) {
      log("Cancelled by operator. No writes performed.");
      return {
        status: "cancelled",
        ...emptyCounts(),
        planned_writes: startersForPrompt.length,
      };
    }
  }

  // ── Process each player ─────────────────────────────────────────────
  let countSourceProvider = 0;
  let countSourceMlbPersonId = 0;
  let countSourceNameDob = 0;
  let countSkippedNulled = 0;
  let countSkippedMissingDob = 0;
  let countWritten = 0;
  let countDryRun = 0;
  let countErrors = 0;
  let mlbApiCalls = 0;
  let plannedWrites = 0;

  for (const p of players) {
    log(
      `\n${p.full_name} (player_id=${p.id}, dob=${p.dob ?? "null"}, ` +
        `existing_mlb_person_id=${p.mlb_person_id ?? "null"})`
    );

    // Cole/nulled-season guard — short-circuit before any HTTP call.
    const seasonRow = nulledGuardRows.get(p.id);
    if (isFullyNulledSeasonRow(seasonRow)) {
      log(
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
      log("  ⏭  SKIPPED (missing dob — cannot resolve via name+DOB)");
      countSkippedMissingDob++;
      continue;
    } else {
      // kind === "needs_search"  → fall back to name+DOB
      try {
        const person = await searchPersonByNameDob(p.full_name, p.dob!);
        mlbApiCalls++;
        if (person === null) {
          log(
            "  ✗  ID resolution failed (no MLB Person via name+DOB search); skipping"
          );
          countErrors++;
          continue;
        }
        mlbId = person.id;
        source = "name_dob_search";
        countSourceNameDob++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`  ✗  name+DOB search threw: ${msg}`);
        countErrors++;
        continue;
      }
    }
    log(`  → MLB Person ID = ${mlbId}  [source: ${sourceLabel(source)}]`);

    // Persist mlb_person_id back to players if needed (defensive guard
    // in the writer refuses to overwrite a different existing value).
    try {
      const r1 = await persistMlbPersonId(p.id, mlbId, { write });
      log(`  persistMlbPersonId: ${formatResult(r1)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗  persistMlbPersonId threw: ${msg}`);
      countErrors++;
      continue;
    }

    await sleep(500);

    // Fetch FI from MLB Stats API
    let stats: Awaited<ReturnType<typeof getPitcherFirstInningStats>>;
    try {
      stats = await getPitcherFirstInningStats(mlbId, season);
      mlbApiCalls++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗  getPitcherFirstInningStats threw: ${msg}`);
      countErrors++;
      continue;
    }
    if (stats === null) {
      log("  ✗  could not fetch first-inning stats from MLB Stats API");
      countErrors++;
      continue;
    }
    log(
      `  → FI: era=${stats.first_inning_era} starts=${stats.first_inning_starts}` +
        ` ip=${stats.first_inning_innings_pitched?.toFixed(3) ?? "null"}` +
        ` er=${stats.first_inning_earned_runs} r=${stats.first_inning_runs_allowed}` +
        ` whip=${stats.first_inning_whip}`
    );

    plannedWrites++;
    try {
      const r2 = await persistFirstInningStats(p.id, season, stats, { write });
      log(`  persistFirstInningStats: ${formatResult(r2)}`);
      if (r2.kind === "updated") countWritten++;
      else if (r2.kind === "dry_run") countDryRun++;
      else if (r2.kind === "error") countErrors++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗  persistFirstInningStats threw: ${msg}`);
      countErrors++;
    }

    await sleep(500);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  log("\n" + "─".repeat(64));
  log(`mode=${write ? "WRITE" : "DRY-RUN"}  resolver=${mode}  complete.`);
  log("\nID-resolution sources:");
  log(`  provider_ids.mlb_stats.id : ${countSourceProvider}`);
  log(`  players.mlb_person_id     : ${countSourceMlbPersonId}`);
  log(`  name+DOB search           : ${countSourceNameDob}`);
  log("\nDispositions:");
  log(
    `  ${write ? "Written" : "Would write"} (dry-run): ${write ? countWritten : countDryRun}`
  );
  log(`  Skipped (nulled-cleanup):  ${countSkippedNulled}`);
  log(`  Skipped (missing dob):     ${countSkippedMissingDob}`);
  log(`  Errors:                    ${countErrors}`);
  log(`\nMLB Stats API calls used:  ${mlbApiCalls}`);
  if (!write) {
    log("\nDRY RUN — NO DB WRITES PERFORMED.");
    log(
      "first_inning_* columns are the ONLY columns this writer touches — guaranteed by the writer's payload + tests."
    );
  }

  let status: RunFirstInningStatus;
  if (plannedWrites === 0) {
    status = "no_changes";
  } else if (write) {
    status = "wrote";
  } else {
    status = "dry_run";
  }

  return {
    status,
    planned_writes: plannedWrites,
    rows_written: countWritten,
    rows_dry_run: countDryRun,
    skipped_nulled: countSkippedNulled,
    skipped_missing_dob: countSkippedMissingDob,
    errors: countErrors,
    mlb_api_calls: mlbApiCalls,
    source_provider_ids: countSourceProvider,
    source_mlb_person_id: countSourceMlbPersonId,
    source_name_dob: countSourceNameDob,
  };
}

// ─── Main (CLI shim) ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const playerIdsRaw = readStringFlag(argv, "--player-ids");
  const slateDateRaw = readStringFlag(argv, "--slate-date");
  const seasonRaw = readStringFlag(argv, "--season");
  const writeFlag = readBoolFlag(argv, "--write");
  const allowSeasonMismatch = readBoolFlag(argv, "--allow-season-mismatch");

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

  // Two-key write gate (CLI flag + env). Helper itself just takes a
  // boolean writeMode; gate enforcement stays in the CLI shim so the
  // operator gets the explicit env-missing error message.
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

  let playerIds: number[] | undefined;
  if (playerIdsRaw !== undefined) {
    playerIds = dedupePlayerIds(parsePlayerIds(playerIdsRaw));
    if (playerIds.length === 0) {
      console.error(
        `✗ Could not parse any valid IDs from --player-ids "${playerIdsRaw}"`
      );
      process.exit(1);
    }
  }

  const result = await runFirstInningCycle({
    sport: "mlb",
    slateDate: slateDateRaw,
    playerIds,
    season: seasonRaw !== undefined ? Number(seasonRaw) : undefined,
    allowSeasonMismatch,
    writeMode: write,
    confirm: slateDateRaw !== undefined ? confirmSlateApply : undefined,
  });

  if (result.status === "failed") {
    if (result.message) console.error(`✗ ${result.message}`);
    process.exit(1);
  }
}

// Only invoke main() when this file is run directly (not when the
// orchestrator imports `runFirstInningCycle`).
if (require.main === module) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
