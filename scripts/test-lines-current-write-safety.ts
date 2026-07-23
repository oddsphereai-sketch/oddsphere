import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  partitionValidGameLineGroups,
  validateGameLineDatabaseRow,
} from "../lib/services/linesService";

const valid = {
  game_id: 1,
  market_type: "moneyline",
  player_id: null,
  sportsbook: "test_book",
  side: "home",
  line_value: null,
  odds_american: -110,
  odds_decimal: 1.909,
  implied_probability: 0.5238,
  ev_percent: 1.25,
  fair_odds: -108,
};

assert.equal(validateGameLineDatabaseRow(valid).valid, true);
assert.equal(
  validateGameLineDatabaseRow({ ...valid, odds_decimal: 1_000 }).reason,
  "odds_decimal_out_of_range",
);
assert.equal(
  validateGameLineDatabaseRow({ ...valid, ev_percent: 1_000 }).reason,
  "ev_percent_out_of_range",
);
assert.equal(
  validateGameLineDatabaseRow({ ...valid, implied_probability: 1.01 }).reason,
  "implied_probability_out_of_range",
);
const grouped = partitionValidGameLineGroups([
  valid,
  { ...valid, side: "away", odds_decimal: 1_000 },
  { ...valid, sportsbook: "healthy_book", side: "home" },
]);
assert.equal(grouped.accepted.length, 1);
assert.equal(grouped.accepted[0].sportsbook, "healthy_book");
assert.equal(grouped.rejected.length, 2);

const source = readFileSync(resolve(process.cwd(), "lib/services/linesService.ts"), "utf8");
const safeWriterStart = source.indexOf("async function replaceCurrentGameLinesSafely");
const safeWriterEnd = source.indexOf("type BaselineHistoryResult", safeWriterStart);
const safeWriter = source.slice(safeWriterStart, safeWriterEnd);
const insertIndex = safeWriter.indexOf('.from("lines").insert(group)');
const deleteIndex = safeWriter.indexOf('.from("lines").delete().in("id", priorIds)');
assert.ok(safeWriterStart >= 0 && insertIndex >= 0 && deleteIndex > insertIndex);
assert.ok(!source.includes("await deletePerSportsbook("));

console.log("PASS current-line write safety: invalid book groups quarantined; new group inserts before prior IDs are deleted");
