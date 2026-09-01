import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";
import { buildNflPlayerPropsTrackingRows } from "./nflPlayerPropsProductionContract";
import type { NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";

export const NFL_PLAYER_PROPS_TRACKING_RELEASE =
  "nfl_player_props_tracking_2026_09_01_r7_qb_passing_projection" as const;

export async function writeLockedNflPlayerPropsTracking(args: {
  client: SupabaseClient;
  snapshot: NflPlayerPropsProductionSnapshot;
}): Promise<{ proposed: number; insertedOrExisting: number }> {
  const tracked = buildNflPlayerPropsTrackingRows(args.snapshot);
  if (tracked.length === 0) return { proposed: 0, insertedOrExisting: 0 };
  const decisions = new Map(args.snapshot.board.decisions.map((row) => [
    [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.line, row.side].join("|"), row,
  ]));
  const rows = tracked.map((row) => {
    const decision = decisions.get(row.trackingKey);
    return {
      tracking_key: row.trackingKey,
      provider_game_id: row.gameId,
      provider_player_id: row.providerPlayerId,
      player_name: row.playerName,
      team: decision?.team ?? null,
      market: row.market,
      line: row.line,
      side: row.side,
      sportsbook: row.sportsbook,
      locked_price: row.lockedPrice,
      locked_probability: row.lockedProbability,
      locked_expected_value: row.lockedExpectedValue,
      play_grade: row.grade,
      locked_at: row.lockedAt,
      model_release: row.modelRelease,
      calibration_release: row.calibrationRelease,
      decision_release: row.decisionRelease,
      snapshot_json: { trackingRelease: NFL_PLAYER_PROPS_TRACKING_RELEASE, decision },
    };
  });
  const { error } = await args.client.from("nfl_player_prop_records").upsert(rows, {
    onConflict: "tracking_key,decision_release",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`NFL player props tracking write failed: ${error.message}`);
  return { proposed: rows.length, insertedOrExisting: rows.length };
}

export async function updateNflPlayerPropsClosingPrices(args: {
  client: SupabaseClient;
  production: NflPlayerPropsProductionSnapshot;
  observations: NflPlayerPropsObservationSnapshot;
}): Promise<number> {
  const starts = new Map(args.observations.games.map((game) => [game.providerGameId, Date.parse(game.scheduledStart)]));
  const latest = new Map<string, { price: number; observedAt: string }>();
  for (const row of args.observations.observations) {
    if (row.isOpening || row.isLive || !row.canonicalGameId || !row.playerName) continue;
    const start = starts.get(row.canonicalGameId);
    if (!start || Date.parse(row.observedAt) > start) continue;
    const key = observationKey(row.canonicalGameId, row.playerName, row.market, row.line, row.side, row.sportsbook);
    const prior = latest.get(key);
    if (!prior || Date.parse(row.observedAt) > Date.parse(prior.observedAt)) latest.set(key, { price: row.americanPrice, observedAt: row.observedAt });
  }
  let updated = 0;
  for (const decision of args.production.board.decisions) {
    if (decision.state !== "locked" || (decision.grade !== "Best Angle" && decision.grade !== "Lean")) continue;
    const quote = latest.get(observationKey(decision.gameId, decision.playerName, decision.market, decision.line, decision.side, decision.sportsbook));
    if (!quote) continue;
    const closingImplied = implied(quote.price);
    const clv = 100 * (closingImplied - implied(decision.americanPrice));
    const { error } = await args.client.from("nfl_player_prop_records").update({
      closing_price: quote.price,
      closing_implied_probability: closingImplied,
      clv_probability_points: clv,
      updated_at: new Date().toISOString(),
    }).eq("tracking_key", trackingKey(decision)).eq("decision_release", decision.decisionRelease).eq("result", "pending");
    if (error) throw new Error(`NFL player props closing-price update failed: ${error.message}`);
    updated += 1;
  }
  return updated;
}

function observationKey(gameId: string, playerName: string, market: string, line: number, side: string, sportsbook: string): string {
  return [gameId, normalize(playerName), market, line, side, normalize(sportsbook)].join("|");
}
function trackingKey(row: { gameId: string; playerName: string; market: string; line: number; side: string }): string {
  return [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
