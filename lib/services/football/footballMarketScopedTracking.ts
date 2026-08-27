export const FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE =
  "football_market_scoped_t60_tracking_2026_08_26_r1" as const;

export const FOOTBALL_TRACKED_MARKETS = ["moneyline", "spread", "total"] as const;

export type FootballTrackedMarket = (typeof FOOTBALL_TRACKED_MARKETS)[number];

export type FootballTrackingGameDecisions = {
  externalId: number;
  decisions: ReadonlyArray<{ market: string }>;
};

export type FootballTrackingExistingRow = { external_id: number; market: string };

/**
 * One missing market cannot invalidate coherent sibling decisions, but every
 * market that does cross the official boundary must still be unique and one
 * of the three explicitly launched football markets.
 */
export function assertMarketScopedFootballDecisions(
  decisions: ReadonlyArray<{ market: string }>,
  label: string,
): asserts decisions is ReadonlyArray<{ market: FootballTrackedMarket }> {
  if (decisions.length === 0 || decisions.length > FOOTBALL_TRACKED_MARKETS.length) {
    throw new Error(`${label} requires one to three exact-price market decisions.`);
  }
  const allowed = new Set<string>(FOOTBALL_TRACKED_MARKETS);
  const markets = decisions.map((decision) => decision.market);
  if (markets.some((market) => !allowed.has(market))) {
    throw new Error(`${label} contains an unsupported football market.`);
  }
  if (new Set(markets).size !== markets.length) {
    throw new Error(`${label} contains duplicate football markets.`);
  }
}

/**
 * Computes idempotency against only the desired market keys. A previously
 * stored Held sibling from another capture/release shape cannot inflate the
 * current batch's existing count or suppress a missing desired insert.
 */
export function buildMarketScopedFootballTrackingPlan(
  games: ReadonlyArray<FootballTrackingGameDecisions>,
  existingRows: ReadonlyArray<FootballTrackingExistingRow> = [],
): { proposed: number; desiredKeys: Set<string>; existingKeys: Set<string> } {
  const desiredKeys = new Set<string>();
  for (const game of games) {
    assertMarketScopedFootballDecisions(game.decisions, `Football tracking for ${game.externalId}`);
    for (const decision of game.decisions) {
      const key = `${game.externalId}:${decision.market}`;
      if (desiredKeys.has(key)) throw new Error(`Football tracking contains a duplicate desired key ${key}.`);
      desiredKeys.add(key);
    }
  }
  const existingKeys = new Set(existingRows
    .map((row) => `${row.external_id}:${row.market}`)
    .filter((key) => desiredKeys.has(key)));
  return { proposed: desiredKeys.size, desiredKeys, existingKeys };
}
