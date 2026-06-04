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
import type {
  V2RefreshDetails,
  V2PerGameDecision,
} from "../../lib/services/linesService";
import { supabase } from "../../lib/db/supabase";
import { loadGameIdMap } from "../../lib/services/_idMaps";
import { assessMarketCoverage } from "../../lib/services/marketCoverageGate";
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

type Strategy = "v1" | "v2";

function resolveStrategy(argv: readonly string[]): Strategy {
  const raw = readStringFlag(argv, "--strategy");
  if (raw === undefined) return "v1";
  if (raw === "v1" || raw === "v2") return raw;
  console.error(
    `✗ Invalid --strategy "${raw}". Expected "v1" or "v2". Default is v1.`
  );
  process.exit(1);
}

// ─── V2 reporting + apply flow ────────────────────────────────────────

function decisionLabel(d: V2PerGameDecision["decision"]): string {
  if (d === "replaced") return "REPLACED (all markets)";
  if (d === "partial") return "PARTIAL (some markets)";
  if (d === "preserved_no_data") return "PRESERVED (no data)";
  if (d === "preserved_unresolved_event") return "PRESERVED (no event)";
  if (d === "preserved_call_cap_skip") return "PRESERVED (call cap)";
  return d;
}

function marketDecisionsBadge(md: V2PerGameDecision["market_decisions"]): string {
  const m = md.moneyline === "refreshed" ? "ML✓" : "ML—";
  const t = md.total === "refreshed" ? "OU✓" : "OU—";
  const s = md.spread === "refreshed" ? "RL✓" : "RL—";
  return `${m} ${t} ${s}`;
}

