import assert from "node:assert/strict";
import {
  observeWnbaPublicMarketContext,
  WNBA_PUBLIC_MARKET_CONTEXT_VERSION,
} from "../lib/services/wnba/wnbaPublicMarketContext";

const moneySupport = observeWnbaPublicMarketContext({
  grade: "Watchlist",
  picked: { public_betting_pct: 50, public_money_pct: 65 },
  opposite: { public_betting_pct: 50, public_money_pct: 35 },
});
assert.equal(moneySupport.contractVersion, WNBA_PUBLIC_MARKET_CONTEXT_VERSION);
assert.equal(moneySupport.productionDecisionEffect, false);
assert.equal(moneySupport.observedSupport, "money_support");
assert.equal(moneySupport.support, "none");
assert.equal(moneySupport.gradeAfter, "Watchlist");

const publicSmoke = observeWnbaPublicMarketContext({
  grade: "Best Angle",
  picked: { public_betting_pct: 74, public_money_pct: 70 },
  opposite: { public_betting_pct: 26, public_money_pct: 30 },
});
assert.equal(publicSmoke.observedConflict, "public_smoke");
assert.equal(publicSmoke.conflict, "none");
assert.equal(publicSmoke.gradeAfter, "Best Angle");

const missing = observeWnbaPublicMarketContext({
  grade: "Lean",
  picked: null,
  opposite: null,
});
assert.equal(missing.qualification, "no_complete_split_pair");
assert.equal(missing.reason, null);
assert.equal(missing.gradeAfter, "Lean");

console.log("WNBA provenance-qualified public market context tests: PASS");
