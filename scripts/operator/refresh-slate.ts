/**
 * Phase 4.1.9.C-1b — Operator script: refresh slate (games table only) for
 * one sport/date.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/refresh-slate.ts \
 *     [--sport mlb] [--date YYYY-MM-DD] [--verbose] \
 *     [--provider real_api] \
 *     [--apply]
 *
 * GUARDS (defense in depth, mirrors refresh-sharp-signals.ts):
 *   1. Provider mode must be EXPLICITLY real_api. Either:
 *        • SLATE_PROVIDER=real_api in the environment, OR
 *        • --provider real_api on the command line.
 *      Anything else (mock, manual, unset) → script refuses to call the
 *      real slate provider and explains what's needed.
 *
 *   2. Writes require TWO keys: --apply AND SLATE_DB_WRITES_ENABLED=true.
 *      Without both, the script runs dry-run regardless of --apply.
 *
 *   3. --apply also triggers an interactive y/N confirmation showing the
 *      exact sport/date and game count about to be written.
 *
 * WRITES (when --apply confirmed):
 *   • Only `games` (UPSERT on (sport, external_id)).
 *   • No game_predictions, no lines, no sharp_signals, no slate_status
 *     mutation (new rows default to 'draft' per schema-v8 — invisible to
 *     members until publishSlate runs).
 *   • No predictions generated. No grades derived. No publish.
 *
 * DEFAULT BEHAVIOR (no --apply): DRY-RUN
 *   • Calls slate provider, builds payload, reports per-game what would
 *     be upserted, prints DRY RUN — NO DB WRITES banner.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readStringFlag,
  readBoolFlag,
} from "./_cliCommon";
import { slateService } from "../../lib/services/slateService";
import { supabase } from "../../lib/db/supabase";
import { getSlateProvider } from "../../lib/providers/factory";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import type {
  ISlateProvider,
  SlateGameRecord,
  SlateTeamRecord,
} from "../../lib/providers/interfaces/ISlateProvider";
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
  const envRaw = process.env.SLATE_PROVIDER;
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
      reason: `Invalid SLATE_PROVIDER="${envRaw}". Expected one of: mock, manual, real_api.`,
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
      "✗ This script intentionally refuses to call the real slate provider",
      "  unless the provider is EXPLICITLY set to real_api.",
      "",
      `  Currently: ${
        source === "neither"
          ? "no provider mode set (would default to mock via factory)"
          : `provider=${mode} (source: ${source})`
      }.`,
      "",
      "  To run this script against the live slate provider:",
      "    SLATE_PROVIDER=real_api npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-slate.ts [...flags]",
      "",
      "  OR pass --provider real_api on the command line:",
      "    npx tsx --env-file=.env.local scripts/operator/refresh-slate.ts \\",
      "      --provider real_api [...flags]",
      "",
      "  Reason: avoid accidentally burning provider quota or writing",
      "  unintended games rows. Phase 4.1.9.C-1b guard.",
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
  const envEnabled = process.env.SLATE_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires SLATE_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any games UPSERT.",
      "  To opt in for this command:",
      "",
      "    SLATE_DB_WRITES_ENABLED=true SLATE_PROVIDER=real_api \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-slate.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

// ─── SharpAPI cross-provider validation ───────────────────────────────

/**
 * Minimum overlap fraction between BDL's ET-filtered slate and
 * SharpAPI's /splits slate. Below this, the operator apply path BLOCKS.
 * Per 4.1.9.C-1c.v decision: wrong games are worse than missing games.
 */
const SHARP_API_OVERLAP_THRESHOLD = 0.9;

/**
 * Canonical → DB abbreviation aliases. Matches the alias map in
 * refresh-teams.ts. The normalizer returns canonical MlbTeamAbbrev
 * (e.g. OAK for Athletics), but our DB stores the post-rebrand "ATH"
 * for the Athletics. Keep this in sync if more aliases ever land.
 */
const CANONICAL_TO_DB_ABBREV: Record<string, string> = {
  OAK: "ATH",
};

type ValidationResult = {
  bdlCount: number;
  sharpApiCount: number;
  bdlPairs: Set<string>;
  sharpApiPairs: Set<string>;
  overlap: number;
  overlapPct: number;
  bdlOnly: string[];
  sharpApiOnly: string[];
  passed: boolean;
  reason: string | null;
};

/**
 * Frozen-data slate provider — returns a fixed game list without hitting
 * any network. Used so the operator script can fetch BDL once for both
 * validation AND slate upsert, instead of issuing duplicate calls.
 */
