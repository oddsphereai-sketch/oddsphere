import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  flagOpenersInHistoryPayload,
  readExistingLineHistoryIdentityKeys,
  type HistoryRowLike,
} from "../lib/services/_lineHistoryOpenerHelper";

type StoredHistory = HistoryRowLike & { id: number };
type DbError = { message: string };

class FakeQuery {
  private filters = new Map<string, Set<unknown>>();
  constructor(private readonly db: FakeHistoryDb) {}
  in(column: string, values: unknown[]): this {
    this.filters.set(column, new Set(values));
    return this;
  }
  order(): this { return this; }
  async range(from: number, to: number): Promise<{
    data: StoredHistory[] | null;
    error: DbError | null;
    count: number | null;
  }> {
    this.db.queries += 1;
    if (this.db.failRead) return { data: null, error: { message: "history unavailable" }, count: null };
    const matches = this.db.rows
      .filter((row) => {
        for (const [column, values] of this.filters) {
          if (!values.has(row[column as keyof StoredHistory])) return false;
        }
        return true;
      })
      .sort((a, b) => a.id - b.id);
    const count = this.db.noCount
      ? null
      : this.db.countsByQuery[this.db.queries - 1] ?? matches.length;
    let page = matches.slice(from, to + 1);
    if (this.db.truncatePage && page.length > 0) page = page.slice(0, -1);
    if (this.db.duplicateId && page.length > 1) page[1] = { ...page[1]!, id: page[0]!.id };
    return { data: structuredClone(page), error: null, count };
  }
}

class FakeTable {
  constructor(private readonly db: FakeHistoryDb) {}
  select(): FakeQuery { return new FakeQuery(this.db); }
}

class FakeHistoryDb {
  queries = 0;
  failRead = false;
  noCount = false;
  truncatePage = false;
  duplicateId = false;
  countsByQuery: number[] = [];
  constructor(readonly rows: StoredHistory[]) {}
  from(table: string): FakeTable {
    assert.equal(table, "line_history");
    return new FakeTable(this);
  }
  asClient(): SupabaseClient { return this as unknown as SupabaseClient; }
}

function history(id: number, overrides: Partial<StoredHistory> = {}): StoredHistory {
  return {
    id,
    game_id: 1,
    market_type: "moneyline",
    side: "home",
    sportsbook: "book_a",
    player_id: null,
    is_opener: false,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // More than PostgREST's default 1,000 rows must be read completely, while
  // cross-product and player identities remain exact.
  {
    const rows = Array.from({ length: 1_205 }, (_, index) => history(index + 1, {
      game_id: index % 2 === 0 ? 1 : 2,
      market_type: index % 3 === 0 ? "moneyline" : "total",
      side: index % 2 === 0 ? "home" : "away",
      sportsbook: `book_${index % 5}`,
    }));
    rows.push(history(1_206, { game_id: 1, market_type: "total", side: "over", sportsbook: "book_x" }));
    rows.push(history(1_207, { game_id: 1, market_type: "moneyline", side: "over", sportsbook: "book_x", player_id: 77 }));
    const wanted: HistoryRowLike[] = [
      history(0, { sportsbook: "book_0" }),
      history(0, { game_id: 1, market_type: "total", side: "under", sportsbook: "book_x" }),
      history(0, { game_id: 2, market_type: "moneyline", side: "away", sportsbook: "book_1" }),
      history(0, { game_id: 1, market_type: "moneyline", side: "over", sportsbook: "book_x", player_id: 77 }),
    ];
    const db = new FakeHistoryDb(rows);
    const result = await readExistingLineHistoryIdentityKeys(db.asClient(), wanted);
    assert.equal(result.error, null);
    assert.equal(result.rowsRead, 1_207);
    assert.equal(result.queries, 2);
    assert.equal(result.existingKeys.has("1|moneyline|home|book_0|null"), true);
    assert.equal(result.existingKeys.has("1|total|under|book_x|null"), false, "cross-product row cannot satisfy an unseen side");
    assert.equal(result.existingKeys.has("1|moneyline|over|book_x|77"), true, "player identity remains exact");
  }

  // Existing identities remain non-openers; only the first row for each
  // truly unseen exact identity is stamped.
  {
    const db = new FakeHistoryDb([history(1)]);
    const payload = [
      history(0),
      history(0, { sportsbook: "new_book" }),
      history(0, { sportsbook: "new_book" }),
      history(0, { sportsbook: "new_book", player_id: 42 }),
    ];
    const flagged = await flagOpenersInHistoryPayload(payload, { client: db.asClient() });
    assert.deepEqual(flagged.map((row) => row.is_opener), [false, true, false, true]);
  }

  // Every unverifiable read is identity-safe: no row is guessed to be an
  // opener, and no database mutation exists in this helper.
  for (const mode of ["error", "no_count", "truncated", "count_drift", "duplicate", "cap"] as const) {
    const db = new FakeHistoryDb([history(1), history(2, { sportsbook: "book_b" })]);
    const options: { client: SupabaseClient; pageSize?: number; maxRows?: number } = { client: db.asClient() };
    if (mode === "error") db.failRead = true;
    if (mode === "no_count") db.noCount = true;
    if (mode === "truncated") db.truncatePage = true;
    if (mode === "count_drift") { db.countsByQuery = [2, 3]; options.pageSize = 1; }
    if (mode === "duplicate") db.duplicateId = true;
    if (mode === "cap") options.maxRows = 1;
    const payload = [history(0, { sportsbook: "never_seen" })];
    const flagged = await flagOpenersInHistoryPayload(payload, options);
    assert.deepEqual(flagged.map((row) => row.is_opener), [false], `${mode} must not invent an opener`);
  }

  console.log("PASS line-history opener integrity: complete bounded reads, exact identities, and fail-safe no-stamp behavior");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
