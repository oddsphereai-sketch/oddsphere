import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";
import { buildNflPlayerPropsTrackingRows } from "./nflPlayerPropsProductionContract";
import type { NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";
import type { NflPlayerPropsMarketObserverRow } from "./nflPlayerPropsMarketObserverStore";

export const NFL_PLAYER_PROPS_TRACKING_RELEASE =
  "nfl_player_props_tracking_2026_10_27_r36_consensus_contract_repair" as const;

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

export type NflPlayerPropsObserverClosingQuote = Readonly<{
  trackingKey: string;
  decisionRelease: string;
  sportsbook: string;
  closingPrice: number;
  observedAt: string;
}>;

/**
 * Resolve close metadata only from immutable exact T-60 rows. The tuple must
 * retain the same game, player, market, canonical line, side, sportsbook, and
 * decision release as the locked record. This function cannot reconstruct or
 * alter any prediction field.
 */
export function nflPlayerPropsObserverClosingQuotes(
  rows: readonly NflPlayerPropsMarketObserverRow[],
): NflPlayerPropsObserverClosingQuote[] {
  const latest = new Map<string, NflPlayerPropsObserverClosingQuote>();
  for (const row of rows) {
    if (row.landmark !== "t60_lock" || row.observedLine !== row.canonicalLine) continue;
    for (const side of row.targetSides) {
      const closingPrice = side === "over" ? row.overPrice : side === "under" ? row.underPrice : row.yesPrice;
      if (closingPrice === null || !Number.isInteger(closingPrice) || closingPrice === 0) continue;
      const quote: NflPlayerPropsObserverClosingQuote = {
        trackingKey: [row.gameId, normalize(row.playerName), row.market, row.canonicalLine, side].join("|"),
        decisionRelease: row.decisionRelease,
        sportsbook: row.sportsbook,
        closingPrice,
        observedAt: row.observedAt,
      };
      const identity = [quote.trackingKey, quote.decisionRelease, normalize(quote.sportsbook)].join("|");
      const prior = latest.get(identity);
      if (!prior || Date.parse(quote.observedAt) > Date.parse(prior.observedAt)) latest.set(identity, quote);
    }
  }
  return [...latest.values()].sort((first, second) => first.trackingKey.localeCompare(second.trackingKey));
}

export async function updateNflPlayerPropsClosingPricesFromObserver(args: {
  client: SupabaseClient;
  rows: readonly NflPlayerPropsMarketObserverRow[];
}): Promise<number> {
  const quotes = nflPlayerPropsObserverClosingQuotes(args.rows);
  if (quotes.length === 0) return 0;
  const quoteByIdentity = new Map(quotes.map((quote) => [
    [quote.trackingKey, quote.decisionRelease, normalize(quote.sportsbook)].join("|"),
    quote,
  ]));
  const records: Array<{
    id: number;
    tracking_key: string;
    decision_release: string;
    sportsbook: string;
    locked_price: number;
    closing_price: number | null;
  }> = [];
  const trackingKeys = [...new Set(quotes.map((quote) => quote.trackingKey))];
  for (let index = 0; index < trackingKeys.length; index += 150) {
    const { data, error: readError } = await args.client.from("nfl_player_prop_records")
      .select("id,tracking_key,decision_release,sportsbook,locked_price,closing_price")
      .in("tracking_key", trackingKeys.slice(index, index + 150))
      .is("closing_price", null);
    if (readError) throw new Error(`NFL player props observer closing-price read failed: ${readError.message}`);
    records.push(...((data ?? []) as typeof records));
  }
  let updated = 0;
  for (const record of records) {
    const quote = quoteByIdentity.get([
      record.tracking_key,
      record.decision_release,
      normalize(record.sportsbook),
    ].join("|"));
    if (!quote || record.closing_price !== null) continue;
    const closingImplied = implied(quote.closingPrice);
    const clv = 100 * (closingImplied - implied(record.locked_price));
    const { error } = await args.client.from("nfl_player_prop_records").update({
      closing_price: quote.closingPrice,
      closing_implied_probability: closingImplied,
      clv_probability_points: clv,
      updated_at: new Date().toISOString(),
    }).eq("id", record.id).is("closing_price", null);
    if (error) throw new Error(`NFL player props observer closing-price update failed: ${error.message}`);
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
