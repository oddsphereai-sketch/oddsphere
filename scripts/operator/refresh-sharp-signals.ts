/**
 * Phase 4.1.9.C-1 — Operator script: refresh sharp signals for one slate.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/refresh-sharp-signals.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--verbose] \
 *     [--provider real_api] \
 *     [--apply]
 *
 * GUARDS (defense in depth):
 *   1. Provider mode must be explicitly real_api. The script will NOT
 *      silently route to SharpAPI. Either:
 *        • set SHARP_SIGNAL_PROVIDER=real_api in the environment, OR
 *        • pass --provider real_api on the command line
 *      Anything else (mock, manual, unset) → script refuses to run and
 *      explains what's needed. Keeps local quota safe.
 *
 *   2. Writes require TWO keys: --apply AND
 *      SHARP_SIGNAL_DB_WRITES_ENABLED=true. Without both, the script
 *      runs dry-run regardless of --apply.
 *
 *   3. --apply also triggers an interactive y/N confirmation showing
 *      the exact sport/date and signal count about to be written.
 *
 * DEFAULT BEHAVIOR (no --apply): DRY-RUN
 *   • Calls SharpAPISignalProvider.getSharpSignals(date) — real API.
 *   • Runs the same mapping/merge logic the cron uses (via
 *     linesService.refreshSharpSignals with { dryRun: true }).
 *   • Logs total signals, per-market coverage, public-split coverage
 *     for ML/Total, unmatched rows, games-with-no-opportunity.
 *   • Does NOT delete or insert into sharp_signals.
 *   • Prints DRY RUN — NO DB WRITES banner.
 *
 * APPLY BEHAVIOR (--apply + env flag + confirm):
 *   • All of the above plus the DELETE-then-INSERT scoped to this
 *     sport/date's game_ids only.
 *   • Reports rows inserted, skipped game external ids.
 *   • No prediction writes. No DDL. No cron changes.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readStringFlag,
  readBoolFlag,
} from "./_cliCommon";
import { linesService } from "../../lib/services/linesService";
import { loadGameIdMap } from "../../lib/services/_idMaps";
import { getSharpSignalProvider } from "../../lib/providers/factory";
import { SharpAPISignalProvider } from "../../lib/providers/real_api/SharpAPISignalProvider";
import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

// ─── provider gate ────────────────────────────────────────────────────

type ProviderMode = "mock" | "manual" | "real_api";

function resolveExplicitProviderMode(argv: readonly string[]): {
  ok: boolean;
  mode: ProviderMode | null;
  source: "flag" | "env" | "neither";
  reason: string | null;
} {
  const flagRaw = readStringFlag(argv, "--provider");
  const envRaw = process.env.SHARP_SIGNAL_PROVIDER;

  const flag = isProviderMode(flagRaw) ? flagRaw : null;
  const env = isProviderMode(envRaw) ? envRaw : null;

  // Flag wins if both set. Validate both first so a typo on either is
  // surfaced rather than silently ignored.
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
      reason: `Invalid SHARP_SIGNAL_PROVIDER="${envRaw}". Expected one of: mock, manual, real_api.`,
    };
  }

  if (flag !== null) {
    return { ok: true, mode: flag, source: "flag", reason: null };
  }
  if (env !== null) {
    return { ok: true, mode: env, source: "env", reason: null };
  }
  return {
    ok: true,
    mode: null,
    source: "neither",
    reason: null,
  };
}

function isProviderMode(v: unknown): v is ProviderMode {
  return v === "mock" || v === "manual" || v === "real_api";
}

function refuseUnlessRealApi(
  mode: ProviderMode | null,
  source: "flag" | "env" | "neither"
): void {
  if (mode === "real_api") return;
  console.error(
    [
      "✗ This script intentionally refuses to call SharpAPI unless the",
      "  provider is EXPLICITLY set to real_api.",
      "",
      `  Currently: ${
        source === "neither"
          ? "no provider mode set (would default to mock via factory)"
          : `provider=${mode} (source: ${source})`
      }.`,
      "",
      "  To run this script against the live SharpAPI:",
      "    SHARP_SIGNAL_PROVIDER=real_api npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-sharp-signals.ts [...flags]",
      "",
      "  OR pass --provider real_api on the command line:",
      "    npx tsx --env-file=.env.local scripts/operator/refresh-sharp-signals.ts \\",
      "      --provider real_api [...flags]",
      "",
      "  Reason: avoid accidentally burning provider quota from local",
      "  invocations. Phase 4.1.9.C-1 guard.",
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
  const envEnabled =
    process.env.SHARP_SIGNAL_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires SHARP_SIGNAL_DB_WRITES_ENABLED=true in the",
      "  environment. Two-key gate: both must be present before any",
      "  sharp_signals write happens. To opt in for this command:",
      "",
      "    SHARP_SIGNAL_DB_WRITES_ENABLED=true SHARP_SIGNAL_PROVIDER=real_api \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-sharp-signals.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(sport: Sport, date: string, signalCount: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to DELETE and re-INSERT sharp_signals for sport=${sport} date=${date}.\n` +
        `  Signals fetched from provider: ${signalCount}\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── raw SharpAPI probe ───────────────────────────────────────────────

/**
 * Hit /opportunities/* + /splits directly via the provider's underlying
 * client. Counts raw rows and inspects /splits row shape so the script
 * can distinguish "SharpAPI returned nothing" from "our slate isn't
 * ingested so mapping dropped everything". Only runs when the provider
 * is a SharpAPISignalProvider — mock provider returns zeros.
 */
