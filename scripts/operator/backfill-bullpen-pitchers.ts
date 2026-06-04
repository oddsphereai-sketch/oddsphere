/**
 * Phase 4.2.C.1.R-15 — operator: bullpen-pitcher ingestion.
 *
 * Thin wrapper around `lib/services/bullpenIngestService.ts`. The
 * heavy lifting (roster fetch, classification, idempotent insert) lives
 * in the service so the future Daily-Edge orchestrator can call the
 * same code path without going through this CLI.
 *
 * USAGE:
 *   Slate-mode dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-bullpen-pitchers.ts \
 *       --slate-date 2026-06-04
 *
 *   All-teams maintenance dry-run (one-shot foundation refresh):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-bullpen-pitchers.ts \
 *       --all-teams --season 2025
 *
 *   Apply (two-key gate + interactive y/N + required --limit):
 *     BULLPEN_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/backfill-bullpen-pitchers.ts \
 *       --slate-date 2026-06-04 --write --limit 50
 *
 * WRITE GATING (defense in depth):
 *   1. `--write` flag AND `BULLPEN_DB_WRITES_ENABLED=true` env must
 *      BOTH be present. Without both, dry-run.
 *   2. `--limit N` REQUIRED in apply mode.
 *   3. Interactive y/N confirmation listing per-team selected counts.
 *   4. Per-row INSERT loop with PostgREST `code=23505` dupe-skip.
 *
 * IDEMPOTENT:
 *   • The planner skips persons already in `players.mlb_person_id`
 *     (or `provider_ids.mlb_stats.id`).
 *   • Re-running with no apply-eligible changes is a no-op.
 *
 * NEVER WRITES TO:
 *   • games / game_predictions / publish state
 *   • cron / env / Vercel / DDL
 *   • lines / sharp_signals / player_season_stats / player_splits
 *
 * After applying inserts here, run R-11's
 * `scripts/operator/backfill-season-pitching-stats.ts` to populate
 * `player_season_stats` for the new RP rows.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  applyBullpenIngest,
  planBullpenIngestForAllTeams,
  planBullpenIngestForSlate,
  type SlateBullpenPlan,
  type AllTeamsBullpenPlan,
  type TeamBullpenPlan,
} from "../../lib/services/bullpenIngestService";
import {
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  todayUTC,
} from "./_cliCommon";

// ─── Apply gate ──────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--write");
  const envEnabled = process.env.BULLPEN_DB_WRITES_ENABLED === "true";
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
      "✗ --write requires BULLPEN_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any players INSERT.",
      "  To opt in for this command:",
      "",
      "    BULLPEN_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/backfill-bullpen-pitchers.ts \\",
      "      --slate-date YYYY-MM-DD --write --limit N",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(totalInserts: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `\nAbout to INSERT ${totalInserts} new bullpen-pitcher row(s) into ` +
        `\`players\` with position_abbr="RP", active=true.\n` +
        `\n  After insert, run:\n` +
        `    BDL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n` +
        `      scripts/operator/backfill-season-pitching-stats.ts \\\n` +
        `      --season <YYYY> --apply --limit <N>\n` +
        `  to populate player_season_stats for the newly inserted RPs.\n` +
        `\n  Proceed? [y/N] `
    );
    return ans.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

// ─── Output formatters ───────────────────────────────────────────────

function printTeamPlanTable(teamPlans: ReadonlyArray<TeamBullpenPlan>): void {
  const rows = teamPlans
    .slice()
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation))
    .map((t) => ({
      team: t.abbreviation,
      mlb_id: t.mlbStatsTeamId,
      roster: t.rosterFetched ? t.rosterSize : "ERROR",
      pitchers: t.pitcherCount,
      selected: t.selected.length,
      already_in_db: t.skipped.filter((s) => s.skipReason === "already_in_db").length,
      regular_starter: t.skipped.filter((s) => s.skipReason === "regular_starter").length,
      current_starter: t.skipped.filter((s) => s.skipReason === "current_starter").length,
      not_pitcher: t.skipped.filter((s) => s.skipReason === "not_pitcher").length,
      error: t.rosterError ?? "",
    }));
  console.table(rows);
}

function printDetailedSelections(
  teamPlans: ReadonlyArray<TeamBullpenPlan>,
  verbose: boolean
): void {
  if (!verbose) return;
  for (const t of teamPlans) {
    if (t.selected.length === 0) continue;
    console.log(`\n  ${t.abbreviation} (mlb_id=${t.mlbStatsTeamId}) — ${t.selected.length} selected:`);
    for (const s of t.selected) {
      console.log(
        `    • ${s.fullName} (mlb_person_id=${s.personId}) ` +
          `gs=${s.gamesStarted ?? "—"} pos=${s.positionAbbreviation ?? "—"} ` +
          `reason=${s.selectionReason}`
      );
    }
  }
}

function lowCoverageTeams(
  teamPlans: ReadonlyArray<TeamBullpenPlan>
): TeamBullpenPlan[] {
  // Reasonable bullpen size is 6-9 relievers. Flag teams with < 5
  // selected so the operator can investigate.
  return teamPlans
    .filter((t) => t.selected.length + t.skipped.filter((s) => s.skipReason === "already_in_db").length < 5)
    .filter((t) => t.rosterFetched);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const slateDate = readStringFlag(argv, "--slate-date");
  const allTeams = readBoolFlag(argv, "--all-teams");
  const verbose = readBoolFlag(argv, "--verbose");
  const limit = readNumberFlag(argv, "--limit");
  const season = readNumberFlag(argv, "--season");
  const noStats = readBoolFlag(argv, "--no-stats");
  const { applyRequested, envEnabled, canApply } = resolveApplyGate(argv);
  refuseApplyMisconfig(applyRequested, envEnabled);

  if (!slateDate && !allTeams) {
    console.error(
      "✗ One of --slate-date YYYY-MM-DD or --all-teams is required."
    );
    process.exit(1);
  }
  if (canApply && limit === undefined) {
    console.error(
      "✗ --write requires --limit N (no accidental large inserts)."
    );
    process.exit(1);
  }
  if (limit !== undefined && limit < 0) {
    console.error("✗ --limit must be ≥ 0.");
    process.exit(1);
  }

  const mode = canApply ? "WRITE" : "DRY-RUN";
  const ranAt = new Date().toISOString();
  console.log(
    `\n[backfill-bullpen-pitchers] mode=${mode} ` +
      (slateDate ? `slate-date=${slateDate} ` : `all-teams=true `) +
      (season !== undefined ? `season=${season} ` : "") +
      `stats=${!noStats} ranAt=${ranAt}\n`
  );

  let plan: SlateBullpenPlan | AllTeamsBullpenPlan;
  if (slateDate) {
    plan = await planBullpenIngestForSlate(slateDate, {
      withStats: !noStats,
      perStatDelayMs: 50,
    });
  } else {
    plan = await planBullpenIngestForAllTeams({
      season: season ?? new Date().getUTCFullYear(),
      withStats: !noStats,
      perStatDelayMs: 50,
    });
  }

  console.log(`━━━ Per-team plan ━━━`);
  printTeamPlanTable(plan.teamPlans);

  if (plan.teamErrors.length > 0) {
    console.log(`\n⚠ ${plan.teamErrors.length} team(s) hit roster-fetch errors:`);
    for (const e of plan.teamErrors) {
      console.log(`  • ${e.abbreviation}: ${e.error}`);
    }
  }

  const lowCov = lowCoverageTeams(plan.teamPlans);
  if (lowCov.length > 0) {
    console.log(
      `\n⚠ ${lowCov.length} team(s) have <5 bullpen candidates after planning:`
    );
    for (const t of lowCov) {
      console.log(
        `  • ${t.abbreviation}: selected=${t.selected.length} ` +
          `already_in_db=${t.skipped.filter((s) => s.skipReason === "already_in_db").length} ` +
          `roster=${t.rosterSize}`
      );
    }
    console.log(
      `  (Lower than expected often means MLB Stats roster cache is stale;` +
        ` re-run later or use --all-teams for a broader refresh.)`
    );
  }

  printDetailedSelections(plan.teamPlans, verbose);

  console.log(
    `\n━━━ Totals ━━━\n` +
      `  selected: ${plan.totalsSelected}\n` +
      `  team errors: ${plan.teamErrors.length}\n`
  );

  if (!canApply) {
    console.log(
      `\nDry-run only. To apply:\n` +
        `  BULLPEN_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n` +
        `    scripts/operator/backfill-bullpen-pitchers.ts ` +
        (slateDate ? `--slate-date ${slateDate} ` : `--all-teams `) +
        `--write --limit <N>\n`
    );
    return;
  }

  const tasksAvailable = plan.totalsSelected;
  const willInsert = Math.min(limit ?? tasksAvailable, tasksAvailable);
  const ok = await confirmApply(willInsert);
  if (!ok) {
    console.log("Aborted (user declined).");
    return;
  }

  const result = await applyBullpenIngest(plan, {
    limit,
    write: true,
    ingestedAtIso: ranAt,
    perPersonDelayMs: 150,
  });
  console.log(
    `\n━━━ Apply result ━━━\n` +
      `  attempted: ${result.attempted}\n` +
      `  inserted:  ${result.inserted}\n` +
      `  skipped:   ${result.skipped.length}\n` +
      `  errors:    ${result.errors.length}\n`
  );
  if (result.skipped.length > 0) {
    console.log("Skipped:");
    for (const s of result.skipped.slice(0, 20)) {
      console.log(`  • personId=${s.personId}  reason=${s.reason}`);
    }
    if (result.skipped.length > 20) {
      console.log(`  … +${result.skipped.length - 20} more`);
    }
  }
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors.slice(0, 20)) {
      console.log(`  • personId=${e.personId}  error=${e.error}`);
    }
    if (result.errors.length > 20) {
      console.log(`  … +${result.errors.length - 20} more`);
    }
  }
  console.log(`\n⚠ REMINDER: unset BULLPEN_DB_WRITES_ENABLED in your shell when done.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});

// Reference imports to satisfy --noUnusedLocals when --no-stats path runs.
void todayUTC;
