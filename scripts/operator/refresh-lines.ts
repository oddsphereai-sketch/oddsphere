/**
 * Phase 4.2.C.1.R-3 — Operator script: refresh game lines (ML / Total /
 * spread) for one sport/date.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/refresh-lines.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--verbose] \
 *     [--provider real_api] \
 *     [--apply]
 *
 * GUARDS (defense in depth, mirrors refresh-sharp-signals.ts):
 *   1. Provider mode must be EXPLICITLY real_api. Either:
 *        • ODDS_PROVIDER=real_api in the environment, OR
 *        • --provider real_api on the command line.
 *      Anything else (mock, manual, unset) → script refuses to call the
 *      real odds provider and explains what is needed.
 *
 *   2. Writes require TWO keys: --apply AND LINES_DB_WRITES_ENABLED=true.
 *      Without both, the script runs dry-run regardless of --apply.
 *
 *   3. --apply also triggers an interactive y/N confirmation showing the
 *      exact sport/date and lines-row count about to be written.
 *
 * DEFAULT BEHAVIOR (no --apply): DRY-RUN
 *   • Calls SharpAPIOddsProvider.getGameLines(date, sport) — real API.
 *   • Runs the same mapping/merge logic the cron uses (via
 *     linesService.refreshGameLines with { dryRun: true }).
 *   • Logs row count, per-market coverage, per-sportsbook coverage,
 *     pre-state row count, and unmatched game external ids.
 *   • Does NOT delete or insert into `lines` / `line_history`.
 *   • Prints DRY RUN — NO DB WRITES banner.
 *
 * APPLY BEHAVIOR (--apply + env flag + confirm):
 *   • Same fetch + mapping, then:
 *     - DELETE existing rows in `lines` for tonight's games WHERE
 *       player_id IS NULL (game-level only — props are untouched), and
 *     - INSERT the fresh rows into `lines`,
 *     - APPEND new rows into `line_history` (audit / movement trail).
 *   • Scope is the same scope `linesService.refreshGameLines` uses.
 *
 * NEVER WRITES:
 *   • game_predictions, sharp_signals, games, players, player_season_stats
 *   • Slate publish state (no slate_status mutation)
 *   • Props (`refreshPlayerProps` is a separate method — not invoked here)
 *   • DDL / schema / env / Vercel / cron
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readStringFlag,
  readBoolFlag,
} from "./_cliCommon";
import { linesService } from "../../lib/services/linesService";
import { supabase } from "../../lib/db/supabase";
import { loadGameIdMap } from "../../lib/services/_idMaps";
import type { Sport } from "../../lib/types/domain/Sport";

// ─── provider gate ────────────────────────────────────────────────────

type ProviderMode = "mock" | "manual" | "real_api";

function isProviderMode(v: unknown): v is ProviderMode {
  return v === "mock" || v === "manual" || v === "real_api";
}

function resolveExplicitProviderMode(argv: readonly string[]): {
  ok: boolean;
  mode: ProviderMode | null;
  source: "flag" | "env" | "neither";
  reason: string | null;
} {
  const flagRaw = readStringFlag(argv, "--provider");
  const envRaw = process.env.ODDS_PROVIDER;
  const flag = isProviderMode(flagRaw) ? flagRaw : null;
  const env = isProviderMode(envRaw) ? envRaw : null;

  if (flagRaw !== undefined && flag === null) {
    return {
      ok: false,
      mode: null,
      source: "flag",
      reason: `Invalid --provider "${flagRaw}". Expected one of: mock, manual, real_api.`,
    };
  }
  if (envRaw !== undefined && env === null) {
    return {
      ok: false,
      mode: null,
      source: "env",
      reason: `Invalid ODDS_PROVIDER="${envRaw}". Expected one of: mock, manual, real_api.`,
    };
  }
  if (flag !== null) return { ok: true, mode: flag, source: "flag", reason: null };
  if (env !== null) return { ok: true, mode: env, source: "env", reason: null };
  return { ok: true, mode: null, source: "neither", reason: null };
}

function refuseUnlessRealApi(
  mode: ProviderMode | null,
  source: "flag" | "env" | "neither"
): void {
  if (mode === "real_api") return;
  console.error(
    [
      "✗ This script intentionally refuses to call the real odds provider",
      "  unless the provider is EXPLICITLY set to real_api.",
      "",
      `  Currently: ${
        source === "neither"
          ? "no provider mode set (would default to mock via factory)"
          : `provider=${mode} (source: ${source})`
      }.`,
      "",
      "  To run this script against the live odds provider:",
      "    ODDS_PROVIDER=real_api npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-lines.ts [...flags]",
      "",
      "  OR pass --provider real_api on the command line:",
      "    npx tsx --env-file=.env.local scripts/operator/refresh-lines.ts \\",
      "      --provider real_api [...flags]",
      "",
      "  Reason: avoid accidentally burning provider quota or writing",
      "  unintended `lines` rows. Phase 4.2.C.1.R-3 guard.",
    ].join("\n")
  );
  process.exit(1);
}

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.LINES_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires LINES_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any lines DELETE/INSERT.",
      "  To opt in for this command:",
      "",
      "    LINES_DB_WRITES_ENABLED=true ODDS_PROVIDER=real_api \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-lines.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

// ─── prompts ──────────────────────────────────────────────────────────

async function confirmApply(
  sport: Sport,
  date: string,
  rowsToWrite: number
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to DELETE and re-INSERT lines for sport=${sport} date=${date}.\n` +
        `  Rows fetched from provider: ${rowsToWrite}\n` +
        `  Scope: game-level rows ONLY (player_id IS NULL). Props untouched.\n` +
        `  line_history will also receive ${rowsToWrite} append-only row(s).\n` +
        `  No predictions, no publish — just lines + line_history.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── reporting ────────────────────────────────────────────────────────

type Row = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
};

async function countExistingGameLines(gameIds: number[]): Promise<number> {
  if (gameIds.length === 0) return 0;
  const { count, error } = await supabase
    .from("lines")
    .select("game_id", { count: "exact", head: true })
    .in("game_id", gameIds)
    .is("player_id", null);
  if (error) {
    throw new Error(`pre-state count failed: ${error.message}`);
  }
  return count ?? 0;
}

function summarizeByMarket(rows: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.market_type, (out.get(r.market_type) ?? 0) + 1);
  }
  return out;
}

function summarizeBySportsbook(rows: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.sportsbook, (out.get(r.sportsbook) ?? 0) + 1);
  }
  return out;
}

function countGamesWithMarket(rows: Row[], market: string): number {
  const games = new Set<number>();
  for (const r of rows) {
    if (r.market_type === market) games.add(r.game_id);
  }
  return games.size;
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);

  const providerResolution = resolveExplicitProviderMode(argv);
  if (!providerResolution.ok) {
    console.error(`✗ ${providerResolution.reason}`);
    process.exit(1);
  }
  // If the flag was used, set the env BEFORE the factory caches the singleton.
  if (providerResolution.source === "flag" && providerResolution.mode !== null) {
    process.env.ODDS_PROVIDER = providerResolution.mode;
  }
  refuseUnlessRealApi(providerResolution.mode, providerResolution.source);

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[refresh-lines] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } provider=real_api(source:${
      providerResolution.source === "neither" ? "?" : providerResolution.source
    }) sport=${common.sport} date=${common.date} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("           DRY RUN — NO DB WRITES");
  }

  // Pre-state: how many game-level rows exist in `lines` for this slate?
  const gameIdByExternal = await loadGameIdMap(common.sport, common.date);
  const gameIds = [...gameIdByExternal.values()];
  console.log();
  console.log("━━━ Pre-state ━━━");
  console.log(`  Games in slate (DB):                  ${gameIds.length}`);
  if (gameIds.length === 0) {
    console.log("  🟡 No games found for this slate. Ingest the slate first.");
    console.log("     (Refresh-slate operator does this — see refresh-slate.ts.)");
    if (writeMode) process.exit(1);
    return;
  }
  const preCount = await countExistingGameLines(gameIds);
  console.log(`  Existing game-level lines rows:       ${preCount}`);

  // Dry-run the service: fetches from provider, builds payload, but
  // skips DELETE/INSERT.
  console.log();
  console.log("━━━ Provider fetch + payload build ━━━");
  const dryResult = await linesService.refreshGameLines(common.sport, common.date, {
    dryRun: true,
  });
  console.log(`  Lines fetched from provider:          ${dryResult.records_updated}`);
  console.log(`  Provider API calls made:              ${dryResult.api_calls_made}`);
  if (dryResult.details !== undefined) {
    const det = dryResult.details as { skipped_game_external_ids?: number[] };
    const skipped = det.skipped_game_external_ids ?? [];
    if (skipped.length > 0) {
      console.log(`  Skipped (no matching game in DB):     ${skipped.length}`);
      if (common.verbose) {
        console.log(`    skipped external_ids: ${skipped.join(", ")}`);
      }
    } else {
      console.log(`  Skipped (no matching game in DB):     0`);
    }
  } else {
    console.log(`  Skipped (no matching game in DB):     0`);
  }

  // Read the actual rows the provider returned so we can summarize. We
  // re-call the provider here purely for the dry-run preview detail —
  // this is one additional API call. The cron's "real" path goes
  // through the service which has already done the work.
  // (We could plumb the rows back through the service return type, but
  // that would change the cron's contract; the extra call is fine for
  // an operator preview.)
  // For V1 simplicity, summarize what we have via a fresh re-fetch only
  // if --verbose was set. Otherwise the counts above are sufficient.
  if (common.verbose) {
    // Re-fetch via the provider for the breakdown. This is the same
    // call the service just made, so it's idempotent and quota-safe to
    // run again in dry-run mode.
    const { getOddsProvider } = await import("../../lib/providers/factory");
    const odds = getOddsProvider();
    const lines = await odds.getGameLines(common.date, common.sport);
    const rows: Row[] = [];
    for (const l of lines) {
      const gameId = gameIdByExternal.get(l.game_external_id);
      if (gameId === undefined) continue;
      rows.push({
        game_id: gameId,
        market_type: l.market_type,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
      });
    }
    console.log();
    console.log("━━━ Per-market coverage ━━━");
    const byMkt = summarizeByMarket(rows);
    for (const [mkt, n] of byMkt) {
      const gamesWith = countGamesWithMarket(rows, mkt);
      console.log(`  ${mkt.padEnd(20)} rows=${n.toString().padStart(3)}   games_with=${gamesWith}/${gameIds.length}`);
    }
    console.log();
    console.log("━━━ Per-sportsbook coverage ━━━");
    const byBook = summarizeBySportsbook(rows);
    for (const [book, n] of [...byBook].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${book.padEnd(20)} rows=${n}`);
    }
  }

  console.log();
  console.log("━━━ Tables that would be written ━━━");
  console.log(`  lines        (DELETE existing game-level + INSERT fresh): ${dryResult.records_updated} row(s)`);
  console.log(`  line_history (APPEND-only audit):                        ${dryResult.records_updated} row(s)`);
  console.log("  No other tables. No predictions, no publish, no signals, no props.");

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    if (dryResult.records_updated === 0) {
      console.log("  🟡 Provider returned 0 lines. Possibilities:");
      console.log("     - Provider has no lines for this date yet (early morning, off-day)");
      console.log("     - Provider key invalid / quota exhausted (check upstream logs)");
      console.log("     - Wrong date / wrong sport");
    } else {
      console.log(`  🟢 Provider returned ${dryResult.records_updated} lines rows for ${common.sport}/${common.date}.`);
      console.log("     Safe to --apply (operator confirmation required).");
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: confirm + write via the service.
  const confirmed = await confirmApply(
    common.sport,
    common.date,
    dryResult.records_updated ?? 0
  );
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via linesService.refreshGameLines (DELETE then INSERT)…");
  const result = await linesService.refreshGameLines(common.sport, common.date);
  console.log(`  records_updated: ${result.records_updated}`);
  console.log(`  api_calls_made:  ${result.api_calls_made}`);
  if (result.details !== undefined) {
    console.log(`  details:         ${JSON.stringify(result.details)}`);
  }

  // Post-state snapshot
  const postCount = await countExistingGameLines(gameIds);
  console.log();
  console.log("━━━ Post-state ━━━");
  console.log(`  Game-level lines rows for ${common.sport}/${common.date}: ${postCount}`);
  console.log(`  (was ${preCount} before)`);

  console.log();
  console.log("APPLY complete. Next step:");
  console.log("  Re-run automodel-morning-card.ts (dry-run) — O/U + ML should");
  console.log("  now produce picks/holds against the populated market lines.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
