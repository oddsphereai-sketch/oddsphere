/**
 * Push 3A-4 Phase 2 — BDL player backfill operator.
 *
 * For an expected MLB slate, fetches the raw BDL /lineups response (which
 * includes nested player + team objects with full names and abbreviations),
 * compares against the players table, and proposes one of three actions
 * per unmapped BDL player ID:
 *
 *   • LINK   — exact 1 match by full_name + team_id (DB). Updates the
 *              existing row's provider_ids.bdl.id.
 *   • CREATE — no match in DB. Inserts a new player row with
 *              provider_ids.bdl.id and the metadata BDL provided.
 *   • SKIP   — ambiguous (multiple matches) OR missing key fields
 *              (name, team). Reason recorded; no write.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/backfill-bdl-players.ts \
 *       --sport mlb --date 2026-06-06 [--verbose]
 *
 *   Apply:
 *     BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true \
 *       PLAYER_STATS_PROVIDER=real_api \
 *       npx tsx --env-file=.env.local scripts/operator/backfill-bdl-players.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY:
 *   • Two-key apply gate (--apply + env flag).
 *   • Provider-mode guard (PLAYER_STATS_PROVIDER must be real_api).
 *   • Ambiguous matches NEVER written; reported with player + team info
 *     so the operator can resolve manually.
 *   • Existing players are linked (provider_ids merged) — name, position,
 *     team_id are NEVER overwritten by this script.
 *   • New rows minimal: id (auto), sport, team_id, full_name + first/last,
 *     bats/throws (if BDL provides), position_abbr (if BDL provides),
 *     is_pitcher, active=true, provider_ids.bdl.{id, mapped_at, mapped_via,
 *     confidence}. external_id intentionally LEFT NULL — we don't have an
 *     MLB Stats API ID to assign.
 *   • Writes ONLY to the `players` table.
 *   • Never writes predictions, slate_status, locked_at, lineups, weather,
 *     or tracking.
 *
 * Push 3A-3 found that BDL responses wrap player + team as nested objects
 * with .id and .full_name — the existing BallDontLieProvider.mapLineup
 * already reads the nested team.id and player.id (post-3A-3 fix), but
 * doesn't carry the names through to StatsLineupRecord. This script
 * hits BDL directly so it can access the full nested data.
 */

