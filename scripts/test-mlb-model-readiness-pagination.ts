import assert from "node:assert/strict";
import { loadAllReadinessLineMarketRows } from "../lib/services/modelReadinessService";

type Row = { id: number; game_id: number; market_type: string };

const sourceRows: Row[] = Array.from({ length: 1_217 }, (_, index) => ({
  id: index + 1,
  game_id: 50_343 + (index % 15),
  market_type: index % 3 === 0 ? "moneyline" : index % 3 === 1 ? "total" : "first_inning_total",
}));
const pageCalls: Array<{ gameIds: number[]; from: number; to: number }> = [];

const client = {
  from(table: "lines") {
    assert.equal(table, "lines");
    return {
      select(columns: string) {
        assert.equal(columns, "id,game_id,market_type");
        return {
          in(column: "game_id", gameIds: number[]) {
            assert.equal(column, "game_id");
            return {
              order(orderColumn: "id", options: { ascending: true }) {
                assert.equal(orderColumn, "id");
                assert.deepEqual(options, { ascending: true });
                return {
                  async range(from: number, to: number) {
                    pageCalls.push({ gameIds, from, to });
                    const eligible = sourceRows
                      .filter((row) => gameIds.includes(row.game_id))
                      .sort((a, b) => a.id - b.id);
                    return { data: eligible.slice(from, to + 1), error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  },
};

async function main() {
  const rows = await loadAllReadinessLineMarketRows({
    client,
    gameIds: Array.from({ length: 15 }, (_, index) => 50_343 + index),
  });

  assert.equal(rows.length, 1_217, "readiness must not truncate a full slate at 1,000 line rows");
  assert.equal(new Set(rows.map((row) => row.id)).size, 1_217, "pagination must not duplicate line rows");
  assert.deepEqual(
    pageCalls.map(({ from, to }) => ({ from, to })),
    [{ from: 0, to: 999 }, { from: 1_000, to: 1_999 }],
    "the 1,217-row slate should require exactly two stable pages",
  );

  console.log("MLB model readiness line pagination test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
