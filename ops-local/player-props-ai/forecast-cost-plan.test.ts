import assert from "node:assert/strict";
import { forecastCostPlan, type CostSlot } from "./forecast-cost-plan";
const slots = Array.from({ length: 600 }, (_, i) => (["early", "final"] as const).map(stage => ({ key: `${i}|${stage}`, stage, standardMicro: 45_000 }))).flat();
const before = JSON.stringify(slots), result = forecastCostPlan(slots);
assert.equal(result.logicalReviews, 1200);
assert.equal(result.primaryMicro, 40_500_000);
assert.equal(result.fallbackMicro, 2_700_000);
assert.equal(result.coreMicro, 46_200_000);
assert.equal(result.affordableStrongerFinals, 9);
assert.ok(result.adaptiveMicro <= 50_000_000);
assert.ok(result.fixedTenPercentMicro > 50_000_000);
assert.equal(JSON.stringify(slots), before);
assert.equal(forecastCostPlan(slots, { earlyFlex: false }).primaryFits, false);
const unfunded = forecastCostPlan(slots, { ceilingMicro: 45_000_000 });
assert.equal(unfunded.primaryFits, false); assert.equal(unfunded.affordableStrongerFinals, 0); assert.equal(unfunded.logicalReviews, 1200);
const small = forecastCostPlan(slots.slice(0, 18)); assert.equal(small.maximumStrongerFinals, 0);
const boundary: CostSlot[] = [{ key: "boundary|final", stage: "final", standardMicro: 45_000 }];
assert.equal(forecastCostPlan(boundary).primaryMicro, 45_000); // No invented early review in this UTC month.
assert.throws(() => forecastCostPlan([slots[0], slots[0]]), /duplicate/);
assert.throws(() => forecastCostPlan(slots, { fallbackFraction: NaN }), /policy/);
assert.equal(forecastCostPlan(slots, { fallbackFraction: 1 }).fallbackSlots, 600);
assert.equal(forecastCostPlan([{key:"parts",stage:"early",standardMicro:3,flexMicro:3}]).primaryMicro,3); // Per-request ceilings are quoted before summing.
console.log("Forecast cost envelopes: whole-month core priority, capped optional upgrades, fallback stress, UTC stage boundaries and unfunded-plan rejection passed. No API calls.");