import { supabase } from "../../lib/db/supabase";
import { loadGameIdMap, loadTeamIdMap, loadPlayerBdlIdMap } from "../../lib/services/_idMaps";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = {
  sport: Sport;
  date: string;
  apply: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): Opts {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose") { verbose = true; continue; }
  }
  if (!date) {
    console.error("Usage: backfill-bdl-players.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

type BdlPlayer = {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  bats_throws: string | null;
  jersey: string | null;
  active: boolean | null;
  team: { id: number; abbreviation: string; name: string } | null;
};

type RawLineupResponse = {
  data: Array<{
    game_id: number;
    player: BdlPlayer;
    team: { id: number; abbreviation: string };
    batting_order: number | null;
    position: string | null;
    is_probable_pitcher: boolean | null;
  }>;
  meta?: { next_cursor?: number | null };
};

async function fetchBdlLineups(apiKey: string, gameExternalId: number): Promise<RawLineupResponse["data"]> {
  const url = `https://api.balldontlie.io/mlb/v1/lineups?game_ids[]=${gameExternalId}&per_page=100`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    throw new Error(`BDL /lineups ${gameExternalId} failed: ${res.status} ${res.statusText}`);
  }
  const j = (await res.json()) as RawLineupResponse;
  return j.data ?? [];
}

/** Parse "L/R" → { bats: "L", throws: "R" }; nulls allowed. */
function parseBatsThrows(s: string | null): { bats: string | null; throws: string | null } {
  if (!s || typeof s !== "string") return { bats: null, throws: null };
  const m = s.match(/^([LRS])\s*\/\s*([LR])/);
  if (!m) return { bats: null, throws: null };
  return { bats: m[1]!, throws: m[2]! };
}

async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.error("✗ BALLDONTLIE_API_KEY missing from env.");
    process.exit(1);
  }
  const envEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
  const providerMode = process.env.PLAYER_STATS_PROVIDER === "real_api" ? "real_api" : "mock";
  const writeMode = opts.apply && envEnabled && providerMode === "real_api";

  console.log(`\n━━━ BDL PLAYER BACKFILL · ${opts.date} ━━━`);
  console.log(`         mode=${writeMode ? "APPLY" : "DRY-RUN"}  sport=${opts.sport}  provider=${providerMode}`);
  if (opts.apply && !envEnabled) {
    console.error(`✗ --apply requires BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true in env.`);
    process.exit(1);
  }
  if (opts.apply && providerMode !== "real_api") {
    console.error(`✗ --apply requires PLAYER_STATS_PROVIDER=real_api in env.`);
    process.exit(1);
  }
  console.log("");

  // ─── Pre-flight: id maps ───────────────────────────────────────────
  const gameIdByExternal = await loadGameIdMap(opts.sport, opts.date);
  const teamIdByExternal = await loadTeamIdMap(opts.sport);
  const bdlPlayerMap = await loadPlayerBdlIdMap(opts.sport);
  console.log(`Pre-flight maps: games=${gameIdByExternal.size}  teams=${teamIdByExternal.size}  bdl_players=${bdlPlayerMap.size}`);

  if (gameIdByExternal.size === 0) {
    console.log("No games on slate. Nothing to backfill.");
    return;
  }

  // ─── Collect BDL player payloads from raw /lineups ────────────────
  const playerByBdlId = new Map<number, BdlPlayer>();
  let apiCalls = 0;
  for (const [extGameId, _] of gameIdByExternal) {
    const rows = await fetchBdlLineups(apiKey, extGameId);
    apiCalls++;
    for (const r of rows) {
      const p = r.player;
      if (!p || typeof p.id !== "number") continue;
      if (!playerByBdlId.has(p.id)) {
        playerByBdlId.set(p.id, p);
      }
    }
  }
  console.log(`Fetched lineup payloads: ${apiCalls} games  |  unique BDL players: ${playerByBdlId.size}`);

  // ─── Classify each unique BDL player ──────────────────────────────
  type Action = "already_linked" | "link" | "create" | "skip_ambiguous" | "skip_missing_team" | "skip_missing_name" | "skip_team_unmapped";
  type Plan = {
    bdl_id: number;
    full_name: string;
    bdl_team_id: number | null;
    bdl_team_abbr: string | null;
    db_team_id: number | null;
    action: Action;
    db_player_id?: number | null;
    note?: string;
    raw: BdlPlayer;
  };
  const plans: Plan[] = [];

  for (const [bdlId, p] of playerByBdlId) {
    if (bdlPlayerMap.has(bdlId)) {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team?.id ?? null, bdl_team_abbr: p.team?.abbreviation ?? null, db_team_id: null, action: "already_linked", raw: p });
      continue;
    }
    if (!p.full_name) {
      plans.push({ bdl_id: bdlId, full_name: "(unknown)", bdl_team_id: p.team?.id ?? null, bdl_team_abbr: p.team?.abbreviation ?? null, db_team_id: null, action: "skip_missing_name", raw: p });
      continue;
    }
    if (!p.team || typeof p.team.id !== "number") {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: null, bdl_team_abbr: null, db_team_id: null, action: "skip_missing_team", raw: p });
      continue;
    }
    const dbTeamId = teamIdByExternal.get(p.team.id);
    if (dbTeamId === undefined) {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: null, action: "skip_team_unmapped", raw: p });
      continue;
    }
    // Look for existing player by full_name + team_id (DB scope: sport=mlb)
    const { data: matches, error: matchErr } = await supabase
      .from("players")
      .select("id, full_name, team_id, active, provider_ids")
      .eq("sport", opts.sport)
      .eq("team_id", dbTeamId)
      .ilike("full_name", p.full_name); // ilike for casefold-safety
    if (matchErr) {
      console.error(`✗ match query failed for ${p.full_name}: ${matchErr.message}`);
      continue;
    }
    if (!matches || matches.length === 0) {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: dbTeamId, action: "create", raw: p });
    } else if (matches.length === 1) {
      const m = matches[0]!;
      // Defensive: if the existing row ALREADY has a different bdl_id, that's
      // ambiguous (BDL player conflicts with existing mapping) — skip.
      const existingBdl = (m.provider_ids as { bdl?: { id?: number } } | null)?.bdl?.id;
      if (typeof existingBdl === "number" && existingBdl !== bdlId) {
        plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: dbTeamId, action: "skip_ambiguous", note: `existing player ${m.id} has bdl id ${existingBdl}`, raw: p });
      } else {
        plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: dbTeamId, db_player_id: m.id as number, action: "link", raw: p });
      }
    } else {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: dbTeamId, action: "skip_ambiguous", note: `${matches.length} DB matches by name+team`, raw: p });
    }
  }

  // ─── Report plan ───────────────────────────────────────────────────
  const counts: Record<Action, number> = {
    already_linked: 0, link: 0, create: 0, skip_ambiguous: 0,
    skip_missing_team: 0, skip_missing_name: 0, skip_team_unmapped: 0,
  };
  for (const p of plans) counts[p.action]++;
  console.log(`\nPlan summary:`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(22)}  ${v}`);

  if (opts.verbose) {
    console.log(`\nVerbose plan:`);
    for (const p of plans.filter((p) => p.action !== "already_linked")) {
      console.log(`  ${p.action.padEnd(22)}  bdl=${p.bdl_id}  ${p.full_name.padEnd(28)} team=${p.bdl_team_abbr ?? "—"}${p.note ? `  (${p.note})` : ""}`);
    }
  }

  if (!writeMode) {
    console.log(`\nDRY-RUN — no DB writes.`);
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────
  console.log(`\nApplying ${counts.link + counts.create} player rows...`);
  const now = new Date().toISOString();
  let linked = 0, created = 0, failed = 0;

  for (const plan of plans) {
    if (plan.action === "link" && plan.db_player_id !== undefined && plan.db_player_id !== null) {
      const { data: existing } = await supabase.from("players").select("provider_ids").eq("id", plan.db_player_id).maybeSingle();
      const existingPi = (existing?.provider_ids as Record<string, unknown> | null) ?? {};
      const newPi = {
        ...existingPi,
        bdl: { id: plan.bdl_id, name: plan.full_name, mapped_at: now, confidence: "high", mapped_via: "push_3a4_name_team_v1" },
      };
      const { error } = await supabase.from("players").update({ provider_ids: newPi, updated_at: now }).eq("id", plan.db_player_id);
      if (error) { console.error(`✗ link failed for ${plan.full_name}: ${error.message}`); failed++; }
      else linked++;
    } else if (plan.action === "create" && plan.db_team_id !== null) {
      const bt = parseBatsThrows(plan.raw.bats_throws);
      const position = plan.raw.position;
      const positionAbbr = position && position.length <= 4 ? position : null;
      const isPitcher = position === "P" || position === "SP" || position === "RP";
      const insertRow = {
        external_id: null,
        sport: opts.sport,
        team_id: plan.db_team_id,
        first_name: plan.raw.first_name ?? plan.full_name.split(" ")[0] ?? "",
        last_name: plan.raw.last_name ?? plan.full_name.split(" ").slice(1).join(" ") ?? "",
        full_name: plan.full_name,
        jersey: plan.raw.jersey ?? null,
        position: position,
        position_abbr: positionAbbr,
        is_pitcher: isPitcher,
        active: plan.raw.active !== false,
        bats: bt.bats,
        throws: bt.throws,
        provider_ids: {
          bdl: { id: plan.bdl_id, name: plan.full_name, mapped_at: now, confidence: "high", mapped_via: "push_3a4_bdl_only_v1" },
        },
        created_at: now,
        updated_at: now,
      };
      const { error } = await supabase.from("players").insert(insertRow);
      if (error) { console.error(`✗ create failed for ${plan.full_name}: ${error.message}`); failed++; }
      else created++;
    }
  }
  console.log(`\nApply result: linked=${linked}  created=${created}  failed=${failed}`);

  // Post-apply: re-read BDL map to confirm
  const post = await loadPlayerBdlIdMap(opts.sport);
  console.log(`Post-apply BDL player map size: ${bdlPlayerMap.size} → ${post.size}`);
  console.log(`\n✅ BDL player backfill applied for ${opts.sport.toUpperCase()} ${opts.date}.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
