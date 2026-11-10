import type { SupabaseClient } from "@supabase/supabase-js";
import { nflPlayerPropsSettlementNameKey, nflPlayerPropsSettlementTeamKey } from "./nflPlayerPropsSettlementIdentity";
import { nflPropsSettlementEvent, settleNflPropsExactEvent } from "./nflPlayerPropsLockedEvent";

export const NFL_PLAYER_PROPS_SETTLEMENT_RELEASE =
  "nfl_player_props_settlement_2026_11_10_r8_exact_locked_event" as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MINIMUM_HOURS_AFTER_LOCK = 5 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE = 1_000 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE = 18 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_SNAP_PAGES = 2 as const;
export const NFL_PLAYER_PROPS_SETTLEMENT_MAX_DESIGNATION_PAGES = 2 as const;
const ZERO_ELIGIBLE_MARKETS = new Set(["passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards", "receptions", "receiving_yards", "anytime_td"]);

type Pending = { id: number; provider_game_id: string; provider_player_id: string | null; player_name?: string; team?: string | null; market: string; line: number; side: "over" | "under" | "yes"; locked_at: string; sportsbook?: string; locked_price?: number; decision_release?: string; model_release?: string; locked_event?: unknown };
export type NflPropsSettlementProposal = { id: number; gameId: string; resolvedPlayerId: string; actual: number | null; result: "win" | "loss" | "push" | "void" };

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
    .select("id,provider_game_id,provider_player_id,player_name,team,market,line,side,locked_at,sportsbook,locked_price,decision_release,model_release,locked_event:snapshot_json->lockedEvent")
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
    let finalGame: Record<string, unknown> | null = null;
    for (const value of body.data) {
      if (!value || typeof value !== "object") continue;
      const stat = value as Record<string, unknown>; const player = stat.player as Record<string, unknown> | undefined; const game = stat.game as Record<string, unknown> | undefined;
      if (String(game?.id) !== gameId || game?.status_state !== "final") continue;
      final = true;
      finalGame = game!;
      if (typeof player?.id === "number") stats.set(String(player.id), stat);
    }
    if (!final) continue;
    // Stats omit some players who participated but recorded no box-score stat.
    // A missing row alone is never zero: require an independently returned
    // exact-game final snap record with positive, valid participation.
    let snaps: Map<string, Record<string, unknown>> | null = null;
    const needsSnaps = rows.some(row => ZERO_ELIGIBLE_MARKETS.has(row.market) && (!row.provider_player_id || !stats.has(row.provider_player_id))
      && !(recoveryIds && exactFinalGamePlayer(stats, row)));
    if (needsSnaps) {
      snaps = new Map();
      let cursor: string | null = null;
      for (let page = 0; page < NFL_PLAYER_PROPS_SETTLEMENT_MAX_SNAP_PAGES; page += 1) {
        const snapUrl = new URL("https://api.balldontlie.io/nfl/v1/snap_counts");
        snapUrl.searchParams.append("game_ids[]", gameId); snapUrl.searchParams.set("per_page", "100");
        if (cursor) snapUrl.searchParams.set("cursor", cursor);
        const snapResponse = await (args.fetchImpl ?? fetch)(snapUrl, { headers: { Authorization: args.apiKey, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        apiCalls += 1;
        if (!snapResponse.ok) throw new Error(`BALLDONTLIE NFL settlement participation failed with HTTP ${snapResponse.status}.`);
        const snapBody = await snapResponse.json() as { data?: unknown; meta?: { next_cursor?: unknown } };
        if (!Array.isArray(snapBody.data)) throw new Error("NFL settlement participation payload is invalid.");
        for (const value of snapBody.data) {
          if (!value || typeof value !== "object") continue;
          const snap = value as Record<string, unknown>;
          const player = snap.player as Record<string, unknown> | undefined;
          const game = snap.game as Record<string, unknown> | undefined;
          if (String(game?.id) !== gameId || game?.status_state !== "final" || typeof player?.id !== "number") continue;
          const phases = [snap.offense_snaps, snap.defense_snaps, snap.special_teams_snaps];
          if (!phases.every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
            || !phases.some(value => Number(value) > 0)) continue;
          if (snaps.has(String(player.id))) throw new Error("Duplicate NFL settlement participation identity.");
          snaps.set(String(player.id), snap);
        }
        cursor = snapBody.meta?.next_cursor == null ? null : String(snapBody.meta.next_cursor);
        if (!cursor) break;
        if (page === NFL_PLAYER_PROPS_SETTLEMENT_MAX_SNAP_PAGES - 1) throw new Error("NFL settlement participation exceeded its exact-game page bound.");
      }
    }
    // Explicit completed-game DNP is different from a missing stat/snap row.
    // Only query when the existing sources cannot establish participation.
    const unresolved = rows.filter(row => !row.provider_player_id
      ? Boolean(recoveryIds && !exactFinalGamePlayer(stats, row) && !(snaps && exactFinalGamePlayer(snaps, row)))
      : !stats.has(row.provider_player_id) && !snaps?.has(row.provider_player_id));
    const designations: Record<string, unknown>[] = [];
    const season = finalGame?.season, week = finalGame?.week;
    const gameTeams = [finalGame?.home_team, finalGame?.visitor_team]
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
    const teamIds = [...new Set(unresolved.flatMap(row => gameTeams.filter(team => row.team
      && nflPlayerPropsSettlementTeamKey(String(team.abbreviation ?? "")) === nflPlayerPropsSettlementTeamKey(row.team))
      .map(team => team.id).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0)))];
    if (unresolved.length && teamIds.length && typeof season === "number" && Number.isSafeInteger(season)
      && typeof week === "number" && Number.isSafeInteger(week)) {
      let cursor: string | null = null;
      for (let page = 0; page < NFL_PLAYER_PROPS_SETTLEMENT_MAX_DESIGNATION_PAGES; page += 1) {
        const url = new URL("https://api.balldontlie.io/nfl/v1/player_designations");
        url.searchParams.set("season", String(season)); url.searchParams.set("week", String(week));
        url.searchParams.set("per_page", "100");
        url.searchParams.append("season_types[]", finalGame?.postseason === true ? "3" : "2");
        for (const id of teamIds) url.searchParams.append("team_ids[]", String(id));
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await (args.fetchImpl ?? fetch)(url, { headers: { Authorization: args.apiKey, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        apiCalls += 1;
        if (!response.ok) throw new Error(`BALLDONTLIE NFL settlement designations failed with HTTP ${response.status}.`);
        const body = await response.json() as { data?: unknown; meta?: { next_cursor?: unknown } };
        if (!Array.isArray(body.data)) throw new Error("NFL settlement designation payload is invalid.");
        designations.push(...body.data.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")));
        cursor = body.meta?.next_cursor == null ? null : String(body.meta.next_cursor);
        if (!cursor) break;
        if (page === NFL_PLAYER_PROPS_SETTLEMENT_MAX_DESIGNATION_PAGES - 1) throw new Error("NFL settlement designations exceeded the page bound.");
      }
    }
    for (const row of rows) {
      const event = nflPropsSettlementEvent(row);
      if (event.status === "invalid") continue;
      const recovered = !row.provider_player_id && recoveryIds
        ? exactFinalGamePlayer(stats, row) ?? (snaps && exactFinalGamePlayer(snaps, row)) : null;
      const dnp = confirmedDnpPlayer(designations, row, finalGame, Boolean(recoveryIds));
      const playerId = row.provider_player_id ?? recovered?.playerId ?? (dnp?.player as Record<string, unknown> | undefined)?.id?.toString();
      if (!playerId) continue;
      const stat = stats.get(playerId);
      const snap = snaps?.get(playerId);
      const confirmedDnp = !stat && !snap && dnp;
      const identity = stat ?? snap ?? confirmedDnp;
      if (!identity || row.team && nflPlayerPropsSettlementTeamKey(String((identity.team as Record<string, unknown> | undefined)?.abbreviation ?? "")) !== nflPlayerPropsSettlementTeamKey(row.team)) continue;
      const actual = stat ? actualValue(row.market, stat) : snap && ZERO_ELIGIBLE_MARKETS.has(row.market) ? 0 : null;
      if (actual === null && !confirmedDnp) continue;
      const result = confirmedDnp ? "void" : event.status === "exact" ? settleNflPropsExactEvent(event.event, actual!)
        : row.side === "yes" ? (actual! >= 1 ? "win" : "loss") : actual === Number(row.line) ? "push" : row.side === "over" ? (actual! > Number(row.line) ? "win" : "loss") : (actual! < Number(row.line) ? "win" : "loss");
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

function confirmedDnpPlayer(rows: readonly Record<string, unknown>[], record: Pending,
  game: Record<string, unknown> | null, approvedRecovery: boolean): Record<string, unknown> | null {
  if (!game || !record.team) return null;
  const matches = rows.filter(row => {
    const player = row.player as Record<string, unknown> | undefined;
    const team = row.team as Record<string, unknown> | undefined;
    const expectedTeam = [game.home_team, game.visitor_team].find(value => value && typeof value === "object"
      && nflPlayerPropsSettlementTeamKey(String((value as Record<string, unknown>).abbreviation ?? "")) === nflPlayerPropsSettlementTeamKey(record.team!)) as Record<string, unknown> | undefined;
    const name = `${typeof player?.first_name === "string" ? player.first_name : ""} ${typeof player?.last_name === "string" ? player.last_name : ""}`;
    return String(row.game_id) === record.provider_game_id && row.season === game.season && row.week === game.week
      && row.season_type === (game.postseason === true ? "postseason" : "regular")
      && typeof player?.id === "number" && Number.isSafeInteger(player.id) && player.id > 0
      && (record.provider_player_id ? String(player.id) === record.provider_player_id
        : approvedRecovery && record.player_name && nflPlayerPropsSettlementNameKey(name) === nflPlayerPropsSettlementNameKey(record.player_name))
      && expectedTeam && team?.id === expectedTeam.id && typeof team?.abbreviation === "string" && nflPlayerPropsSettlementTeamKey(team.abbreviation) === nflPlayerPropsSettlementTeamKey(record.team!);
  });
  return matches.length === 1 && matches[0].did_not_play === true && matches[0].starter !== true ? matches[0] : null;
}

function exactFinalGamePlayer(stats: ReadonlyMap<string, Record<string, unknown>>, row: Pending): { playerId: string } | null {
  if (!row.player_name || !row.team) return null;
  const ids = [...stats.entries()].filter(([, stat]) => {
    const player = stat.player as Record<string, unknown> | undefined;
    const team = stat.team as Record<string, unknown> | undefined;
    const game = stat.game as Record<string, unknown> | undefined;
    const name = `${typeof player?.first_name === "string" ? player.first_name : ""} ${typeof player?.last_name === "string" ? player.last_name : ""}`;
    return String(game?.id) === row.provider_game_id && game?.status_state === "final"
      && nflPlayerPropsSettlementNameKey(name) === nflPlayerPropsSettlementNameKey(row.player_name!)
      && typeof team?.abbreviation === "string" && nflPlayerPropsSettlementTeamKey(team.abbreviation) === nflPlayerPropsSettlementTeamKey(row.team!);
  }).map(([playerId]) => playerId);
  return ids.length === 1 ? { playerId: ids[0]! } : null;
}

function actualValue(market: string, stat: Record<string, unknown>): number | null {
  // These offered AI heads use provider passing fields, never defensive
  // interceptions or a passing TD's contribution to an anytime scorer market.
  // An absent/invalid field stays pending; participation alone cannot supply it.
  if (market === "passing_tds" || market === "interceptions") {
    const value = market === "passing_tds" ? stat.passing_touchdowns ?? stat.passing_tds : stat.passing_interceptions;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (!ZERO_ELIGIBLE_MARKETS.has(market)) return null;
  if (market === "anytime_td") return sum(stat, ["rushing_touchdowns", "receiving_touchdowns", "kick_return_touchdowns", "punt_return_touchdowns", "fumbles_touchdowns"]);
  const value = stat[market];
  return value == null ? 0 : typeof value === "number" && Number.isFinite(value) ? value : null;
}
function sum(row: Record<string, unknown>, fields: string[]): number { return fields.reduce((total, field) => total + (typeof row[field] === "number" ? Number(row[field]) : 0), 0); }