class FrozenSlateProvider implements ISlateProvider {
  constructor(private readonly games: SlateGameRecord[]) {}
  async getTeams(_sport: Sport): Promise<SlateTeamRecord[]> {
    void _sport;
    return [];
  }
  async getGames(_date: string, _sport?: Sport): Promise<SlateGameRecord[]> {
    void _date;
    void _sport;
    return this.games;
  }
}

/**
 * Convert BDL slate games (external_id-keyed) into a Set of
 * "AWAY@HOME" abbreviation pairs using the DB's teams table.
 */
async function bdlGamesToPairs(games: SlateGameRecord[]): Promise<Set<string>> {
  const externalIds = Array.from(
    new Set(
      games
        .flatMap((g) => [g.home_team_external_id, g.away_team_external_id])
        .filter((x): x is number => x !== null)
    )
  );
  if (externalIds.length === 0) return new Set();

  const { data: teams, error } = await supabase
    .from("teams")
    .select("external_id, abbreviation")
    .eq("sport", "mlb")
    .in("external_id", externalIds);
  if (error) {
    throw new Error(`bdlGamesToPairs: teams query failed: ${error.message}`);
  }
  const abbrByExt = new Map<number, string>();
  for (const t of teams ?? []) abbrByExt.set(t.external_id, t.abbreviation);

  const pairs = new Set<string>();
  for (const g of games) {
    const away = g.away_team_external_id !== null ? abbrByExt.get(g.away_team_external_id) : null;
    const home = g.home_team_external_id !== null ? abbrByExt.get(g.home_team_external_id) : null;
    if (away && home) pairs.add(`${away}@${home}`);
  }
  return pairs;
}

/**
 * Fetch SharpAPI /splits for the slate and convert to a Set of
 * "AWAY@HOME" abbreviation pairs. Uses the team-name normalizer and
 * the same canonical → DB alias map as refresh-teams.ts.
 *
 * Returns an empty set + error if SHARPAPI_KEY is missing OR if the
 * endpoint fails. Caller decides how to handle (warn-skip in dry-run,
 * block in apply).
 */
