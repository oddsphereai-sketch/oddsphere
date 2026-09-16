import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  americanOddsInRange,
  americanOddsRangeIsOrdered,
  isValidAmericanOddsInput,
  parseAmericanOddsInput,
} from "../app/lab/lib/footballOddsFilter";

assert.equal(isValidAmericanOddsInput(""), true);
assert.equal(isValidAmericanOddsInput("+125"), true);
assert.equal(isValidAmericanOddsInput("-200"), true);
assert.equal(isValidAmericanOddsInput("-99"), false);
assert.equal(parseAmericanOddsInput(" +125 "), 125);
assert.equal(parseAmericanOddsInput(""), null);
assert.equal(americanOddsRangeIsOrdered({ min: -200, max: 200 }), true);
assert.equal(americanOddsRangeIsOrdered({ min: 200, max: -200 }), false);

const currentPrices = [-250, -200, -110, 100, 150, 205];
assert.deepEqual(
  currentPrices.filter((price) => americanOddsInRange(price, { min: -200, max: 200 })),
  [-200, -110, 100, 150],
);
assert.deepEqual(
  currentPrices.filter((price) => americanOddsInRange(price, { min: 100, max: null })),
  [100, 150, 205],
);

const dashboardSource = readFileSync(
  "app/player-props/components/NflPlayerPropsProductDashboard.tsx",
  "utf8",
);
assert.match(dashboardSource, /americanOddsInRange\(row\.americanPrice, oddsRange\)/);
assert.match(dashboardSource, /Player prop odds range presets/);
assert.match(dashboardSource, /Common range/);
assert.match(dashboardSource, /Plus money/);
assert.match(dashboardSource, /setOddsMinInput\(""\)/);
assert.match(dashboardSource, /setOddsMaxInput\(""\)/);
assert.match(dashboardSource, /Filter the displayed prop prices/);

console.log("NFL Player Props odds filter tests passed");
