/**
 * BDL player backfill service.
 *
 * Push 3B-5f — extracted from scripts/operator/backfill-bdl-players.ts
 * so /api/cron/feature-coverage-refresh can import it without dragging
 * the CLI top-level `main()` call into the Next build worker (which
 * exited 1 during page-data collection on Vercel).
 *
 * Same classification rules as the operator CLI:
 *   already_linked | link | create | skip_ambiguous |
 *   skip_missing_team | skip_missing_name | skip_team_unmapped
 *
 * Writes ONLY to the `players` table. Ambiguous matches are NEVER
 * written. Existing name/position/team_id are NEVER overwritten —
 * link mode only merges provider_ids.bdl.
 */

import { supabase } from "../db/supabase";
import { loadGameIdMap, loadTeamIdMap, loadPlayerBdlIdMap } from "./_idMaps";
import type { Sport } from "../types/domain/Sport";

export type BdlPlayer = {
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

export type BdlBackfillAction =
  | "already_linked"
  | "link"
  | "create"
  | "skip_ambiguous"
  | "skip_missing_team"
  | "skip_missing_name"
  | "skip_team_unmapped";

export type BdlBackfillCounts = Record<BdlBackfillAction, number>;

export type BdlBackfillPlan = {
  bdl_id: number;
  full_name: string;
  bdl_team_id: number | null;
  bdl_team_abbr: string | null;
  db_team_id: number | null;
  action: BdlBackfillAction;
  db_player_id?: number | null;
  note?: string;
  raw: BdlPlayer;
};

export type BdlBackfillResult = {
  status: "dry_run" | "wrote" | "no_changes" | "no_slate";
  unique_bdl_players: number;
  api_calls: number;
  counts: BdlBackfillCounts;
  linked: number;
  created: number;
  failed: number;
  pre_map_size: number;
  post_map_size: number;
};

export function emptyCounts(): BdlBackfillCounts {
  return {
    already_linked: 0, link: 0, create: 0, skip_ambiguous: 0,
    skip_missing_team: 0, skip_missing_name: 0, skip_team_unmapped: 0,
  };
}

export function parseBatsThrows(s: string | null): { bats: string | null; throws: string | null } {
  if (!s || typeof s !== "string") return { bats: null, throws: null };
  const m = s.match(/^([LRS])\s*\/\s*([LR])/);
  if (!m) return { bats: null, throws: null };
  return { bats: m[1]!, throws: m[2]! };
}

export async function fetchBdlLineups(apiKey: string, gameExternalId: number): Promise<RawLineupResponse["data"]> {
  const url = `https://api.balldontlie.io/mlb/v1/lineups?game_ids[]=${gameExternalId}&per_page=100`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    throw new Error(`BDL /lineups ${gameExternalId} failed: ${res.status} ${res.statusText}`);
  }
  const j = (await res.json()) as RawLineupResponse;
  return j.data ?? [];
}

