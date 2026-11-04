import type { SupabaseClient } from "@supabase/supabase-js";

export const NFL_PLAYER_PROPS_SETTLEMENT_RELEASE =
  "nfl_player_props_settlement_2026_11_04_r4_identity_queue_isolation" as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MINIMUM_HOURS_AFTER_LOCK = 5 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE = 1_000 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE = 18 as const;

type Pending = { id: number; provider_game_id: string; provider_player_id: string | null; player_name?: string; team?: string | null; market: string; line: number; side: "over" | "under" | "yes"; locked_at: string };
export type NflPropsSettlementProposal = { id: number; gameId: string; resolvedPlayerId: string; actual: number; result: "win" | "loss" | "push" };

export async function countNflPlayerPropsUnresolvedSettlementIdentities(client: SupabaseClient, now: string): Promise<number> {
  const cutoff = new Date(Date.parse(now) - NFL_PLAYER_PROPS_SETTLEMENT_MINIMUM_HOURS_AFTER_LOCK * 3_600_000).toISOString();
  const { count, error } = await client.from("nfl_player_prop_records").select("id", { count: "exact", head: true })
    .eq("result", "pending").is("provider_player_id", null).lte("locked_at", cutoff);
  if (error) throw new Error(`NFL props unresolved settlement identity count failed: ${error.message}`);
  return count ?? 0;
}

