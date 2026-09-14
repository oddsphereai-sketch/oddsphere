import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  americanOddsInRange,
  americanOddsRangeIsOrdered,
  isValidAmericanOddsInput,
  parseAmericanOddsInput,
} from "../app/lab/lib/footballOddsFilter";

assert.equal(isValidAmericanOddsInput(""), true);
assert.equal(isValidAmericanOddsInput(" +125 "), true);
assert.equal(isValidAmericanOddsInput("-200"), true);
assert.equal(isValidAmericanOddsInput("-99"), false);
assert.equal(isValidAmericanOddsInput("evens"), false);
assert.equal(parseAmericanOddsInput("+125"), 125);
assert.equal(parseAmericanOddsInput(""), null);
assert.equal(parseAmericanOddsInput("-99"), null);

assert.equal(americanOddsRangeIsOrdered({ min: -200, max: 200 }), true);
assert.equal(americanOddsRangeIsOrdered({ min: 200, max: -200 }), false);
assert.equal(americanOddsInRange(-200, { min: -200, max: 200 }), true);
assert.equal(americanOddsInRange(200, { min: -200, max: 200 }), true);
assert.equal(americanOddsInRange(-205, { min: -200, max: 200 }), false);
assert.equal(americanOddsInRange(250, { min: -200, max: 200 }), false);
assert.equal(americanOddsInRange(100, { min: 100, max: null }), true);
assert.equal(americanOddsInRange(-110, { min: 100, max: null }), false);
assert.equal(americanOddsInRange(null, { min: -200, max: 200 }), false);
assert.equal(americanOddsInRange(null, { min: null, max: null }), true);

const readerSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);
assert.match(readerSource, /Filters current displayed prices only/);
assert.match(readerSource, /Common range/);
assert.match(readerSource, /Plus money/);
assert.match(readerSource, /americanOddsInRange\(currentDisplayedPrice/);
assert.match(readerSource, /Current price/);

console.log("football Daily Edge odds filter tests passed");
