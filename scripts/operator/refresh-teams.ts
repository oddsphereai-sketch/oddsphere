/**
 * Phase 4.1.9.C-1c.i — Operator script: align teams.external_id with BDL's
 * current team IDs by matching on abbreviation.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/refresh-teams.ts \
 *     [--sport mlb] [--verbose] \
 *     [--provider real_api] \
 *     [--apply]
 *
 * WHY THIS EXISTS:
 *   Our teams.external_id values were seeded from a non-BDL source (likely
 *   MLB Stats API division order). 28 of 30 MLB teams have external_ids
 *   that disagree with BDL's current /teams response. slateService.refreshGames
 *   reads BDL's home_team.id and looks it up via teams.external_id — when
 *   the maps disagree, we write the WRONG team_id on the games row. This
 *   script corrects teams.external_id to match BDL, keyed by abbreviation.
 *
 * MAPPING STRATEGY:
 *   For each BDL team:
 *     - Normalize the BDL abbreviation via normalizeMlbTeamName (handles
 *       CHW → CWS already)
 *     - Apply the small DB-specific alias map below for OAK → ATH (the
 *       Athletics' rebrand; normalizer uses canonical OAK but DB stores ATH)
 *     - Find our DB team by that final abbreviation
 *     - If our team's external_id differs from BDL's id, plan an UPDATE
 *
 * GUARDS (defense in depth):
 *   1. Provider mode must be EXPLICITLY real_api (env or --provider flag).
 *      Refuses to call BDL otherwise.
 *   2. Writes require TWO keys: --apply AND TEAMS_DB_WRITES_ENABLED=true.
 *   3. --apply triggers an interactive y/N confirmation showing the diff.
 *
 * WRITES (when confirmed):
 *   • Only `teams.external_id` columns for rows whose abbreviation matches
 *     a BDL team. One UPDATE statement per changed team — no inserts, no
 *     deletes, no other column touched.
 *   • No DDL. No predictions, no games, no lines, no sharp_signals.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  parseCommonCliOptions,
  readStringFlag,
  readBoolFlag,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";

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
  // PLAYER_STATS_PROVIDER controls the BDL provider in the factory; we
  // reuse the same env var so the operator's intent is consistent with
  // production env conventions. (BDL backs PlayerStats AND slate.)
  const envRaw = process.env.PLAYER_STATS_PROVIDER;
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
      reason: `Invalid PLAYER_STATS_PROVIDER="${envRaw}". Expected one of: mock, manual, real_api.`,
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
      "✗ This script intentionally refuses to call BDL unless the player-stats",
      "  provider is EXPLICITLY set to real_api.",
      "",
      `  Currently: ${
        source === "neither"
          ? "no provider mode set (would default to mock via factory)"
          : `provider=${mode} (source: ${source})`
      }.`,
      "",
      "  To run this script against the live BDL API:",
      "    PLAYER_STATS_PROVIDER=real_api npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-teams.ts [...flags]",
      "",
      "  OR pass --provider real_api on the command line:",
      "    npx tsx --env-file=.env.local scripts/operator/refresh-teams.ts \\",
      "      --provider real_api [...flags]",
      "",
      "  Reason: avoid accidentally hitting the BDL API from local invocations.",
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
  const envEnabled = process.env.TEAMS_DB_WRITES_ENABLED === "true";
  return { applyRequested, envEnabled, canApply: applyRequested && envEnabled };
}

function refuseApplyMisconfig(applyRequested: boolean, envEnabled: boolean): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires TEAMS_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any teams UPDATE.",
      "  To opt in for this command:",
      "",
      "    TEAMS_DB_WRITES_ENABLED=true PLAYER_STATS_PROVIDER=real_api \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-teams.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(updateCount: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UPDATE teams.external_id for ${updateCount} MLB teams.\n` +
        `  Other columns untouched. No INSERT, no DELETE.\n` +
        `  Reversible: yes — re-running this script idempotently re-aligns.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── BDL-to-DB abbreviation alias ─────────────────────────────────────

/**
 * Bridge from the normalizer's canonical abbreviation to what our DB
 * stores in teams.abbreviation. Most abbreviations align after the
 * normalizer pass (e.g., CHW → CWS); only the Athletics differ because
 * our DB tracks the post-rebrand "ATH" while the rest of the codebase
 * (including the MlbTeamAbbrev type) uses the legacy "OAK".
 *
 * Add to this map only when there's a known canonical-vs-DB mismatch.
 */
const CANONICAL_TO_DB_ABBREV: Record<string, string> = {
  OAK: "ATH",
};

function bdlTeamToDbAbbreviation(bdlAbbrev: string, bdlName: string): string | null {
  // Try normalizing the abbreviation first, then fall back to the name.
  // Normalizer returns the canonical (MlbTeamAbbrev) form.
  const canonical = normalizeMlbTeamName(bdlAbbrev) ?? normalizeMlbTeamName(bdlName);
  if (canonical === null) return null;
  return CANONICAL_TO_DB_ABBREV[canonical] ?? canonical;
}

