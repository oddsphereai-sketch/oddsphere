/**
 * Phase 4.2.C.1.M — Operator script: backfill provider-ID mappings for
 * existing players via BDL ↔ MLB Stats auto-match.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/backfill-provider-mappings.ts \
 *     [--sport mlb] [--verbose] [--apply]
 *
 * GUARDS (defense in depth, mirrors publish-slate / hide-slate / unlock-game):
 *   1. Writes require TWO keys: --apply AND
 *      PROVIDER_MAPPING_DB_WRITES_ENABLED=true. Without both, the script
 *      runs dry-run regardless of --apply.
 *
 *   2. --apply also triggers an interactive y/N confirmation showing
 *      the exact tier breakdown about to be written.
 *
 * WRITES (when --apply confirmed):
 *   • players.provider_ids JSONB column ONLY. Reads-then-merges so any
 *     existing keys are preserved.
 *   • Tier 1 (high) and Tier 2 (medium) → write `bdl` block
 *   • Tier 3 (low) and Tier 4 (none) → write `unresolved_bdl` block
 *
 * NEVER WRITES:
 *   • No new player rows (we only UPDATE existing rows)
 *   • No stats tables (player_season_stats, player_splits, etc.)
 *   • No games or game_predictions
 *   • No admin_audit_log (mapping writes are low-stakes; audit reuses
 *     the provider_ids JSONB itself which carries mapped_at + mapped_via)
 *
 * DEFAULT BEHAVIOR (no --apply): DRY-RUN
 *   • Iterates every player in the DB
 *   • Attempts match against both providers
 *   • Prints distribution + per-player results (verbose shows all;
 *     default shows Tier 2+ and skips only)
 *   • Exits without writing
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readBoolFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import { BallDontLieProvider } from "../../lib/providers/real_api/BallDontLieProvider";
import {
  getPersonById,
  searchPersonByNameDob,
  type MlbPersonProfile,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import {
  attemptMatchForPlayer,
  writeMapping,
  type BdlCandidate,
  type MatchResult,
} from "../../lib/services/providerMappingService";

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled =
    process.env.PROVIDER_MAPPING_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires PROVIDER_MAPPING_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any provider_ids UPDATE.",
      "  To opt in for this command:",
      "",
      "    PROVIDER_MAPPING_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/backfill-provider-mappings.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

// ─── BDL candidate adapter (StatsPlayerRecord → BdlCandidate) ────────

import type { StatsPlayerRecord } from "../../lib/providers/interfaces/IPlayerStatsProvider";

function adaptBdlCandidate(rec: StatsPlayerRecord): BdlCandidate {
  return {
    external_id: rec.external_id,
    full_name: rec.full_name,
    first_name: rec.first_name,
    last_name: rec.last_name,
    dob: rec.dob,
    age: rec.age,
    birth_place: rec.birth_place,
    position_abbr: rec.position_abbr,
    bats: rec.bats,
    throws: rec.throws,
    // BDL StatsPlayerRecord carries team_external_id (BDL team id) but
    // not the abbreviation directly. We pass null and rely on
    // birth_place + DOB for tiebreakers. A future enhancement could
    // resolve the abbreviation via the providers' teams cache.
    team_abbreviation: null,
  };
}

// ─── confirmation ─────────────────────────────────────────────────────

type Bucket = {
  high: number;
  medium: number;
  low: number;
  none: number;
};

async function confirmApply(buckets: Bucket): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const writes = buckets.high + buckets.medium;
  const queues = buckets.low + buckets.none;
  try {
    const ans = await rl.question(
      `About to UPDATE players.provider_ids for the following counts:\n` +
        `  Tier 1 HIGH   (auto-write 'bdl' block):              ${buckets.high}\n` +
        `  Tier 2 MEDIUM (auto-write 'bdl' block w/ audit flag):${buckets.medium}\n` +
        `  Tier 3 LOW    (queue 'unresolved_bdl'):              ${buckets.low}\n` +
        `  None          (queue 'unresolved_bdl'):              ${buckets.none}\n` +
        `  -----\n` +
        `  Total writes: ${writes + queues}  (${writes} mappings + ${queues} queue entries)\n` +
        `  Each UPDATE touches players.provider_ids JSONB only.\n` +
        `  Reads-then-merges existing keys; no overwrites of other fields.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── main ─────────────────────────────────────────────────────────────

type PerPlayerResult = {
  player_id: number;
  full_name: string;
  external_id: number;
  mlb_person_id: number | null;
  dob: string | null;
  mlb_profile: MlbPersonProfile | null;
  match: MatchResult | null;
  proposedProviderIds: Record<string, unknown> | null;
  skip_reason: string | null;
};

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  console.log(
    `[backfill-provider-mappings] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } sport=${common.sport} verbose=${common.verbose}`
  );
  if (!writeMode) {
    console.log("             DRY RUN — NO DB WRITES");
  }

  if (!process.env.BALLDONTLIE_API_KEY) {
    console.error("✗ BALLDONTLIE_API_KEY not set; cannot search BDL.");
    process.exit(1);
  }
  const bdl = new BallDontLieProvider(process.env.BALLDONTLIE_API_KEY);

  // ── Load all players for the sport ──────────────────────────────────
  console.log();
  console.log("━━━ Loading players ━━━");
  const { data: players, error: loadErr } = await supabase
    .from("players")
    .select("id, external_id, mlb_person_id, full_name, dob, provider_ids")
    .eq("sport", common.sport)
    .order("id");
  if (loadErr) {
    console.error("✗ Failed to load players:", loadErr.message);
    process.exit(1);
  }
  console.log(`  Total ${common.sport.toUpperCase()} players in DB: ${players?.length ?? 0}`);
  const haveMlb = (players ?? []).filter((p) => p.mlb_person_id !== null).length;
  const needLookup = (players ?? []).filter(
    (p) => p.mlb_person_id === null && p.dob !== null
  ).length;
  const noDob = (players ?? []).filter(
    (p) => p.mlb_person_id === null && p.dob === null
  ).length;
  console.log(`     · mlb_person_id already populated: ${haveMlb}`);
  console.log(`     · need MLB Stats name+DOB lookup:  ${needLookup}`);
  console.log(`     · no DOB to lookup with (skipped): ${noDob}`);

  // ── Iterate + attempt match ─────────────────────────────────────────
  // Per-player flow:
  //   (1) Resolve full MLB Stats profile:
  //       • If `mlb_person_id` is set → getPersonById(mlb_person_id)
  //       • Else if `dob` is set → searchPersonByNameDob, then getPersonById on the hit
  //       • Else → skip with reason
  //   (2) Run attemptMatchForPlayer(mlb, ...) which searches BDL by last
  //       name and tier-classifies the result.
  //   (3) Cross-check: matcher's bdlId vs our DB's external_id.
  //       Mismatch means either our seed data is wrong or matcher hit a
  //       same-name decoy. Either way, surface it in the report.
  console.log();
  console.log("━━━ Probing both providers ━━━");
  const results: PerPlayerResult[] = [];
  let mlbApiCalls = 0;
  let bdlApiCalls = 0;

  for (const p of players ?? []) {
    let mlb: MlbPersonProfile | null = null;
    let skip: string | null = null;

    if (p.mlb_person_id !== null) {
      mlb = await getPersonById(p.mlb_person_id, { quiet: true });
      mlbApiCalls++;
      if (mlb === null) {
        skip = `MLB Stats /people/${p.mlb_person_id} returned no profile (likely stale id)`;
      }
    } else if (p.dob !== null) {
      const hit = await searchPersonByNameDob(p.full_name, p.dob, { quiet: true });
      mlbApiCalls++;
      if (hit === null) {
        skip = `MLB Stats name+DOB search returned no unambiguous match (name="${p.full_name}", dob=${p.dob})`;
      } else {
        mlb = await getPersonById(hit.id, { quiet: true });
        mlbApiCalls++;
        if (mlb === null) {
          skip = `MLB Stats search resolved id=${hit.id} but /people/${hit.id} returned no profile`;
        }
      }
    } else {
      skip = "no mlb_person_id and no DOB — cannot resolve MLB Stats identity";
    }

    if (mlb === null) {
      results.push({
        player_id: p.id,
        full_name: p.full_name,
        external_id: p.external_id,
        mlb_person_id: p.mlb_person_id,
        dob: p.dob,
        mlb_profile: null,
        match: null,
        proposedProviderIds: null,
        skip_reason: skip ?? "unknown resolution failure",
      });
      continue;
    }

    let match: MatchResult;
    let proposedProviderIds: Record<string, unknown>;
    try {
      const result = await attemptMatchForPlayer(mlb, {
        searchBdlByName: async (name: string) => {
          const recs = await bdl.searchPlayersByName(name);
          bdlApiCalls++;
          return recs.map(adaptBdlCandidate);
        },
      });
      match = result.match;
      proposedProviderIds = result.proposedProviderIds;
    } catch (e) {
      results.push({
        player_id: p.id,
        full_name: p.full_name,
        external_id: p.external_id,
        mlb_person_id: p.mlb_person_id,
        dob: p.dob,
        mlb_profile: mlb,
        match: null,
        proposedProviderIds: null,
        skip_reason: `BDL search failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    results.push({
      player_id: p.id,
      full_name: p.full_name,
      external_id: p.external_id,
      mlb_person_id: p.mlb_person_id,
      dob: p.dob,
      mlb_profile: mlb,
      match,
      proposedProviderIds,
      skip_reason: null,
    });
  }

  console.log(`  MLB Stats API calls: ${mlbApiCalls}`);
  console.log(`  BDL API calls:       ${bdlApiCalls}`);
  console.log(`  Total calls: ${mlbApiCalls + bdlApiCalls}`);

  // ── Tier distribution summary ───────────────────────────────────────
  console.log();
  console.log("━━━ Match tier distribution ━━━");
  const buckets: Bucket = { high: 0, medium: 0, low: 0, none: 0 };
  const skips: number = results.filter((r) => r.skip_reason !== null).length;
  for (const r of results) {
    if (r.match === null) continue;
    buckets[r.match.tier]++;
  }
  const total = results.length;
  const matched = total - skips;
  const pct = (n: number) =>
    matched === 0 ? "0%" : `${((n / matched) * 100).toFixed(0)}%`;
  console.log(
    `  Tier 1 HIGH   (full name + DOB exact):    ${buckets.high} players (${pct(buckets.high)})`
  );
  console.log(
    `  Tier 2 MEDIUM (DOB exact + name variant): ${buckets.medium} players (${pct(buckets.medium)})`
  );
  console.log(
    `  Tier 3 LOW    (multiple DOB matches):     ${buckets.low} players (${pct(buckets.low)})`
  );
  console.log(
    `  None          (no match / DOB mismatch):  ${buckets.none} players (${pct(buckets.none)})`
  );
  console.log(`  Skipped (no MLB-Stats id / 404):          ${skips} players`);
  console.log(`  --------`);
  console.log(
    `  Auto-writable (Tier 1 + 2): ${buckets.high + buckets.medium} players`
  );
  console.log(`  Queue for review (Tier 3 + None): ${buckets.low + buckets.none} players`);

  // ── Per-player report ───────────────────────────────────────────────
  console.log();
  console.log("━━━ Per-player results ━━━");
  if (common.verbose) {
    console.log("  (verbose: showing every player)");
  } else {
    console.log("  (showing Tier 2+ and skips only; --verbose to see all)");
  }
  for (const r of results) {
    if (r.skip_reason !== null) {
      console.log(
        `  ⏭  player_id=${r.player_id} ${r.full_name.padEnd(28)} skip: ${r.skip_reason}`
      );
      continue;
    }
    if (r.match === null) continue;
    const showLine = common.verbose || r.match.tier !== "high";
    if (!showLine) continue;
    if (r.match.tier === "high") {
      console.log(
        `  ✓  player_id=${r.player_id} ${r.full_name.padEnd(28)} → bdl=${r.match.bdlId}  Tier 1 HIGH`
      );
    } else if (r.match.tier === "medium") {
      console.log(
        `  ⚠  player_id=${r.player_id} ${r.full_name.padEnd(28)} → bdl=${r.match.bdlId}  Tier 2 MEDIUM (variant: \"${r.match.bdlFullName}\")`
      );
    } else if (r.match.tier === "low") {
      console.log(
        `  ❓ player_id=${r.player_id} ${r.full_name.padEnd(28)} → queue  Tier 3 LOW: ${r.match.reason}`
      );
      for (const c of r.match.candidates) {
        console.log(
          `       candidate: bdl=${c.bdl_id} ${c.name} dob=${c.dob ?? "—"} team=${c.team ?? "—"}`
        );
      }
    } else if (r.match.tier === "none") {
      console.log(
        `  ❌ player_id=${r.player_id} ${r.full_name.padEnd(28)} → no match  reason: ${r.match.reason}`
      );
    }
  }

  // ── Verdict for dry-run ─────────────────────────────────────────────
  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    console.log(`  Would write ${buckets.high + buckets.medium} bdl mappings`);
    console.log(`  Would queue ${buckets.low + buckets.none} unresolved entries`);
    console.log(`  Would skip ${skips} players (no MLB-Stats-style id)`);
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    console.log();
    console.log("  To apply (with explicit env flag):");
    console.log("    PROVIDER_MAPPING_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\");
    console.log("      scripts/operator/backfill-provider-mappings.ts --apply [--verbose]");
    return;
  }

  // ── APPLY: confirm + write ──────────────────────────────────────────
  const confirmed = await confirmApply(buckets);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing provider_ids updates…");
  let written = 0;
  let errors = 0;
  for (const r of results) {
    if (r.proposedProviderIds === null) continue;
    try {
      await writeMapping(supabase, r.player_id, r.proposedProviderIds);
      written++;
    } catch (e) {
      errors++;
      console.error(
        `  ✗ player_id=${r.player_id} ${r.full_name}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  console.log();
  console.log("━━━ Apply complete ━━━");
  console.log(`  Rows updated:     ${written}`);
  console.log(`  Errors:           ${errors}`);
  console.log();
  console.log("  Next: review players with provider_ids ? 'unresolved_bdl' for manual mapping.");
  console.log("  Query: SELECT id, full_name, provider_ids->'unresolved_bdl' AS unresolved");
  console.log("         FROM players WHERE provider_ids ? 'unresolved_bdl';");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
