import assert from "node:assert/strict";
import {
  collectBoundedCurrentGameLineRows,
  type CurrentGameLineRow,
} from "../lib/services/currentGameLineReader";

function fixture(count: number): CurrentGameLineRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    game_id: Math.floor(index / 90) + 1,
    market_type: index % 3 === 0 ? "moneyline" : index % 3 === 1 ? "total" : "first_inning_total",
    sportsbook: `book-${index % 12}`,
    side: index % 2 === 0 ? "home" : "away",
    line_value: null,
    odds_american: -110,
    fetched_at: "2026-09-08T12:00:00.000Z",
  }));
}

async function main(): Promise<void> {
  const source = fixture(1_329);
  const requests: Array<[number, number]> = [];
  const collected = await collectBoundedCurrentGameLineRows(async (from, to) => {
    requests.push([from, to]);
    return source.slice(from, to + 1);
  });
  assert.deepEqual(requests, [[0, 499], [500, 999], [1000, 1499]]);
  assert.equal(collected.length, 1_329);
  assert.deepEqual(collected.map((row) => row.id), source.map((row) => row.id));

  await assert.rejects(
    () => collectBoundedCurrentGameLineRows(
      async (from, to) => fixture(1_000).slice(from, to + 1),
      { pageSize: 500, maxRows: 1_000, context: "saturated test" },
    ),
    /saturated test: reached bounded 1000-row cap; refusing a partial price board/,
  );

  await assert.rejects(
    () => collectBoundedCurrentGameLineRows(async () => [], { pageSize: 0, maxRows: 1_000 }),
    /page size must be a positive integer/,
  );

  console.log("Current game-line pagination tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