// ─── main ─────────────────────────────────────────────────────────────

type BdlTeam = {
  id: number;
  abbreviation: string;
  name: string;
  display_name?: string;
  location?: string;
};

type Diff = {
  bdlId: number;
  bdlAbbrev: string;
  bdlName: string;
  dbAbbrev: string;
  dbId: number;
  dbExternalIdBefore: number | null;
  dbExternalIdAfter: number;
  changed: boolean;
};

async function fetchBdlTeams(apiKey: string): Promise<BdlTeam[]> {
  const url = "https://api.balldontlie.io/mlb/v1/teams?per_page=100";
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    throw new Error(`BDL /teams HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`);
  }
  const body = (await res.json()) as { data?: BdlTeam[] };
  return body.data ?? [];
}

async function main() {
  const argv = process.argv;
  const common = parseCommonCliOptions(argv);
  if (common.sport !== "mlb") {
    console.error("✗ Only --sport mlb is supported by this script today.");
    process.exit(1);
  }

  const providerResolution = resolveExplicitProviderMode(argv);
  if (!providerResolution.ok) {
    console.error(`✗ ${providerResolution.reason}`);
    process.exit(1);
  }
  if (providerResolution.source === "flag" && providerResolution.mode !== null) {
    process.env.PLAYER_STATS_PROVIDER = providerResolution.mode;
  }
  refuseUnlessRealApi(providerResolution.mode, providerResolution.source);

  const applyGate = resolveApplyGate(argv);
  refuseApplyMisconfig(applyGate.applyRequested, applyGate.envEnabled);
  const writeMode = applyGate.canApply;

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.error("✗ BALLDONTLIE_API_KEY missing from environment.");
    process.exit(1);
  }

  console.log(
    `[refresh-teams] mode=${
      writeMode ? "APPLY" : "DRY-RUN"
    } provider=real_api(source:${
      providerResolution.source === "neither" ? "?" : providerResolution.source
    }) sport=${common.sport} verbose=${common.verbose}`
  );
  if (!writeMode) console.log("           DRY RUN — NO DB WRITES");

  // 1. Fetch BDL teams
  console.log();
  console.log("━━━ BDL /teams ━━━");
  const bdlTeams = await fetchBdlTeams(apiKey);
  console.log(`  Rows returned: ${bdlTeams.length}`);
  if (bdlTeams.length === 0) {
    console.error("✗ BDL /teams returned 0 rows. Cannot proceed.");
    process.exit(1);
  }

  // 2. Load our DB teams (sport=mlb)
  const { data: dbTeams, error } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation, name")
    .eq("sport", "mlb")
    .order("abbreviation");
  if (error) {
    console.error(`✗ DB teams query failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`  DB MLB teams: ${dbTeams?.length ?? 0}`);

  const dbByAbbrev = new Map<string, { id: number; external_id: number | null; abbreviation: string; name: string }>();
  for (const t of dbTeams ?? []) dbByAbbrev.set(t.abbreviation, t);

  // 3. Compute diffs
  const diffs: Diff[] = [];
  const unmatchedBdl: BdlTeam[] = [];
  for (const b of bdlTeams) {
    const dbAbbrev = bdlTeamToDbAbbreviation(b.abbreviation, b.name);
    if (dbAbbrev === null) {
      unmatchedBdl.push(b);
      continue;
    }
    const ourTeam = dbByAbbrev.get(dbAbbrev);
    if (!ourTeam) {
      unmatchedBdl.push(b);
      continue;
    }
    diffs.push({
      bdlId: b.id,
      bdlAbbrev: b.abbreviation,
      bdlName: b.name,
      dbAbbrev,
      dbId: ourTeam.id,
      dbExternalIdBefore: ourTeam.external_id,
      dbExternalIdAfter: b.id,
      changed: ourTeam.external_id !== b.id,
    });
  }

  // 4. Report
  console.log();
  console.log("━━━ Diff plan ━━━");
  console.log(
    "BDL abbr (→ DB abbr) | BDL name                | BDL id | DB id   | external_id: before → after | Δ"
  );
  console.log("─".repeat(105));
  for (const d of diffs.sort((a, b) => a.dbAbbrev.localeCompare(b.dbAbbrev))) {
    const transition = `${String(d.dbExternalIdBefore ?? "null").padEnd(4)} → ${String(d.dbExternalIdAfter).padEnd(4)}`;
    const mark = d.changed ? "✗ change" : "✓ same";
    console.log(
      `${(d.bdlAbbrev + (d.bdlAbbrev !== d.dbAbbrev ? ` (→ ${d.dbAbbrev})` : "")).padEnd(20)} | ${d.bdlName.padEnd(23)} | ${String(d.bdlId).padEnd(6)} | ${String(d.dbId).padEnd(7)} | ${transition.padEnd(28)} | ${mark}`
    );
  }

  console.log();
  if (unmatchedBdl.length > 0) {
    console.log("━━━ BDL teams unmatched to a DB row ━━━");
    for (const u of unmatchedBdl) {
      console.log(`  BDL ${u.abbreviation} (${u.name}) — no DB team for normalized abbreviation`);
    }
    console.log();
  }

  // DB teams that don't appear in BDL response (would be left unchanged)
  const bdlDbAbbrevs = new Set(
    bdlTeams.map((b) => bdlTeamToDbAbbreviation(b.abbreviation, b.name)).filter((x): x is string => x !== null)
  );
  const dbUnmatched = (dbTeams ?? []).filter((d) => !bdlDbAbbrevs.has(d.abbreviation));
  if (dbUnmatched.length > 0) {
    console.log("━━━ DB teams NOT in BDL response (would be left unchanged) ━━━");
    for (const d of dbUnmatched) {
      console.log(`  DB ${d.abbreviation} (${d.name}) external_id=${d.external_id ?? "null"}`);
    }
    console.log();
  }

  const toChange = diffs.filter((d) => d.changed);
  const toLeave = diffs.filter((d) => !d.changed);

  console.log("━━━ Summary ━━━");
  console.log(`  BDL teams returned:       ${bdlTeams.length}`);
  console.log(`  DB MLB teams:             ${dbTeams?.length ?? 0}`);
  console.log(`  Matched by abbreviation:  ${diffs.length}`);
  console.log(`  Would UPDATE:             ${toChange.length}`);
  console.log(`  Already aligned:          ${toLeave.length}`);
  console.log(`  BDL unmatched:            ${unmatchedBdl.length}`);
  console.log(`  DB unmatched:             ${dbUnmatched.length}`);

  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    if (toChange.length === 0) {
      console.log("  🟢 No changes needed. teams.external_id is already aligned with BDL.");
    } else if (toChange.length === diffs.length) {
      console.log(`  🟡 ${toChange.length} of ${diffs.length} teams need realignment.`);
      console.log("     This is consistent with the diagnostic finding — full re-sync expected.");
    } else {
      console.log(`  🟡 ${toChange.length} teams would change, ${toLeave.length} already aligned.`);
    }
    if (unmatchedBdl.length > 0 || dbUnmatched.length > 0) {
      console.log("  ⚠ Some teams could not be matched — review the unmatched sections above.");
    }
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    return;
  }

  // APPLY: confirm + execute
  if (toChange.length === 0) {
    console.log();
    console.log("Nothing to do — teams.external_id is already aligned. Exiting.");
    return;
  }

  const confirmed = await confirmApply(toChange.length);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  // Two-phase write to avoid temporary unique-constraint violations:
  // Phase 1 — set every changing row to a sentinel negative value derived
  //           from its own id (guaranteed unique, well outside the BDL
  //           positive id range).
  // Phase 2 — set each row to its final BDL id.
  // This sidesteps the chance that two rows would briefly hold the same
  // external_id during a swap (e.g., A→B and B→A in sequence).
  console.log();
  console.log("Phase 1 — staging to sentinel external_ids…");
  for (const d of toChange) {
    const sentinel = -d.dbId; // guaranteed unique per-row
    const { error: e1 } = await supabase
      .from("teams")
      .update({ external_id: sentinel })
      .eq("id", d.dbId);
    if (e1) {
      console.error(`✗ Phase-1 update failed for DB id=${d.dbId}: ${e1.message}`);
      console.error("  Stopping. Some rows may have already been moved to sentinel.");
      console.error("  Re-run this script in dry-run to inspect state, then --apply again.");
      process.exit(1);
    }
  }
  console.log(`  Phase 1 complete: ${toChange.length} rows staged.`);

  console.log("Phase 2 — applying canonical BDL external_ids…");
  for (const d of toChange) {
    const { error: e2 } = await supabase
      .from("teams")
      .update({ external_id: d.dbExternalIdAfter })
      .eq("id", d.dbId);
    if (e2) {
      console.error(`✗ Phase-2 update failed for DB id=${d.dbId}: ${e2.message}`);
      console.error("  Stopping. Run this script in dry-run to inspect state, then --apply again.");
      process.exit(1);
    }
  }
  console.log(`  Phase 2 complete: ${toChange.length} rows finalized.`);

  // Verify
  const { data: post } = await supabase
    .from("teams")
    .select("abbreviation, external_id")
    .eq("sport", "mlb")
    .order("abbreviation");
  console.log();
  console.log("━━━ Post-apply teams.external_id ━━━");
  for (const t of post ?? []) {
    console.log(`  ${t.abbreviation.padEnd(5)} external_id=${t.external_id}`);
  }
  console.log();
  console.log("APPLY complete.");
  console.log("Next step: delete the 6 wrong-matchup draft games (4.1.9.C-1c.iii)");
  console.log("           then re-run refresh-slate.ts dry-run.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