async function confirmApplyV2(
  sport: Sport,
  date: string,
  replaceCount: number,
  preserveCount: number
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to apply V2 per-game refresh for sport=${sport} date=${date}.\n` +
        `  Games where lines will be REPLACED:  ${replaceCount}\n` +
        `  Games where lines will be PRESERVED: ${preserveCount} (provider returned no data or game unmatched)\n` +
        `  Scope: per-game DELETE-then-INSERT only on replaced games (player_id IS NULL).\n` +
        `  Other games keep their existing rows untouched.\n` +
        `  No predictions, no publish — just lines + line_history.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

async function runV2Flow(args: {
  sport: Sport;
  date: string;
  verbose: boolean;
  writeMode: boolean;
  preCount: number;
  gameIds: number[];
}): Promise<void> {
  const { sport, date, verbose, writeMode, preCount, gameIds } = args;

  console.log();
  console.log("━━━ V2: /splits-anchored discovery + per-game upsert (dry-run preview) ━━━");
  const dry = await linesService.refreshGameLinesV2(sport, date, { dryRun: true });
  const details = dry.details as V2RefreshDetails;

  console.log(`  Provider API calls made:              ${dry.api_calls_made}`);
  console.log(`  Events discovered (/splits):          ${details.discovery.eventsDiscovered}`);
  console.log(`  Events resolved to DB game:           ${details.discovery.eventsResolvedToGame}`);
  console.log(`  Events with suffixed event_id (/EV):  ${details.discovery.eventsWithSuffixedId}`);
  console.log(`  Events using /splits id only:         ${details.discovery.eventsWithSplitsIdOnly}`);
  if (details.discovery.opportunitiesUnavailable) {
    console.log(
      "  ⚠ /opportunities/ev unavailable — all events will use /splits stripped event_id."
    );
  }

  const ss = details.discovery.splitsStats;
  console.log();
  console.log("━━━ /splits filter breakdown ━━━");
  console.log(`  total rows:               ${ss.totalRows}`);
  console.log(`  kept:                     ${ss.keptRows}`);
  console.log(`  skipped non-mlb:          ${ss.skippedNonMlb}`);
  console.log(`  skipped missing event_id: ${ss.skippedMissingEventId}`);
  console.log(`  skipped date-unparseable: ${ss.skippedDateUnparseable}`);
  console.log(`  skipped wrong-date:       ${ss.skippedWrongDate}`);
  console.log(`  skipped team-unresolved:  ${ss.skippedTeamUnresolved}`);

  console.log();
  console.log("━━━ Per-game decisions (would-write) ━━━");
  console.log(
    "  game_id  ext_id      home/away      ml/tot/spr  per-market    books  decision"
  );
  for (const d of details.per_game_decisions) {
    const ext = String(d.external_id).padStart(8);
    const pg = details.discovery.perGame.find(
      (g) => g.gameExternalId === d.external_id
    );
    const teams = pg !== undefined ? `${pg.away}@${pg.home}` : "—@—";
    const counts = `${d.ml_rows}/${d.total_rows}/${d.spread_rows}`;
    console.log(
      `  ${String(d.game_id).padStart(7)}  ${ext}  ${teams.padEnd(14)} ${counts.padEnd(10)} ${marketDecisionsBadge(
        d.market_decisions
      ).padEnd(13)} ${String(d.books_count).padStart(5)}  ${decisionLabel(d.decision)}`
    );
  }

  console.log();
  console.log("━━━ Coverage (lines table, game-level only) ━━━");
  const cb = details.coverage_before;
  const ca = details.coverage_after;
  const slate = gameIds.length;
  console.log(
    `  before:  games_with_any=${cb.games_with_any_line}/${slate}  ml=${cb.games_with_ml}/${slate}  total=${cb.games_with_total}/${slate}  spread=${cb.games_with_spread}/${slate}  rows=${cb.total_game_rows}`
  );
  console.log(
    `  after  : games_with_any=${ca.games_with_any_line}/${slate}  ml=${ca.games_with_ml}/${slate}  total=${ca.games_with_total}/${slate}  spread=${ca.games_with_spread}/${slate}  rows≈${ca.total_game_rows}`
  );

  console.log();
  console.log("━━━ Decision counts ━━━");
  console.log(`  games fully replaced:        ${details.games_fully_replaced}`);
  console.log(`  games partially refreshed:   ${details.games_partially_refreshed}`);
  console.log(`  (game,market) DELETE-INSERT: ${details.replace_targets_count}`);
  console.log(`  preserved (no data):         ${details.preserved_no_data_count}`);
  console.log(`  preserved (no event):        ${details.preserved_unresolved_count}`);
  console.log(`  preserved (call cap):        ${details.preserved_call_cap_count}`);
  if (details.skipped_game_external_ids.length > 0) {
    console.log(
      `  skipped (no slate match):    ${details.skipped_game_external_ids.length}`
    );
    if (verbose) {
      console.log(`    external_ids: ${details.skipped_game_external_ids.join(", ")}`);
    }
  }

  console.log();
  console.log("━━━ Market coverage gate assessment (post-V2, read-only) ━━━");
  // Run the gate against the CURRENT DB state. In dry-run this is the
  // pre-state (unchanged); in apply mode it would be the post-state.
  // The gate is purely informational here — never blocks the run.
  const gate = await assessMarketCoverage(sport, date);
  console.log(`  overall:                ${gate.overall.toUpperCase()}`);
  console.log(`  games_with_ml_lines:    ${gate.aggregate.games_with_ml_lines}/${gate.aggregate.total_games} (${gate.aggregate.ml_coverage_pct}%)`);
  console.log(`  games_with_total_lines: ${gate.aggregate.games_with_total_lines}/${gate.aggregate.total_games} (${gate.aggregate.total_coverage_pct}%)`);
  console.log(`  games_with_signals:     ${gate.aggregate.games_with_signals}/${gate.aggregate.total_games}`);
  console.log(`  signals but no lines:   ${gate.aggregate.games_with_signals_no_lines}`);
  console.log(`  stale lines:            ${gate.aggregate.games_with_stale_lines}`);
  for (const r of gate.reasons) console.log(`  · ${r}`);

  console.log();
  console.log("━━━ Tables that would be written ━━━");
  console.log(`  lines        (per-game DELETE then INSERT on replaced games): ${dry.records_updated} row(s)`);
  console.log(`  line_history (APPEND-only audit):                             ${dry.records_updated} row(s)`);
  console.log(`  Other tables: none. No predictions, no publish, no signals, no props.`);

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    const refreshedGames =
      details.games_fully_replaced + details.games_partially_refreshed;
    if (refreshedGames === 0) {
      console.log("  🟡 V2 dry-run produced 0 refreshed games. Possibilities:");
      console.log("     - /splits returned empty for this date");
      console.log("     - /odds returned empty for all matched events");
      console.log("     - Slate team-pair resolution failed for all events");
    } else {
      const preservedGames =
        details.preserved_no_data_count +
        details.preserved_unresolved_count +
        details.preserved_call_cap_count;
      console.log(
        `  🟢 V2 would refresh ${refreshedGames}/${gameIds.length} games ` +
          `(${details.games_fully_replaced} full + ${details.games_partially_refreshed} partial). ` +
          `${preservedGames} game(s) preserve existing rows (no silent slate-wide DELETE).`
      );
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY V2.
  const preserveCount =
    details.preserved_no_data_count +
    details.preserved_unresolved_count +
    details.preserved_call_cap_count;
  const refreshedGames =
    details.games_fully_replaced + details.games_partially_refreshed;
  const confirmed = await confirmApplyV2(
    sport,
    date,
    refreshedGames,
    preserveCount
  );
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via linesService.refreshGameLinesV2 (per-(game,market) DELETE then INSERT)…");
  const result = await linesService.refreshGameLinesV2(sport, date);
  const resultDetails = result.details as V2RefreshDetails;
  console.log(`  records_updated:             ${result.records_updated}`);
  console.log(`  api_calls_made:              ${result.api_calls_made}`);
  console.log(`  games fully replaced:        ${resultDetails.games_fully_replaced}`);
  console.log(`  games partially refreshed:   ${resultDetails.games_partially_refreshed}`);
  console.log(`  (game,market) DELETE-INSERT: ${resultDetails.replace_targets_count}`);
  console.log(`  preserved:                   ${preserveCount}`);

  const postCount = await countExistingGameLines(gameIds);
  console.log();
  console.log("━━━ Post-state ━━━");
  console.log(`  Game-level lines rows for ${sport}/${date}: ${postCount}`);
  console.log(`  (was ${preCount} before)`);

  console.log();
  console.log("APPLY complete. Re-run the coverage gate to verify:");
  console.log("  Or proceed to refresh-sharp-signals + automodel.");
}

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
  const strategy = resolveStrategy(argv);

  console.log(
    `[refresh-lines] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } strategy=${strategy} provider=real_api(source:${
      providerResolution.source === "neither" ? "?" : providerResolution.source
    }) sport=${common.sport} date=${common.date} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("           DRY RUN — NO DB WRITES");
  }
  if (strategy === "v2") {
    console.log(
      "           V2 strategy: /splits-anchored discovery + per-game upsert."
    );
    console.log(
      "           V2 preserves existing rows for games where the provider"
    );
    console.log(
      "           returned no data (no silent slate-wide DELETE)."
    );
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

  if (strategy === "v2") {
    await runV2Flow({
      sport: common.sport,
      date: common.date,
      verbose: common.verbose,
      writeMode,
      preCount,
      gameIds,
    });
    return;
  }

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