export async function classifyBdlPlayers(
  playerByBdlId: Map<number, BdlPlayer>,
  bdlPlayerMap: Awaited<ReturnType<typeof loadPlayerBdlIdMap>>,
  teamIdByExternal: Map<number, number>,
  sport: Sport,
): Promise<BdlBackfillPlan[]> {
  const plans: BdlBackfillPlan[] = [];
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
    const { data: matches } = await supabase
      .from("players")
      .select("id, full_name, team_id, active, provider_ids")
      .eq("sport", sport)
      .eq("team_id", dbTeamId)
      .ilike("full_name", p.full_name);
    if (!matches || matches.length === 0) {
      plans.push({ bdl_id: bdlId, full_name: p.full_name, bdl_team_id: p.team.id, bdl_team_abbr: p.team.abbreviation, db_team_id: dbTeamId, action: "create", raw: p });
    } else if (matches.length === 1) {
      const m = matches[0]!;
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
  return plans;
}

export function countPlans(plans: BdlBackfillPlan[]): BdlBackfillCounts {
  const c = emptyCounts();
  for (const p of plans) c[p.action]++;
  return c;
}

export async function runBdlPlayerBackfillCycle(args: {
  sport: Sport;
  date: string;
  writeMode: boolean;
  log?: (m: string) => void;
}): Promise<BdlBackfillResult> {
  const log = args.log ?? (() => {});
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY missing");
  const gameIdByExternal = await loadGameIdMap(args.sport, args.date);
  const teamIdByExternal = await loadTeamIdMap(args.sport);
  const bdlPlayerMap = await loadPlayerBdlIdMap(args.sport);
  const preSize = bdlPlayerMap.size;
  if (gameIdByExternal.size === 0) {
    return { status: "no_slate", unique_bdl_players: 0, api_calls: 0, counts: emptyCounts(), linked: 0, created: 0, failed: 0, pre_map_size: preSize, post_map_size: preSize };
  }
  const playerByBdlId = new Map<number, BdlPlayer>();
  let apiCalls = 0;
  for (const [extGameId] of gameIdByExternal) {
    const rows = await fetchBdlLineups(apiKey, extGameId);
    apiCalls++;
    for (const r of rows) {
      const p = r.player;
      if (!p || typeof p.id !== "number") continue;
      if (!playerByBdlId.has(p.id)) playerByBdlId.set(p.id, p);
    }
  }
  const plans = await classifyBdlPlayers(playerByBdlId, bdlPlayerMap, teamIdByExternal, args.sport);
  const counts = countPlans(plans);
  if (!args.writeMode) {
    log(`dry_run plans: ${JSON.stringify(counts)}`);
    return { status: counts.link + counts.create === 0 ? "no_changes" : "dry_run", unique_bdl_players: playerByBdlId.size, api_calls: apiCalls, counts, linked: 0, created: 0, failed: 0, pre_map_size: preSize, post_map_size: preSize };
  }
  const now = new Date().toISOString();
  let linked = 0, created = 0, failed = 0;
  for (const plan of plans) {
    if (plan.action === "link" && plan.db_player_id !== undefined && plan.db_player_id !== null) {
      const { data: existing } = await supabase.from("players").select("provider_ids").eq("id", plan.db_player_id).maybeSingle();
      const existingPi = (existing?.provider_ids as Record<string, unknown> | null) ?? {};
      const newPi = { ...existingPi, bdl: { id: plan.bdl_id, name: plan.full_name, mapped_at: now, confidence: "high", mapped_via: "push_3a4_name_team_v1" } };
      const { error } = await supabase.from("players").update({ provider_ids: newPi, updated_at: now }).eq("id", plan.db_player_id);
      if (error) { log(`link failed for ${plan.full_name}: ${error.message}`); failed++; }
      else linked++;
    } else if (plan.action === "create" && plan.db_team_id !== null) {
      const bt = parseBatsThrows(plan.raw.bats_throws);
      const position = plan.raw.position;
      const positionAbbr = position && position.length <= 4 ? position : null;
      const isPitcher = position === "P" || position === "SP" || position === "RP";
      const insertRow = {
        external_id: null, sport: args.sport, team_id: plan.db_team_id,
        first_name: plan.raw.first_name ?? plan.full_name.split(" ")[0] ?? "",
        last_name: plan.raw.last_name ?? plan.full_name.split(" ").slice(1).join(" ") ?? "",
        full_name: plan.full_name, jersey: plan.raw.jersey ?? null,
        position, position_abbr: positionAbbr, is_pitcher: isPitcher,
        active: plan.raw.active !== false, bats: bt.bats, throws: bt.throws,
        provider_ids: { bdl: { id: plan.bdl_id, name: plan.full_name, mapped_at: now, confidence: "high", mapped_via: "push_3a4_bdl_only_v1" } },
        created_at: now, updated_at: now,
      };
      const { error } = await supabase.from("players").insert(insertRow);
      if (error) { log(`create failed for ${plan.full_name}: ${error.message}`); failed++; }
      else created++;
    }
  }
  const post = await loadPlayerBdlIdMap(args.sport);
  return { status: linked + created > 0 ? "wrote" : "no_changes", unique_bdl_players: playerByBdlId.size, api_calls: apiCalls, counts, linked, created, failed, pre_map_size: preSize, post_map_size: post.size };
}