type RawProbeResult = {
  ev: number;
  lowHold: number;
  arbitrage: number;
  splits: number;
  splitsWithMl: number;
  splitsWithTotal: number;
  splitsWithSpread: number;
  splitsHandlePctPopulated: number;
  splitsBetsPctPopulated: number;
  evSampleKeys: string[];
  lowHoldSampleKeys: string[];
  arbitrageSampleKeys: string[];
  splitsSampleKeys: string[];
  splitsHistoryAvailable: boolean;
  splitsHistoryRows: number;
  splitsHistorySampleKeys: string[];
  oddsSampleEventId: string | null;
  oddsSampleRowCount: number;
  oddsSampleKeys: string[];
  oddsSampleMarketTypes: string[];
};

async function probeRawSharpApi(
  provider: unknown,
  verbose: boolean
): Promise<RawProbeResult> {
  const empty: RawProbeResult = {
    ev: 0,
    lowHold: 0,
    arbitrage: 0,
    splits: 0,
    splitsWithMl: 0,
    splitsWithTotal: 0,
    splitsWithSpread: 0,
    splitsHandlePctPopulated: 0,
    splitsBetsPctPopulated: 0,
    evSampleKeys: [],
    lowHoldSampleKeys: [],
    arbitrageSampleKeys: [],
    splitsSampleKeys: [],
    splitsHistoryAvailable: false,
    splitsHistoryRows: 0,
    splitsHistorySampleKeys: [],
    oddsSampleEventId: null,
    oddsSampleRowCount: 0,
    oddsSampleKeys: [],
    oddsSampleMarketTypes: [],
  };
  if (!(provider instanceof SharpAPISignalProvider)) return empty;

  const client = provider.getClient() as {
    fetchAll: <T>(opts: { path: string; query: Record<string, string>; maxPages?: number }) => Promise<T[]>;
  };

  type AnyRow = Record<string, unknown>;
  type SplitMarketCell = { bets_pct?: Record<string, number | null> | null; handle_pct?: Record<string, number | null> | null };
  type SplitsRow = AnyRow & {
    moneyline?: SplitMarketCell | null;
    total?: SplitMarketCell | null;
    spread?: SplitMarketCell | null;
  };

  async function safeFetch<T>(path: string): Promise<T[]> {
    try {
      return await client.fetchAll<T>({ path, query: { sport: "mlb" }, maxPages: 2 });
    } catch (e) {
      if (verbose) console.log(`  (raw probe) ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  const [ev, lowHold, arbitrage, splits] = await Promise.all([
    safeFetch<AnyRow>("/opportunities/ev"),
    safeFetch<AnyRow>("/opportunities/low_hold"),
    safeFetch<AnyRow>("/opportunities/arbitrage"),
    safeFetch<SplitsRow>("/splits"),
  ]);

  // One-time probe — does /splits/history exist on this tier? Catch the
  // 404 silently and report.
  let splitsHistoryAvailable = false;
  let splitsHistoryRows = 0;
  let splitsHistorySampleKeys: string[] = [];
  try {
    const rows = await client.fetchAll<AnyRow>({
      path: "/splits/history",
      query: { sport: "mlb" },
      maxPages: 1,
    });
    splitsHistoryAvailable = true;
    splitsHistoryRows = rows.length;
    if (rows[0]) splitsHistorySampleKeys = Object.keys(rows[0]).sort();
  } catch (e) {
    if (verbose) {
      console.log(`  (raw probe) /splits/history not available: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // One-time probe — fetch /odds for a sample event so we know what the
  // odds rows look like beyond what SharpAPIOddsProvider extracts.
  let oddsSampleEventId: string | null = null;
  let oddsSampleRows: AnyRow[] = [];
  if (ev.length > 0) {
    const firstId = ev[0]?.event_id;
    if (typeof firstId === "string" && firstId.length > 0) {
      oddsSampleEventId = firstId;
      try {
        oddsSampleRows = await client.fetchAll<AnyRow>({
          path: "/odds",
          query: { event_id: firstId },
          maxPages: 1,
        });
      } catch (e) {
        if (verbose) {
          console.log(`  (raw probe) /odds sample failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  let splitsWithMl = 0;
  let splitsWithTotal = 0;
  let splitsWithSpread = 0;
  let splitsHandlePctPopulated = 0;
  let splitsBetsPctPopulated = 0;

  for (const row of splits) {
    if (row.moneyline) splitsWithMl++;
    if (row.total) splitsWithTotal++;
    if (row.spread) splitsWithSpread++;
    const mlHandle = row.moneyline?.handle_pct;
    const mlBets = row.moneyline?.bets_pct;
    const totHandle = row.total?.handle_pct;
    const totBets = row.total?.bets_pct;
    if (mlHandle || totHandle) splitsHandlePctPopulated++;
    if (mlBets || totBets) splitsBetsPctPopulated++;
  }

  if (verbose && splits.length > 0) {
    const first = splits[0]!;
    console.log("  (raw probe) /splits sample row:");
    console.log(`    event_id:   ${String(first.event_id ?? "(none)")}`);
    console.log(`    teams:      ${String(first.home_team ?? "?")} vs ${String(first.away_team ?? "?")}`);
    console.log(`    sportsbook: ${String(first.sportsbook ?? "(none)")}`);
    console.log(`    moneyline:  ${JSON.stringify(first.moneyline ?? null)}`);
    console.log(`    total:      ${JSON.stringify(first.total ?? null)}`);
  }

  const oddsMarketTypes = new Set<string>();
  for (const r of oddsSampleRows) {
    const mt = r.market_type;
    if (typeof mt === "string") oddsMarketTypes.add(mt);
  }

  return {
    ev: ev.length,
    lowHold: lowHold.length,
    arbitrage: arbitrage.length,
    splits: splits.length,
    splitsWithMl,
    splitsWithTotal,
    splitsWithSpread,
    splitsHandlePctPopulated,
    splitsBetsPctPopulated,
    evSampleKeys: ev[0] ? Object.keys(ev[0]).sort() : [],
    lowHoldSampleKeys: lowHold[0] ? Object.keys(lowHold[0]).sort() : [],
    arbitrageSampleKeys: arbitrage[0] ? Object.keys(arbitrage[0]).sort() : [],
    splitsSampleKeys: splits[0] ? Object.keys(splits[0]).sort() : [],
    splitsHistoryAvailable,
    splitsHistoryRows,
    splitsHistorySampleKeys,
    oddsSampleEventId,
    oddsSampleRowCount: oddsSampleRows.length,
    oddsSampleKeys: oddsSampleRows[0] ? Object.keys(oddsSampleRows[0]).sort() : [],
    oddsSampleMarketTypes: Array.from(oddsMarketTypes).sort(),
  };
}

// ─── endpoint field classification ────────────────────────────────────

/**
 * Classify each field of a SharpAPI endpoint as launch-critical (L),
 * V1.1-useful (1.1), or ignore (─). Drives the "what should we extract"
 * report in the dry-run output.
 *
 * Classifications reflect the v13.1 Daily Edge surface area:
 *   - L: already extracted OR clearly needed for v13.1 UI (Edge Stack,
 *        verdict, Sharp Read, splits, prices)
 *   - 1.1: useful additions like sharp_book, kelly_percent, market_width,
 *          confidence — could power Tracking analytics or richer cards
 *   - ─: meta/diagnostic fields (id, deep_link, league_label, etc.) or
 *        fields only meaningful inside SharpAPI's own ecosystem
 */
const FIELD_CLASSIFICATION: Record<string, Record<string, "L" | "1.1" | "─">> = {
  "/opportunities/ev": {
    // Core identifiers
    event_id: "L", event_name: "─", external_event_id: "─", id: "─",
    sport: "L", league: "L", start_time: "L",
    home_team: "L", away_team: "L",
    // Market + selection
    market_type: "L", market_id: "─", selection: "L", selection_id: "─",
    display_selection: "1.1", side: "L", line: "L",
    // Pricing + EV (the core extraction)
    odds_american: "L", odds_decimal: "L", odds_probability: "L",
    no_vig_odds: "1.1",
    pinnacle_fair_probability: "L", partner_fair_probability: "L",
    fair_probability: "L",
    ev_percentage: "L", ev_pct: "L",
    devig_method: "1.1", kelly_percent: "1.1",
    // Sharp book reference + book depth
    sharp_book: "1.1", sportsbook: "L", sportsbooks: "1.1", book_count: "1.1",
    // Cross-ref / market depth (V1.1 — could power "confirmed by N books" copy)
    cross_ref_count: "1.1", cross_ref_dispersion: "1.1",
    market_width: "1.1", confidence: "1.1",
    // Timestamps
    detected_at: "L", oldest_odds_age_seconds: "1.1",
    // Flags
    is_alternate_line: "L", is_player_prop: "L", is_live: "L",
    possibly_stale: "1.1", arb_available: "1.1", arb_profit: "1.1",
    // Metadata we don't need
    deep_link: "─", player_name: "─", player_id: "─", stat_category: "─",
    warnings: "─",
  },
  "/opportunities/low_hold": {
    event_id: "L", event_name: "─", id: "─",
    sport: "L", league: "L", league_label: "─", start_time: "L",
    home_team: "L", away_team: "L",
    market_type: "L", market_label: "─", line: "L",
    side1: "L", side2: "L", side3: "1.1",
    hold_percentage: "1.1",       // "market width" — could power "tight market" UX
    all_books: "1.1",
    detected_at: "L", odds_age_seconds: "1.1",
    is_alternate_line: "L", is_player_prop: "L", is_live: "L",
    possibly_stale: "1.1",
    player_name: "─", stat_category: "─",
  },
  "/opportunities/arbitrage": {
    event_id: "L", event_name: "─", id: "─",
    sport: "L", league: "L", league_label: "─", start_time: "L",
    market_type: "L", market_label: "─", line: "L",
    legs: "1.1",
    profit_percent: "1.1", estimated_net_profit_percent: "1.1",
    ev_available: "1.1", ev_percentage: "1.1",
    implied_total: "1.1",
    detected_at: "L", oldest_odds_age_seconds: "1.1",
    is_alternate_line: "L", is_player_prop: "L", is_live: "L",
    possibly_stale: "1.1",
    player_name: "─", stat_category: "─", warnings: "─",
  },
  "/splits": {
    event_id: "L", sport: "L", league: "L",
    home_team: "L", away_team: "L",
    sportsbook: "1.1",            // currently dropped; "consensus" is fine for V1
    moneyline: "L", total: "L", spread: "1.1",
    fetched_at: "L",
  },
  "/odds": {
    event_id: "L", sport: "L", league: "L",
    market_type: "L", sportsbook: "L",
    selection_type: "L", selection: "L", line: "L",
    odds_american: "L", odds_decimal: "L", odds_probability: "L",
    last_seen_at: "L", wire_received_at: "L",
    is_alternate_line: "L", is_live: "L",
    market_id: "─", id: "─",
  },
};

const CURRENTLY_PERSISTED: Record<string, Record<string, string>> = {
  "/opportunities/ev": {
    pinnacle_fair_probability: "sharp_signals.pinnacle_fair_probability",
    partner_fair_probability:  "sharp_signals.pinnacle_fair_probability (fallback)",
    fair_probability:          "sharp_signals.pinnacle_fair_probability (fallback)",
    ev_percentage:             "sharp_signals.ev_pct",
    ev_pct:                    "sharp_signals.ev_pct",
    selection:                 "sharp_signals.side (mapped)",
    market_type:               "sharp_signals.market_type (mapped)",
    home_team:                 "→ resolveGame → game_id",
    away_team:                 "→ resolveGame → game_id",
    detected_at:               "sharp_signals.computed_at",
    is_alternate_line:         "(filter only)",
    is_player_prop:            "(filter only)",
    league:                    "(filter only)",
  },
  "/opportunities/low_hold": {
    // SharpAPISignalProvider stores low_hold rows as SharpSignalRecord with is_plus_ev=false
    market_type:               "sharp_signals.market_type",
    home_team:                 "→ resolveGame → game_id",
    away_team:                 "→ resolveGame → game_id",
    detected_at:               "sharp_signals.computed_at",
  },
  "/opportunities/arbitrage": {
    market_type:               "sharp_signals.market_type",
    home_team:                 "→ resolveGame → game_id",
    away_team:                 "→ resolveGame → game_id",
    detected_at:               "sharp_signals.computed_at",
  },
  "/splits": {
    moneyline:                 "sharp_signals.public_betting_pct + public_money_pct (× 100)",
    total:                     "sharp_signals.public_betting_pct + public_money_pct (× 100)",
    home_team:                 "→ team-pair merge key",
    away_team:                 "→ team-pair merge key",
  },
  "/odds": {
    market_type:               "lines.market_type (mapped)",
    sportsbook:                "lines.sportsbook",
    selection_type:            "lines.side (mapped)",
    line:                      "lines.line_value",
    odds_american:             "lines.odds_american",
    odds_decimal:              "lines.odds_decimal",
    odds_probability:          "lines.implied_probability",
    last_seen_at:              "lines.fetched_at",
    wire_received_at:          "lines.fetched_at (fallback)",
  },
};

function printEndpointAuditTable(
  endpoint: string,
  sampleKeys: string[],
  rowCount: number
): void {
  console.log();
  console.log(`ENDPOINT: ${endpoint}  (rows=${rowCount})`);
  console.log("─".repeat(72));
  console.log("  Field                              Persisted?         Where / V1?");
  console.log("─".repeat(72));
  const cls = FIELD_CLASSIFICATION[endpoint] ?? {};
  const pers = CURRENTLY_PERSISTED[endpoint] ?? {};
  for (const f of sampleKeys) {
    const tag = cls[f] ?? "─";
    const where = pers[f];
    const persistedMark = where ? "✓" : "─";
    const whereStr = where ?? `(not stored)         [${tag}]`;
    const tagStr = where ? `  [${tag}]` : "";
    console.log(`  ${f.padEnd(34)} ${persistedMark.padEnd(18)} ${whereStr}${tagStr}`);
  }
}

// ─── first-inning data availability audit ─────────────────────────────

/**
 * Audit what data is available for the v13.1 first-inning card across
 * existing production-source games in the DB. Read-only.
 *
 * For each production-source MLB game in the last 14 days, check:
 *   - Has current first_inning_total lines row(s)?
 *   - Has line_history row(s) for first_inning_total?
 *   - Has Pinnacle line for first_inning_total?
 *   - Has nrfi_expected_runs in sport_specific.auto_factors?
 *   - Has nrfi_used_top_of_order_data?
 *   - Has home_starter_era / away_starter_era?
 *   - Has park_factor_runs / weather_total_adjust?
 *
 * Report coverage so we know what the v13.1 1st-inning card can show
 * even without public splits.
 */
async function auditFirstInningAvailability(verbose: boolean): Promise<void> {
  console.log();
  console.log("━━━ First-inning data availability (across production-source games) ━━━");

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 14);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = today.toISOString().slice(0, 10);

  // Find production-source game IDs in the window
  const { data: games } = await supabase
    .from("games")
    .select("id, slate_date")
    .eq("sport", "mlb")
    .gte("slate_date", fromStr)
    .lte("slate_date", toStr);
  const allIds = (games ?? []).map((g) => g.id);
  if (allIds.length === 0) {
    console.log(`  No MLB games in DB for ${fromStr} → ${toStr}. Cannot audit.`);
    return;
  }
  const { data: prodPreds } = await supabase
    .from("game_predictions")
    .select("game_id, sport_specific")
    .in("game_id", allIds)
    .in("source_type", ["manual", "real_api"]);
  const prodGameIds = (prodPreds ?? []).map((p) => p.game_id);
  if (prodGameIds.length === 0) {
    console.log(`  No production-source games in window. Cannot audit.`);
    return;
  }

  console.log(`  Window: ${fromStr} → ${toStr}`);
  console.log(`  Production-source games:        ${prodGameIds.length}`);

  // 1. Current first_inning_total lines
  const { data: fiLines } = await supabase
    .from("lines")
    .select("game_id, sportsbook, odds_american, line_value")
    .in("game_id", prodGameIds)
    .eq("market_type", "first_inning_total");
  const fiLinesByGame = new Map<number, typeof fiLines>();
  for (const ln of fiLines ?? []) {
    if (!fiLinesByGame.has(ln.game_id)) fiLinesByGame.set(ln.game_id, []);
    fiLinesByGame.get(ln.game_id)!.push(ln);
  }
  const gamesWithFiLine = fiLinesByGame.size;
  let gamesWithPinnacleFi = 0;
  let gamesWithOddsAmerican = 0;
  for (const [, lns] of fiLinesByGame) {
    if (lns!.some((l) => l.sportsbook === "pinnacle")) gamesWithPinnacleFi++;
    if (lns!.some((l) => l.odds_american !== null)) gamesWithOddsAmerican++;
  }

  // 2. line_history rows for first_inning_total
  const { data: fiHist } = await supabase
    .from("line_history")
    .select("game_id, recorded_at, odds_american, sportsbook, is_opener")
    .in("game_id", prodGameIds)
    .eq("market_type", "first_inning_total");
  const histByGame = new Map<number, typeof fiHist>();
  for (const h of fiHist ?? []) {
    if (!histByGame.has(h.game_id)) histByGame.set(h.game_id, []);
    histByGame.get(h.game_id)!.push(h);
  }
  let gamesWithFiHistory = 0;
  let gamesWithFiHistoryMoreThanOne = 0;
  let gamesWithOpenerFlag = 0;
  for (const [, rows] of histByGame) {
    gamesWithFiHistory++;
    if ((rows?.length ?? 0) > 1) gamesWithFiHistoryMoreThanOne++;
    if (rows!.some((r) => r.is_opener === true)) gamesWithOpenerFlag++;
  }

  // 3. auto_factors fields (nrfi-relevant + starter/park/weather)
  let withNrfiExpectedRuns = 0;
  let withTopOfOrderFlag = 0;
  let withHomeStarterEra = 0;
  let withAwayStarterEra = 0;
  let withParkFactor = 0;
  let withWeatherAdjust = 0;
  let withLineupOps = 0;
  for (const p of prodPreds ?? []) {
    const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
    const af = ss.auto_factors as Record<string, unknown> | undefined;
    if (!af) continue;
    if (af.nrfi_expected_runs !== null && af.nrfi_expected_runs !== undefined) withNrfiExpectedRuns++;
    if (af.nrfi_used_top_of_order_data !== null && af.nrfi_used_top_of_order_data !== undefined) withTopOfOrderFlag++;
    if (af.home_starter_era !== null && af.home_starter_era !== undefined) withHomeStarterEra++;
    if (af.away_starter_era !== null && af.away_starter_era !== undefined) withAwayStarterEra++;
    if (af.park_factor_runs !== null && af.park_factor_runs !== undefined) withParkFactor++;
    if (af.weather_total_adjust !== null && af.weather_total_adjust !== undefined) withWeatherAdjust++;
    if (
      (af.home_lineup_weighted_ops !== null && af.home_lineup_weighted_ops !== undefined) &&
      (af.away_lineup_weighted_ops !== null && af.away_lineup_weighted_ops !== undefined)
    ) {
      withLineupOps++;
    }
  }

  const total = prodGameIds.length;
  const row = (label: string, num: number) => `${label.padEnd(46)} ${num}/${total} (${pct(num, total)})`;

  console.log();
  console.log("  ── Price / movement (the 1st-inning Edge Stack ingredients) ──");
  console.log(`  ${row("games with current FI line row(s)", gamesWithFiLine)}`);
  console.log(`  ${row("games with Pinnacle FI line", gamesWithPinnacleFi)}`);
  console.log(`  ${row("games with FI odds_american populated", gamesWithOddsAmerican)}`);
  console.log(`  ${row("games with FI line_history rows", gamesWithFiHistory)}`);
  console.log(`  ${row("games with > 1 FI line_history row (movement derivable)", gamesWithFiHistoryMoreThanOne)}`);
  console.log(`  ${row("games with is_opener=true in FI line_history", gamesWithOpenerFlag)}`);
  console.log("  Note: is_opener is hardcoded to false by linesService.refreshGameLines.");
  console.log("        For V1, use MIN(recorded_at) as 'first-seen' rather than is_opener.");

  console.log();
  console.log("  ── Matchup factors (auto_factors) ──");
  console.log(`  ${row("nrfi_expected_runs populated", withNrfiExpectedRuns)}`);
  console.log(`  ${row("nrfi_used_top_of_order_data populated", withTopOfOrderFlag)}`);
  console.log(`  ${row("home_starter_era populated", withHomeStarterEra)}`);
  console.log(`  ${row("away_starter_era populated", withAwayStarterEra)}`);
  console.log(`  ${row("park_factor_runs populated", withParkFactor)}`);
  console.log(`  ${row("weather_total_adjust populated", withWeatherAdjust)}`);
  console.log(`  ${row("lineup_weighted_ops both sides populated", withLineupOps)}`);

  if (verbose) {
    console.log();
    console.log("  Production game IDs audited:", prodGameIds.join(", "));
  }
}

// ─── report types ─────────────────────────────────────────────────────

type CoverageRow = {
  market: "moneyline" | "total" | "first_inning_total" | "spread";
  signalCount: number;
  withPublicMoneyPct: number;
  withPublicBettingPct: number;
};

type Report = {
  sport: Sport;
  date: string;
  slateGames: number;
  providerSignalsTotal: number;
  matchedToSlate: number;
  unmatchedExternalIds: number[];
  perMarket: CoverageRow[];
  gamesWithAnySignal: number;
  gamesWithMlSignal: number;
  gamesWithTotalSignal: number;
  gamesWithFirstInningSignal: number;
  // Field-presence detail across the matched signals
  presence: {
    pinnacle_fair_probability: number;
    is_plus_ev: number;
    ev_pct: number;
    has_steam_move: number;
    has_reverse_line_movement: number;
  };
};

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);

  // Step 1 — explicit provider gate.
  const providerResolution = resolveExplicitProviderMode(argv);
  if (!providerResolution.ok) {
    console.error(`✗ ${providerResolution.reason}`);
    process.exit(1);
  }
  // If the flag was used, push it into env BEFORE the factory reads it.
  // Defense: only set the env var if the flag was the source (env is
  // already set otherwise). Factory caches the provider singleton on
  // first read, so this must happen before any factory call below.
  if (providerResolution.source === "flag" && providerResolution.mode !== null) {
    process.env.SHARP_SIGNAL_PROVIDER = providerResolution.mode;
  }
  refuseUnlessRealApi(providerResolution.mode, providerResolution.source);

  // Step 2 — apply gate (--apply + env flag, both required).
  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  // ── Banner ──
  console.log(
    `[refresh-sharp-signals] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } provider=real_api(source:${
      providerResolution.source === "neither" ? "?" : providerResolution.source
    }) sport=${common.sport} date=${common.date} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("           DRY RUN — NO DB WRITES");
  }

  // Step 3a — raw SharpAPI probe BEFORE the provider's mapping pass.
  // The provider drops every row whose team-pair doesn't resolve to a
  // game in our DB for the requested date, which can hide whether
  // SharpAPI itself is returning data. Probing the raw endpoints first
  // separates "SharpAPI returned nothing" from "our slate isn't ingested".
  const provider = getSharpSignalProvider();
  const raw = await probeRawSharpApi(provider, common.verbose);

  // Step 3b — full provider call (includes /splits merge + game-id mapping).
  const providerSignals = await provider.getSharpSignals(common.date);

  const gameIdByExternal = await loadGameIdMap(common.sport, common.date);

  // Build coverage tables.
  const report: Report = {
    sport: common.sport,
    date: common.date,
    slateGames: gameIdByExternal.size,
    providerSignalsTotal: providerSignals.length,
    matchedToSlate: 0,
    unmatchedExternalIds: [],
    perMarket: [],
    gamesWithAnySignal: 0,
    gamesWithMlSignal: 0,
    gamesWithTotalSignal: 0,
    gamesWithFirstInningSignal: 0,
    presence: {
      pinnacle_fair_probability: 0,
      is_plus_ev: 0,
      ev_pct: 0,
      has_steam_move: 0,
      has_reverse_line_movement: 0,
    },
  };

  const marketAgg = new Map<
    string,
    { signalCount: number; withPublicMoneyPct: number; withPublicBettingPct: number }
  >();
  const seenGameExternalsByMarket = {
    moneyline: new Set<number>(),
    total: new Set<number>(),
    first_inning_total: new Set<number>(),
  };
  const seenGameExternalsAny = new Set<number>();
  const unmatched = new Set<number>();

  for (const s of providerSignals) {
    const matched = gameIdByExternal.has(s.game_external_id);
    if (!matched) {
      unmatched.add(s.game_external_id);
      continue;
    }
    report.matchedToSlate++;

    // Per-market coverage.
    if (!marketAgg.has(s.market_type)) {
      marketAgg.set(s.market_type, {
        signalCount: 0,
        withPublicMoneyPct: 0,
        withPublicBettingPct: 0,
      });
    }
    const m = marketAgg.get(s.market_type)!;
    m.signalCount++;
    if (s.public_money_pct !== null) m.withPublicMoneyPct++;
    if (s.public_betting_pct !== null) m.withPublicBettingPct++;

    seenGameExternalsAny.add(s.game_external_id);
    if (s.market_type === "moneyline") seenGameExternalsByMarket.moneyline.add(s.game_external_id);
    else if (s.market_type === "total") seenGameExternalsByMarket.total.add(s.game_external_id);
    else if (s.market_type === "first_inning_total") seenGameExternalsByMarket.first_inning_total.add(s.game_external_id);

    if (s.pinnacle_fair_probability !== null) report.presence.pinnacle_fair_probability++;
    if (s.is_plus_ev) report.presence.is_plus_ev++;
    if (s.ev_pct !== null) report.presence.ev_pct++;
    if (s.has_steam_move) report.presence.has_steam_move++;
    if (s.has_reverse_line_movement) report.presence.has_reverse_line_movement++;
  }

  for (const market of ["moneyline", "total", "first_inning_total", "spread"] as const) {
    const agg = marketAgg.get(market);
    report.perMarket.push({
      market,
      signalCount: agg?.signalCount ?? 0,
      withPublicMoneyPct: agg?.withPublicMoneyPct ?? 0,
      withPublicBettingPct: agg?.withPublicBettingPct ?? 0,
    });
  }

  report.unmatchedExternalIds = Array.from(unmatched).sort((a, b) => a - b);
  report.gamesWithAnySignal = seenGameExternalsAny.size;
  report.gamesWithMlSignal = seenGameExternalsByMarket.moneyline.size;
  report.gamesWithTotalSignal = seenGameExternalsByMarket.total.size;
  report.gamesWithFirstInningSignal = seenGameExternalsByMarket.first_inning_total.size;

  // Games in slate that have no signal at all
  const allSlateExternalIds = new Set(gameIdByExternal.keys());
  const slateWithoutSignal: number[] = [];
  for (const id of allSlateExternalIds) {
    if (!seenGameExternalsAny.has(id)) slateWithoutSignal.push(id);
  }

  // ── Print human-readable report ──
  console.log();
  console.log("━━━ Raw SharpAPI activity (BEFORE mapping) ━━━");
  console.log(`  /opportunities/ev       rows=${raw.ev}`);
  console.log(`  /opportunities/low_hold rows=${raw.lowHold}`);
  console.log(`  /opportunities/arbitrage rows=${raw.arbitrage}`);
  console.log(`  /splits                 rows=${raw.splits}`);
  if (raw.splits > 0) {
    console.log(`    /splits market coverage (across raw rows):`);
    console.log(`      with moneyline market: ${raw.splitsWithMl}/${raw.splits}`);
    console.log(`      with total market:     ${raw.splitsWithTotal}/${raw.splits}`);
    console.log(`      with spread market:    ${raw.splitsWithSpread}/${raw.splits}`);
    console.log(`      handle_pct present (ML/Total): ${raw.splitsHandlePctPopulated}/${raw.splits}`);
    console.log(`      bets_pct present (ML/Total):   ${raw.splitsBetsPctPopulated}/${raw.splits}`);
  }

  console.log();
  console.log("━━━ Slate ━━━");
  console.log(`  Games in slate (DB):                  ${report.slateGames}`);
  console.log(`  Provider signals returned (total):    ${report.providerSignalsTotal}`);
  console.log(`  Provider signals matched to slate:    ${report.matchedToSlate}`);
  console.log(`  Provider signals UNMATCHED:           ${report.unmatchedExternalIds.length}`);
  if (common.verbose && report.unmatchedExternalIds.length > 0) {
    console.log(`    unmatched external_ids: ${report.unmatchedExternalIds.join(", ")}`);
  }

  console.log();
  console.log("━━━ Coverage by market ━━━");
  for (const r of report.perMarket) {
    const moneyPctCov = pct(r.withPublicMoneyPct, r.signalCount);
    const betsPctCov = pct(r.withPublicBettingPct, r.signalCount);
    console.log(
      `  ${r.market.padEnd(20)} signals=${String(r.signalCount).padStart(3)}   public_money_pct=${r.withPublicMoneyPct}/${r.signalCount} (${moneyPctCov})   public_betting_pct=${r.withPublicBettingPct}/${r.signalCount} (${betsPctCov})`
    );
  }

  console.log();
  console.log("━━━ Game coverage (matched only) ━━━");
  console.log(`  Games with ANY signal:                ${report.gamesWithAnySignal}/${report.slateGames} (${pct(report.gamesWithAnySignal, report.slateGames)})`);
  console.log(`  Games with moneyline signal:          ${report.gamesWithMlSignal}/${report.slateGames} (${pct(report.gamesWithMlSignal, report.slateGames)})`);
  console.log(`  Games with total signal:              ${report.gamesWithTotalSignal}/${report.slateGames} (${pct(report.gamesWithTotalSignal, report.slateGames)})`);
  console.log(`  Games with first_inning_total signal: ${report.gamesWithFirstInningSignal}/${report.slateGames} (${pct(report.gamesWithFirstInningSignal, report.slateGames)})  ← expect 0 (V1 limitation)`);
  console.log(`  Games with NO signal at all:          ${slateWithoutSignal.length}/${report.slateGames}`);
  if (common.verbose && slateWithoutSignal.length > 0) {
    console.log(`    external_ids: ${slateWithoutSignal.join(", ")}`);
  }

  console.log();
  console.log("━━━ Field presence (matched signals only) ━━━");
  const matched = report.matchedToSlate;
  console.log(`  pinnacle_fair_probability populated:  ${report.presence.pinnacle_fair_probability}/${matched} (${pct(report.presence.pinnacle_fair_probability, matched)})`);
  console.log(`  is_plus_ev=true:                      ${report.presence.is_plus_ev}/${matched} (${pct(report.presence.is_plus_ev, matched)})`);
  console.log(`  ev_pct populated:                     ${report.presence.ev_pct}/${matched} (${pct(report.presence.ev_pct, matched)})`);
  console.log(`  has_steam_move=true:                  ${report.presence.has_steam_move}/${matched} (Sharp tier: expect 0)`);
  console.log(`  has_reverse_line_movement=true:       ${report.presence.has_reverse_line_movement}/${matched} (Sharp tier: expect 0)`);

  // ── DRY-RUN: stop here ──
  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    const mlCov = report.gamesWithMlSignal / Math.max(report.slateGames, 1);
    const totalCov = report.gamesWithTotalSignal / Math.max(report.slateGames, 1);
    const mlMoneyAgg = marketAgg.get("moneyline");
    const totalMoneyAgg = marketAgg.get("total");
    const mlSplitsCov =
      mlMoneyAgg && mlMoneyAgg.signalCount > 0
        ? mlMoneyAgg.withPublicMoneyPct / mlMoneyAgg.signalCount
        : 0;
    const totalSplitsCov =
      totalMoneyAgg && totalMoneyAgg.signalCount > 0
        ? totalMoneyAgg.withPublicMoneyPct / totalMoneyAgg.signalCount
        : 0;

    console.log(`  ML game coverage:     ${pct(report.gamesWithMlSignal, report.slateGames)}`);
    console.log(`  Total game coverage:  ${pct(report.gamesWithTotalSignal, report.slateGames)}`);
    console.log(`  ML public splits:     ${pct(mlMoneyAgg?.withPublicMoneyPct ?? 0, mlMoneyAgg?.signalCount ?? 0)}  (of matched ML signals)`);
    console.log(`  Total public splits:  ${pct(totalMoneyAgg?.withPublicMoneyPct ?? 0, totalMoneyAgg?.signalCount ?? 0)}  (of matched Total signals)`);
    console.log(`  1st-inning splits:    expected 0 (SharpAPI /splits does not cover first-inning)`);
    console.log();
    console.log("  Next step:");
    // Diagnostic: detect the "SharpAPI working but DB slate not ingested" case.
    const rawSplitsHealthy = raw.splits > 0 && raw.splitsWithMl > 0 && raw.splitsWithTotal > 0;
    if (report.slateGames === 0) {
      console.log("    🟡 NO SLATE — DB has 0 games for this date.");
      console.log(`    SharpAPI ${rawSplitsHealthy ? "IS" : "is NOT"} returning data (raw /splits rows: ${raw.splits}).`);
      if (rawSplitsHealthy) {
        console.log("    Action: ingest the slate first (slateService.refreshGames) so the");
        console.log("    provider can map SharpAPI events to our game IDs. Then re-run.");
      } else {
        console.log("    Action: SharpAPI returned no data either. Could be off-hours");
        console.log("    (post-game-start) or genuinely no MLB activity. Re-run during");
        console.log("    pre-game window (T-2h to T-30m typical).");
      }
    } else if (mlCov < 0.5 && totalCov < 0.5) {
      console.log("    🔴 RED — fewer than 50% of slate games have ML or Total signals.");
      console.log(`    Raw SharpAPI returned ${raw.splits} /splits rows. Check team-pair`);
      console.log("    matching: provider expects normalized MLB team names.");
    } else if (mlSplitsCov >= 0.7 && totalSplitsCov >= 0.7) {
      console.log("    🟢 GREEN — ML/Total split coverage looks healthy. Safe to --apply for a single slate to populate real rows.");
    } else if (mlSplitsCov >= 0.4 || totalSplitsCov >= 0.4) {
      console.log("    🟡 YELLOW — partial split coverage. UI fallback will fire on some cards.");
      console.log("    Acceptable to proceed; confirm with Daniel before flipping crons.");
    } else {
      console.log("    🟡 YELLOW — signals matched but splits sparse. Compare with raw");
      console.log("    /splits row count above to diagnose merge gaps.");
    }
    // ── Endpoint audit (field-by-field classification) ──
    console.log();
    console.log("━━━ Endpoint audit — what SharpAPI returns vs. what we persist ━━━");
    console.log("Legend: ✓=persisted today, ─=not stored. [L]=launch-critical, [1.1]=V1.1, [─]=ignore.");
    printEndpointAuditTable("/opportunities/ev", raw.evSampleKeys, raw.ev);
    printEndpointAuditTable("/opportunities/low_hold", raw.lowHoldSampleKeys, raw.lowHold);
    printEndpointAuditTable("/opportunities/arbitrage", raw.arbitrageSampleKeys, raw.arbitrage);
    printEndpointAuditTable("/splits", raw.splitsSampleKeys, raw.splits);

    if (raw.oddsSampleEventId !== null) {
      printEndpointAuditTable("/odds", raw.oddsSampleKeys, raw.oddsSampleRowCount);
      console.log(`  Sample event_id used: ${raw.oddsSampleEventId}`);
      console.log(`  Market types observed in sample: ${raw.oddsSampleMarketTypes.join(", ") || "(none)"}`);
    } else {
      console.log();
      console.log("ENDPOINT: /odds (skipped — no event_id available from /opportunities/ev sample)");
    }

    console.log();
    console.log("ENDPOINT: /splits/history");
    console.log("─".repeat(72));
    if (!raw.splitsHistoryAvailable) {
      console.log("  Not available on this SharpAPI tier (or returned 404 / error).");
      console.log("  → V1.1+: would enable point-in-time public-split tracking for");
      console.log("    movement detection. Not blocking for V1.");
    } else {
      console.log(`  rows=${raw.splitsHistoryRows}`);
      console.log(`  sample keys: ${raw.splitsHistorySampleKeys.join(", ")}`);
      console.log("  Persisted today? No. → V1.1 candidate for split-movement features.");
    }

    // ── First-inning data availability (DB read-only) ──
    await auditFirstInningAvailability(common.verbose);

    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // ── APPLY mode: interactive confirm + write via service ──
  const confirmed = await confirmApply(common.sport, common.date, providerSignals.length);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via linesService.refreshSharpSignals (will DELETE existing + INSERT fresh)…");
  const result = await linesService.refreshSharpSignals(common.sport, common.date);
  console.log(`  records_updated: ${result.records_updated}`);
  console.log(`  api_calls_made:  ${result.api_calls_made}`);
  if (result.details !== undefined) {
    console.log(`  details:         ${JSON.stringify(result.details)}`);
  }
  console.log();
  console.log("APPLY complete. Re-run the probe to verify coverage:");
  console.log("  npx tsx --env-file=.env.local scripts/probes/phase-4_1_9_B-data-reliability.ts");
}

function pct(num: number, den: number): string {
  if (den === 0) return "n/a";
  return `${((num / den) * 100).toFixed(1)}%`;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
