import assert from "node:assert/strict";
import { __TEST__ } from "../lib/automodel/featureSnapshot";

async function main(): Promise<void> {
const rows = Array.from({ length: 1_329 }, (_, index) => ({
  id: index + 1,
  game_id: 5_059_897 + Math.floor(index / 89),
  market_type: index % 2 === 0 ? "moneyline" : "total",
  sportsbook: "test_book",
  side: index % 2 === 0 ? "home" : "over",
  line_value: index % 2 === 0 ? null : 8.5,
  odds_american: -110,
  fetched_at: "2026-09-05T15:00:00.000Z",
}));

const calls: Array<[number, number]> = [];
const collected = await __TEST__.collectBoundedLineRows(async (from, to) => {
  calls.push([from, to]);
  return rows.slice(from, to + 1);
});

assert.equal(collected.length, 1_329, "all line rows survive the 1,000-row boundary");
assert.deepEqual(calls, [[0, 499], [500, 999], [1_000, 1_499]], "reader uses deterministic 500-row pages");
assert.equal(new Set(collected.map((row) => row.game_id)).size, 15, "all 15 slate games retain line history");
assert.equal(collected.at(-1)?.id, 1_329, "the final game's rows are retained");

await assert.rejects(
  () => __TEST__.collectBoundedLineRows(
    async (from, to) => rows.slice(0, to - from + 1),
    500,
    1_000,
  ),
  /reached bounded 1000-row cap/,
  "the reader fails closed instead of publishing a silently partial snapshot",
);

await assert.rejects(
  () => __TEST__.collectBoundedLineRows(async () => [], 0, 1_000),
  /page size must be a positive integer/,
);

console.log("MLB feature-line pagination tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
