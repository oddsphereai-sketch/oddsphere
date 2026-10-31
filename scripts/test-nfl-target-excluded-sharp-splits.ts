import assert from "node:assert/strict";

import { targetFreeSharpSplits } from "../lib/services/football/nflTargetExcludedMarketOutcome";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "../lib/services/football/sharpApiNflSplits";

const row = (provider: "owls" | "sharpapi", sourceSportsbook: string): NflRegularSharpSplit => ({
  provider, providerGameId: "game-1", sourceEventId: "event-1", sourceSportsbook,
  capturedAt: "2026-10-31T20:00:00.000Z", providerFetchedAt: "2026-10-31T19:59:00.000Z",
  homeMoneyPct: 70, awayMoneyPct: 30, homeBetsPct: 40, awayBetsPct: 60,
  overMoneyPct: 65, underMoneyPct: 35, overBetsPct: 45, underBetsPct: 55,
});

for (const provider of ["owls", "sharpapi"] as const) {
  const splits: NflRegularSharpSplitSet = {
    moneyline: row(provider, "circa"), spread: row(provider, "circa"),
    total: row(provider, "pinnacle"),
  };
  const targetFree = targetFreeSharpSplits(splits, {
    byMarket: { moneyline: "circa", spread: "circa", total: "other" },
    margin: ["circa"], total: ["other"],
  });
  assert.ok(targetFree);
  assert.equal(targetFree.moneyline.sourceSportsbook, "circa");
  assert.equal(targetFree.moneyline.homeMoneyPct, null,
    "an evaluated-book split must lose its value, not merely its book name");
  assert.equal(targetFree.spread.homeBetsPct, null);
  assert.equal(targetFree.total.overMoneyPct, 65,
    "a distinct non-evaluated book remains usable on its own market");
  assert.equal(splits.moneyline.homeMoneyPct, 70, "the original observation remains immutable");
  const excludedTotal = targetFreeSharpSplits(splits, {
    byMarket: { moneyline: "other", spread: "other", total: "pinnacle" },
    margin: ["other"], total: ["pinnacle"],
  });
  assert.equal(excludedTotal?.total.overMoneyPct, null,
    "the Total reader cannot consume self-evaluated money/ticket percentages");
  assert.equal(excludedTotal?.moneyline.homeMoneyPct, 70);
}

console.log("NFL target-excluded split-value isolation tests passed");