export async function settleNflPlayerPropsRecords(args: {
  client: SupabaseClient;
  apiKey: string;
  now: string;
  fetchImpl?: typeof fetch;
  /** Operator-only recovery for an explicitly owner-approved historical cohort. */
  recoverMissingIdentityRecordIds?: readonly number[];
  apply?: boolean;
  onProposal?: (proposal: NflPropsSettlementProposal) => void;
}): Promise<{
  pending: number;
  eligible: number;
  eligibleGames: number;
  processedGames: number;
  deferredGames: number;
  recordReadLimitReached: boolean;
  settled: number;
  apiCalls: number;
}> {
  const now = Date.parse(args.now);
  if (!Number.isFinite(now)) throw new Error("NFL player props settlement now is invalid.");
  const eligibleLockedAt = new Date(now - NFL_PLAYER_PROPS_SETTLEMENT_MINIMUM_HOURS_AFTER_LOCK * 3_600_000).toISOString();
  const recoveryIds = args.recoverMissingIdentityRecordIds;
  if (recoveryIds && (recoveryIds.length === 0 || recoveryIds.length > 1_000
    || recoveryIds.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error("Invalid owner-approved settlement recovery cohort.");
  let query = args.client.from("nfl_player_prop_records")
    .select("id,provider_game_id,provider_player_id,player_name,team,market,line,side,locked_at")
    .eq("result", "pending");
  query = recoveryIds ? query.in("id", [...recoveryIds]) : query
    // Unresolvable legacy identities must not consume the bounded page or
    // game allowance and starve newer records that can actually be settled.
    .not("provider_player_id", "is", null);
  const { data, error } = await query
    .lte("locked_at", eligibleLockedAt)
    .order("locked_at", { ascending: true })
    .limit(NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE);
  if (error) {
    if (/relation .*nfl_player_prop_records.* does not exist|schema cache/i.test(error.message)) {
      return { pending: 0, eligible: 0, eligibleGames: 0, processedGames: 0, deferredGames: 0, recordReadLimitReached: false, settled: 0, apiCalls: 0 };
    }
    throw new Error(`NFL player props pending tracking read failed: ${error.message}`);
  }
  const pending = (data ?? []) as Pending[];
  const byGame = new Map<string, Pending[]>();
  for (const row of pending) byGame.set(row.provider_game_id, [...(byGame.get(row.provider_game_id) ?? []), row]);
  const gameBatches = [...byGame.entries()]
    .sort(([firstId, firstRows], [secondId, secondRows]) => (
      Date.parse(firstRows[0]!.locked_at) - Date.parse(secondRows[0]!.locked_at)
      || firstId.localeCompare(secondId)
    ))
    .slice(0, NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE);
  let settled = 0; let apiCalls = 0;
  for (const [gameId, rows] of gameBatches) {
    const url = new URL("https://api.balldontlie.io/nfl/v1/stats");
    url.searchParams.append("game_ids[]", gameId); url.searchParams.set("per_page", "100");
    const response = await (args.fetchImpl ?? fetch)(url, { headers: { Authorization: args.apiKey, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    apiCalls += 1;
    if (!response.ok) throw new Error(`BALLDONTLIE NFL stats settlement failed with HTTP ${response.status}.`);
    const body = await response.json() as { data?: unknown; meta?: { next_cursor?: unknown } };
    if (!Array.isArray(body.data) || body.meta?.next_cursor) throw new Error("BALLDONTLIE NFL stats settlement payload exceeded its exact-game safety contract.");
    const stats = new Map<string, Record<string, unknown>>(); let final = false;
    for (const value of body.data) {
      if (!value || typeof value !== "object") continue;
      const stat = value as Record<string, unknown>; const player = stat.player as Record<string, unknown> | undefined; const game = stat.game as Record<string, unknown> | undefined;
      if (game?.status_state === "final") final = true;
      if (typeof player?.id === "number") stats.set(String(player.id), stat);
    }
    if (!final) continue;
    for (const row of rows) {
      const recovered = !row.provider_player_id && recoveryIds
        ? exactFinalGamePlayer(stats, row) : null;
      const playerId = row.provider_player_id ?? recovered?.playerId;
      if (!playerId) continue;
      const stat = stats.get(playerId); if (!stat) continue;
      const actual = actualValue(row.market, stat); if (actual === null) continue;
      const result = row.side === "yes" ? (actual >= 1 ? "win" : "loss") : actual === Number(row.line) ? "push" : row.side === "over" ? (actual > Number(row.line) ? "win" : "loss") : (actual < Number(row.line) ? "win" : "loss");
      args.onProposal?.({ id: row.id, gameId, resolvedPlayerId: playerId, actual, result });
      if (args.apply === false) continue;
      const { error: updateError } = await args.client.from("nfl_player_prop_records").update({ result, actual_value: actual, settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("result", "pending");
      if (updateError) throw new Error(`NFL player props settlement write failed: ${updateError.message}`);
      settled += 1;
    }
  }
  return {
    pending: pending.length,
    eligible: pending.length,
    eligibleGames: byGame.size,
    processedGames: gameBatches.length,
    deferredGames: Math.max(0, byGame.size - gameBatches.length),
    recordReadLimitReached: pending.length === NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE,
    settled,
    apiCalls,
  };
}

function exactFinalGamePlayer(stats: ReadonlyMap<string, Record<string, unknown>>, row: Pending): { playerId: string } | null {
  if (!row.player_name || !row.team) return null;
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizeTeam = (value: string) => {
    const team = value.trim().toUpperCase();
    return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
  };
  const ids = [...stats.entries()].filter(([, stat]) => {
    const player = stat.player as Record<string, unknown> | undefined;
    const team = stat.team as Record<string, unknown> | undefined;
    const game = stat.game as Record<string, unknown> | undefined;
    const name = `${typeof player?.first_name === "string" ? player.first_name : ""} ${typeof player?.last_name === "string" ? player.last_name : ""}`;
    return String(game?.id) === row.provider_game_id && game?.status_state === "final"
      && normalizeName(name) === normalizeName(row.player_name!)
      && typeof team?.abbreviation === "string" && normalizeTeam(team.abbreviation) === normalizeTeam(row.team!);
  }).map(([playerId]) => playerId);
  return ids.length === 1 ? { playerId: ids[0]! } : null;
}

function actualValue(market: string, stat: Record<string, unknown>): number | null {
  if (market === "anytime_td") return sum(stat, ["rushing_touchdowns", "receiving_touchdowns", "kick_return_touchdowns", "punt_return_touchdowns", "fumbles_touchdowns"]);
  const value = stat[market]; return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function sum(row: Record<string, unknown>, fields: string[]): number { return fields.reduce((total, field) => total + (typeof row[field] === "number" ? Number(row[field]) : 0), 0); }