async function fetchSharpApiSlatePairs(): Promise<{ pairs: Set<string>; rawCount: number; error: string | null }> {
  const key = process.env.SHARPAPI_KEY;
  if (!key) return { pairs: new Set(), rawCount: 0, error: "SHARPAPI_KEY missing" };

  let response: Response;
  try {
    response = await fetch("https://api.sharpapi.io/api/v1/splits?sport=mlb&per_page=100", {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    return { pairs: new Set(), rawCount: 0, error: `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!response.ok) {
    return { pairs: new Set(), rawCount: 0, error: `HTTP ${response.status}` };
  }
  let body: { data?: Array<{ home_team?: string; away_team?: string; league?: string }> };
  try {
    body = await response.json();
  } catch (e) {
    return { pairs: new Set(), rawCount: 0, error: `parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const rows = body.data ?? [];

  const pairs = new Set<string>();
  for (const r of rows) {
    const leagueTag = (r.league ?? "").toLowerCase();
    if (leagueTag !== "" && leagueTag !== "mlb") continue;
    const canonicalHome = normalizeMlbTeamName(r.home_team ?? null);
    const canonicalAway = normalizeMlbTeamName(r.away_team ?? null);
    if (canonicalHome === null || canonicalAway === null) continue;
    const dbHome = CANONICAL_TO_DB_ABBREV[canonicalHome] ?? canonicalHome;
    const dbAway = CANONICAL_TO_DB_ABBREV[canonicalAway] ?? canonicalAway;
    pairs.add(`${dbAway}@${dbHome}`);
  }
  return { pairs, rawCount: rows.length, error: null };
}

/**
 * Pure overlap math. Compares BDL's set to SharpAPI's set and reports
 * the symmetric differences plus the overlap fraction.
 */
function validateOverlap(
  bdlPairs: Set<string>,
  sharpApiPairs: Set<string>
): Omit<ValidationResult, "bdlCount" | "sharpApiCount" | "bdlPairs" | "sharpApiPairs"> {
  const overlap = [...bdlPairs].filter((p) => sharpApiPairs.has(p)).length;
  const denom = Math.max(bdlPairs.size, sharpApiPairs.size);
  const overlapPct = denom === 0 ? 1.0 : overlap / denom;
  const bdlOnly = [...bdlPairs].filter((p) => !sharpApiPairs.has(p)).sort();
  const sharpApiOnly = [...sharpApiPairs].filter((p) => !bdlPairs.has(p)).sort();
  const passed = overlapPct >= SHARP_API_OVERLAP_THRESHOLD;
  return {
    overlap,
    overlapPct,
    bdlOnly,
    sharpApiOnly,
    passed,
    reason: passed
      ? null
      : `overlap ${(overlapPct * 100).toFixed(1)}% < threshold ${(SHARP_API_OVERLAP_THRESHOLD * 100).toFixed(0)}%`,
  };
}

async function runValidation(
  bdlGames: SlateGameRecord[]
): Promise<ValidationResult & { sharpApiFetchError: string | null }> {
  const bdlPairs = await bdlGamesToPairs(bdlGames);
  const { pairs: sharpApiPairs, error: sharpApiFetchError } = await fetchSharpApiSlatePairs();
  const overlapInfo = validateOverlap(bdlPairs, sharpApiPairs);
  return {
    bdlCount: bdlPairs.size,
    sharpApiCount: sharpApiPairs.size,
    bdlPairs,
    sharpApiPairs,
    ...overlapInfo,
    sharpApiFetchError,
  };
}

function printValidationReport(
  v: ValidationResult & { sharpApiFetchError: string | null }
): void {
  console.log();
  console.log("━━━ SharpAPI cross-provider validation ━━━");
  if (v.sharpApiFetchError !== null) {
    console.log(`  ⚠ SharpAPI fetch could not run: ${v.sharpApiFetchError}`);
    console.log("    Validation is INCONCLUSIVE.");
    return;
  }
  console.log(`  BDL ET-filtered game count:  ${v.bdlCount}`);
  console.log(`  SharpAPI /splits game count: ${v.sharpApiCount}`);
  console.log(`  Overlap (pairs in both):     ${v.overlap}`);
  console.log(`  Overlap percentage:          ${(v.overlapPct * 100).toFixed(1)}%`);
  console.log(`  Threshold:                   ${(SHARP_API_OVERLAP_THRESHOLD * 100).toFixed(0)}%`);
  if (v.bdlOnly.length > 0) {
    console.log(`  BDL-only pairs (${v.bdlOnly.length}):`);
    for (const p of v.bdlOnly) console.log(`    ${p}`);
  } else {
    console.log(`  BDL-only pairs: none`);
  }
  if (v.sharpApiOnly.length > 0) {
    console.log(`  SharpAPI-only pairs (${v.sharpApiOnly.length}):`);
    for (const p of v.sharpApiOnly) console.log(`    ${p}`);
  } else {
    console.log(`  SharpAPI-only pairs: none`);
  }
  console.log(`  Verdict: ${v.passed ? "🟢 GREEN" : "🔴 RED — block apply"}`);
}

async function confirmApply(sport: Sport, date: string, gamesToUpsert: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UPSERT into games for sport=${sport} date=${date}.\n` +
        `  Games to upsert: ${gamesToUpsert}\n` +
        `  Existing rows on (sport, external_id) will be OVERWRITTEN.\n` +
        `  No predictions, no publish — just the games table.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
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
    process.env.SLATE_PROVIDER = providerResolution.mode;
  }
  refuseUnlessRealApi(providerResolution.mode, providerResolution.source);

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[refresh-slate] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } provider=real_api(source:${
      providerResolution.source === "neither" ? "?" : providerResolution.source
    }) sport=${common.sport} date=${common.date} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("           DRY RUN — NO DB WRITES");
  }

  // Pre-state snapshot — count existing games for this (sport, slate_date)
  const { count: preCount, error: preErr } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("sport", common.sport)
    .eq("slate_date", common.date);
  if (preErr) {
    console.error("Pre-state query failed:", preErr.message);
    process.exit(1);
  }

  console.log();
  console.log("━━━ Pre-state ━━━");
  console.log(`  Existing games rows in DB for ${common.sport}/${common.date}: ${preCount ?? 0}`);

  // Fetch BDL slate ONCE — used for both validation and the slateService
  // upsert path (via FrozenSlateProvider override). Avoids duplicate
  // BDL calls when the dry-run is also going to apply later.
  console.log();
  console.log("━━━ Provider fetch + payload build ━━━");
  const liveProvider = getSlateProvider();
  const fetchedGames = await liveProvider.getGames(common.date, common.sport);

  const dryResult = await slateService.refreshGames(
    common.sport,
    common.date,
    new FrozenSlateProvider(fetchedGames),
    { dryRun: true }
  );
  console.log(`  Games that would be upserted:  ${dryResult.records_updated}`);
  console.log(`  Provider API calls made:       ${dryResult.api_calls_made}`);
  if (dryResult.details !== undefined) {
    const det = dryResult.details as { skipped_external_ids?: number[] };
    if (det.skipped_external_ids && det.skipped_external_ids.length > 0) {
      console.log(`  Skipped (team FK missing):     ${det.skipped_external_ids.length}`);
      if (common.verbose) {
        console.log(`    external_ids: ${det.skipped_external_ids.join(", ")}`);
      }
    } else {
      console.log(`  Skipped (team FK missing):     0`);
    }
  } else {
    console.log(`  Skipped (team FK missing):     0`);
  }

  console.log();
  console.log("━━━ Tables that would be written ━━━");
  console.log(`  games (UPSERT on (sport, external_id)): ${dryResult.records_updated} rows`);
  console.log("  No other tables. No predictions, no publish, no sharp_signals.");

  // SharpAPI cross-provider validation runs in BOTH dry-run and apply.
  // In dry-run it informs; in apply it BLOCKS if overlap < threshold.
  const validation = await runValidation(fetchedGames);
  printValidationReport(validation);

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    if (dryResult.records_updated === 0) {
      console.log("  🟡 Provider returned 0 games. Possibilities:");
      console.log("     - Provider has no games for this date (off-day, late evening, etc.)");
      console.log("     - Provider failed silently (check verbose logs)");
      console.log("     - Wrong date");
    } else if (validation.sharpApiFetchError !== null) {
      console.log(`  🟡 Provider returned ${dryResult.records_updated} games but SharpAPI validation could not run.`);
      console.log(`     Reason: ${validation.sharpApiFetchError}`);
      console.log("     Dry-run is permissive on this. Apply mode will block.");
    } else if (validation.passed) {
      console.log(`  🟢 Provider returned ${dryResult.records_updated} games for ${common.sport}/${common.date}.`);
      console.log(`     SharpAPI validation: ${(validation.overlapPct * 100).toFixed(1)}% overlap (>= 90% threshold).`);
      console.log("     Safe to --apply (operator confirmation required).");
    } else {
      console.log(`  🔴 Provider returned ${dryResult.records_updated} games BUT SharpAPI validation FAILED.`);
      console.log(`     ${validation.reason}`);
      console.log("     Apply mode would BLOCK this slate.");
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: enforce validation gate before any write.
  if (validation.sharpApiFetchError !== null) {
    console.error();
    console.error("✗ APPLY BLOCKED — SharpAPI validation could not run.");
    console.error(`  ${validation.sharpApiFetchError}`);
    console.error("  Wrong games are worse than missing games. Re-run after the validation");
    console.error("  layer can reach SharpAPI.");
    process.exit(1);
  }
  if (!validation.passed) {
    console.error();
    console.error("✗ APPLY BLOCKED — SharpAPI cross-provider overlap below threshold.");
    console.error(`  ${validation.reason}`);
    console.error("  BDL-only pairs:    " + (validation.bdlOnly.join(", ") || "(none)"));
    console.error("  SharpAPI-only pairs: " + (validation.sharpApiOnly.join(", ") || "(none)"));
    console.error("  No games will be upserted. Investigate the BDL slate or SharpAPI catalog");
    console.error("  before retrying. (Cannot override — this is the V1 safety guard.)");
    process.exit(1);
  }

  // APPLY: confirm + write.
  const confirmed = await confirmApply(common.sport, common.date, dryResult.records_updated ?? 0);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing via slateService.refreshGames (will UPSERT into games)…");
  const result = await slateService.refreshGames(
    common.sport,
    common.date,
    new FrozenSlateProvider(fetchedGames)
  );
  console.log(`  records_updated: ${result.records_updated}`);
  console.log(`  api_calls_made:  ${result.api_calls_made}`);
  if (result.details !== undefined) {
    console.log(`  details:         ${JSON.stringify(result.details)}`);
  }

  // Post-state snapshot
  const { count: postCount } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("sport", common.sport)
    .eq("slate_date", common.date);

  console.log();
  console.log("━━━ Post-state ━━━");
  console.log(`  Games rows now in DB for ${common.sport}/${common.date}: ${postCount ?? 0}`);
  console.log(`  (was ${preCount ?? 0} before)`);

  console.log();
  console.log("APPLY complete. Next step:");
  console.log("  Re-run refresh-sharp-signals.ts dry-run — it should now");
  console.log("  successfully map SharpAPI rows to these new game IDs.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
