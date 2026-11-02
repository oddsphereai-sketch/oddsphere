import assert from "node:assert/strict";
import { didNbaReaderFlip } from "../lib/services/nba/nbaReaderDecisionAudit";

const current = {
  independentPicks: { moneyline: "home", spread: "home", total: "under" },
  finalPicks: { moneyline: "home", spread: "away", total: "over" },
  effects: {
    moneyline: "context_only",
    spread: "flipped_by_causal_market_episode",
    total: "flipped_by_causal_market_episode",
  },
};
assert.equal(didNbaReaderFlip(current, "moneyline"), false);
assert.equal(didNbaReaderFlip(current, "spread"), true);
assert.equal(didNbaReaderFlip(current, "total"), true);
assert.equal(didNbaReaderFlip({ effects: { spread: "flipped_by_validated_spread_read" } }, "spread"), true);
assert.equal(didNbaReaderFlip({ effects: { total: "confirmed_by_validated_total_read" } }, "total"), false);
assert.equal(didNbaReaderFlip(null, "moneyline"), false);

console.log("NBA reader decision audit counts actual before/after flips and both current and legacy receipts.");
