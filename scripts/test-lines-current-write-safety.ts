import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chunkCompleteLineGroups,
  groupCurrentGameLineRows,
  replaceCurrentGameLinesBatched,
} from "../lib/services/currentGameLinesBatchWriter";
import {
  readExistingLineHistoryBaselineKeys,
  partitionValidGameLineGroups,
  validateGameLineDatabaseRow,
} from "../lib/services/linesService";

type StoredLine = Record<string, unknown> & { id: number };
type DbError = { message: string };

class FakeSelectQuery {
  private inFilters = new Map<string, Set<unknown>>();
  private nullFilters = new Set<string>();
  constructor(private readonly db: FakeLinesDb) {}
  in(column: string, values: unknown[]): this {
    this.inFilters.set(column, new Set(values));
    return this;
  }
  is(column: string, value: null): this {
    if (value === null) this.nullFilters.add(column);
    return this;
  }
  order(): this { return this; }
  async range(from: number, to: number): Promise<{ data: StoredLine[] | null; error: DbError | null; count: number | null }> {
    this.db.selectQueries += 1;
    if (this.db.failSelect) return { data: null, error: { message: "select unavailable" }, count: null };
    let matches = this.db.rows.filter((row) => {
      for (const [column, values] of this.inFilters) if (!values.has(row[column])) return false;
      for (const column of this.nullFilters) if (row[column] !== null) return false;
      return true;
    }).sort((a, b) => a.id - b.id);
    const count = this.db.reportedCount ?? matches.length;
    matches = matches.slice(from, to + 1);
    if (this.db.truncateSelectPage && matches.length > 0) matches = matches.slice(0, -1);
    if (this.db.duplicateSelectIds && matches.length > 0) matches = [matches[0]!, ...matches];
    return { data: structuredClone(matches), error: null, count };
  }
}

class FakeDeleteQuery {
  constructor(private readonly db: FakeLinesDb) {}
  async in(column: string, values: Array<number | string>): Promise<{ error: DbError | null }> {
    assert.equal(column, "id");
    const ids = values.map(Number);
    this.db.deleteCalls.push(ids);
    if (ids.some((id) => this.db.failDeleteIds.has(id))) return { error: { message: "delete rejected" } };
    const idSet = new Set(ids);
    this.db.rows = this.db.rows.filter((row) => !idSet.has(row.id));
    return { error: null };
  }
}

class FakeLinesTable {
  constructor(private readonly db: FakeLinesDb) {}
  select(): FakeSelectQuery { return new FakeSelectQuery(this.db); }
  async insert(rows: ReadonlyArray<Record<string, unknown>>): Promise<{ error: DbError | null }> {
    const copy = structuredClone([...rows]);
    this.db.insertCalls.push(copy);
    if (copy.some((row) => this.db.failInsertBooks.has(String(row.sportsbook)))) return { error: { message: "insert rejected" } };
    for (const row of copy) this.db.rows.push({ ...row, id: this.db.nextId++ });
    return { error: null };
  }
  delete(): FakeDeleteQuery { return new FakeDeleteQuery(this.db); }
}

class FakeLinesDb {
  rows: StoredLine[];
  nextId: number;
  selectQueries = 0;
  insertCalls: Array<Array<Record<string, unknown>>> = [];
  deleteCalls: number[][] = [];
  failSelect = false;
  reportedCount: number | null = null;
  truncateSelectPage = false;
  duplicateSelectIds = false;
  failInsertBooks = new Set<string>();
  failDeleteIds = new Set<number>();
  constructor(rows: StoredLine[]) {
    this.rows = structuredClone(rows);
    this.nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  }
  from(table: string): FakeLinesTable {
    assert.equal(table, "lines");
    return new FakeLinesTable(this);
  }
  asClient(): SupabaseClient { return this as unknown as SupabaseClient; }
}

type StoredHistory = {
  id: number;
  game_id: number;
  market_type: string;
  player_id: number | null;
  is_opener: boolean;
};

class FakeHistorySelectQuery {
  private inFilters = new Map<string, Set<unknown>>();
  private nullFilters = new Set<string>();
  private equalFilters = new Map<string, unknown>();
  constructor(private readonly db: FakeHistoryDb) {}
  in(column: string, values: unknown[]): this {
    this.inFilters.set(column, new Set(values));
    return this;
  }
  is(column: string, value: null): this {
    if (value === null) this.nullFilters.add(column);
    return this;
  }
  eq(column: string, value: unknown): this {
    this.equalFilters.set(column, value);
    return this;
  }
  order(): this { return this; }
  async range(from: number, to: number): Promise<{ data: StoredHistory[] | null; error: DbError | null; count: number | null }> {
    this.db.queries += 1;
    if (this.db.failSelect) return { data: null, error: { message: "history unavailable" }, count: null };
    this.db.sawPlayerNull ||= this.nullFilters.has("player_id");
    this.db.sawExplicitOpener ||= this.equalFilters.get("is_opener") === true;
    const matches = this.db.rows.filter((row) => {
      for (const [column, values] of this.inFilters) if (!values.has(row[column as keyof StoredHistory])) return false;
      for (const column of this.nullFilters) if (row[column as keyof StoredHistory] !== null) return false;
      for (const [column, value] of this.equalFilters) if (row[column as keyof StoredHistory] !== value) return false;
      return true;
    }).sort((a, b) => a.id - b.id);
    const count = this.db.countsByQuery[this.db.queries - 1] ?? matches.length;
    let page = matches.slice(from, to + 1);
    if (this.db.truncatePage && page.length > 0) page = page.slice(0, -1);
    return { data: structuredClone(page), error: null, count };
  }
}

class FakeHistoryTable {
  constructor(private readonly db: FakeHistoryDb) {}
  select(): FakeHistorySelectQuery { return new FakeHistorySelectQuery(this.db); }
}

class FakeHistoryDb {
  queries = 0;
  failSelect = false;
  truncatePage = false;
  countsByQuery: number[] = [];
  sawPlayerNull = false;
  sawExplicitOpener = false;
  constructor(readonly rows: StoredHistory[]) {}
  from(table: string): FakeHistoryTable {
    assert.equal(table, "line_history");
    return new FakeHistoryTable(this);
  }
  asClient(): SupabaseClient { return this as unknown as SupabaseClient; }
}

function line(args: { id?: number; game: number; market: string; book: string; side: string; fetched: string; playerId?: number | null }): Record<string, unknown> {
  return {
    ...(args.id === undefined ? {} : { id: args.id }),
    game_id: args.game,
    market_type: args.market,
    player_id: args.playerId ?? null,
    sportsbook: args.book,
    side: args.side,
    line_value: args.market === "moneyline" ? null : 8.5,
    odds_american: -110,
    odds_decimal: 1.909,
    implied_probability: 0.5238,
    ev_percent: 1.25,
    fair_odds: -108,
    is_ev_positive: true,
    fetched_at: args.fetched,
  };
}

function semanticRows(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.id;
    return JSON.stringify(copy);
  }).sort();
}

function applyOldSequentialAlgorithm(initial: StoredLine[], incoming: ReadonlyArray<Record<string, unknown>>): StoredLine[] {
  const rows = structuredClone(initial);
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  for (const group of groupCurrentGameLineRows(incoming)) {
    const priorIds = rows.filter((row) =>
      row.player_id === null && row.game_id === group.gameId && row.market_type === group.marketType && row.sportsbook === group.sportsbook
    ).map((row) => row.id);
    for (const row of group.rows) rows.push({ ...structuredClone(row), id: nextId++ });
    const prior = new Set(priorIds);
    for (let index = rows.length - 1; index >= 0; index -= 1) if (prior.has(rows[index]!.id)) rows.splice(index, 1);
  }
  return rows;
}

async function main(): Promise<void> {
const valid = {
  game_id: 1, market_type: "moneyline", player_id: null, sportsbook: "test_book", side: "home",
  line_value: null, odds_american: -110, odds_decimal: 1.909, implied_probability: 0.5238,
  ev_percent: 1.25, fair_odds: -108,
};
assert.equal(validateGameLineDatabaseRow(valid).valid, true);
assert.equal(validateGameLineDatabaseRow({ ...valid, odds_decimal: 1_000 }).reason, "odds_decimal_out_of_range");
assert.equal(validateGameLineDatabaseRow({ ...valid, ev_percent: 1_000 }).reason, "ev_percent_out_of_range");
assert.equal(validateGameLineDatabaseRow({ ...valid, implied_probability: 1.01 }).reason, "implied_probability_out_of_range");
const grouped = partitionValidGameLineGroups([valid, { ...valid, side: "away", odds_decimal: 1_000 }, { ...valid, sportsbook: "healthy_book", side: "home" }]);
assert.equal(grouped.accepted.length, 1);
assert.equal(grouped.accepted[0]!.sportsbook, "healthy_book");
assert.equal(grouped.rejected.length, 2);

const chunks = chunkCompleteLineGroups([{ rows: [1, 2] }, { rows: [3, 4] }, { rows: [5, 6, 7, 8, 9] }], 4);
assert.deepEqual(chunks.map((chunk) => chunk.map((group) => group.rows.length)), [[2, 2], [5]]);

// Explicit opener reads paginate beyond PostgREST's default row limit, exclude
// props, and filter cross-product overfetch back to exact game/market pairs.
{
  const rows: StoredHistory[] = [];
  const identities: Array<{ gameId: number; marketType: string }> = [];
  let id = 1;
  for (let index = 0; index < 501; index += 1) {
    const gameId = index + 1;
    const marketType = index % 2 === 0 ? "moneyline" : "total";
    identities.push({ gameId, marketType });
    rows.push(
      { id: id++, game_id: gameId, market_type: marketType, player_id: null, is_opener: true },
      { id: id++, game_id: gameId, market_type: marketType, player_id: null, is_opener: true },
    );
  }
  identities.push({ gameId: 999, marketType: "total" });
  rows.push(
    { id: id++, game_id: 999, market_type: "total", player_id: null, is_opener: false },
    { id: id++, game_id: 1, market_type: "moneyline", player_id: 77, is_opener: true },
    { id: id++, game_id: 1, market_type: "total", player_id: null, is_opener: true },
  );
  const db = new FakeHistoryDb(rows);
  const result = await readExistingLineHistoryBaselineKeys(db.asClient(), identities);
  assert.equal(result.error, null);
  assert.equal(result.queries, 2);
  assert.equal(result.rowsRead, 1_003);
  assert.equal(result.existingKeys.size, 501);
  assert.equal(result.existingKeys.has("999::total"), false, "legacy non-opener remains truthfully missing");
  assert.equal(result.existingKeys.has("1::total"), false, "cross-product overfetch cannot satisfy a baseline");
  assert.equal(db.sawPlayerNull, true);
  assert.equal(db.sawExplicitOpener, true);
}

// Truncation, count drift, and caps fail closed before baseline insertion.
for (const mode of ["truncated", "count_changed", "cap"] as const) {
  const db = new FakeHistoryDb([
    { id: 1, game_id: 1, market_type: "moneyline", player_id: null, is_opener: true },
    { id: 2, game_id: 1, market_type: "moneyline", player_id: null, is_opener: true },
  ]);
  const options = mode === "count_changed" ? { pageSize: 1 } : mode === "cap" ? { maxRows: 1 } : {};
  if (mode === "truncated") db.truncatePage = true;
  if (mode === "count_changed") db.countsByQuery = [2, 3];
  const result = await readExistingLineHistoryBaselineKeys(
    db.asClient(),
    [{ gameId: 1, marketType: "moneyline" }],
    options,
  );
  assert.notEqual(result.error, null, `${mode} baseline read must fail closed`);
  assert.equal(result.existingKeys.size, 0);
}

// >1000 prior rows paginate; overfetch/props remain untouched; output equals the old writer.
{
  const initial: StoredLine[] = [];
  const incoming: Record<string, unknown>[] = [];
  let id = 1;
  for (let index = 0; index < 501; index += 1) {
    const game = index + 1;
    const market = index % 2 === 0 ? "moneyline" : "total";
    const book = `book_${index % 3}`;
    for (const side of market === "moneyline" ? ["home", "away"] : ["over", "under"]) {
      initial.push(line({ id: id++, game, market, book, side, fetched: "2026-09-02T12:00:00Z" }) as StoredLine);
      incoming.push(line({ game, market, book, side, fetched: "2026-09-02T14:00:00Z" }));
    }
  }
  const overfetchId = id++;
  initial.push(line({ id: overfetchId, game: 1, market: "moneyline", book: "book_2", side: "home", fetched: "2026-09-02T12:00:00Z" }) as StoredLine);
  const playerPropId = id++;
  initial.push(line({ id: playerPropId, game: 1, market: "moneyline", book: "book_0", side: "home", fetched: "2026-09-02T12:00:00Z", playerId: 77 }) as StoredLine);
  const db = new FakeLinesDb(initial);
  const result = await replaceCurrentGameLinesBatched(db.asClient(), incoming, "test", { maxPriorRows: 2_000 });
  assert.equal(result.priorReadQueries, 2);
  assert.equal(result.insertQueries, 6);
  assert.equal(result.deleteQueries, 3);
  assert.equal(result.priorRowsRead, 1_002);
  assert.equal(result.insertedRows, 1_002);
  assert.equal(result.failedGroups, 0);
  assert.ok(db.rows.some((row) => row.id === overfetchId));
  assert.ok(db.rows.some((row) => row.id === playerPropId));
  assert.deepEqual(semanticRows(db.rows), semanticRows(applyOldSequentialAlgorithm(initial, incoming)));
  const incomingByKey = new Map<string, number>();
  for (const row of incoming) {
    const key = `${row.game_id}::${row.market_type}::${row.sportsbook}`;
    incomingByKey.set(key, (incomingByKey.get(key) ?? 0) + 1);
  }
  const insertedByKey = new Map<string, Set<number>>();
  db.insertCalls.forEach((call, callIndex) => {
    for (const row of call) {
      const key = `${row.game_id}::${row.market_type}::${row.sportsbook}`;
      const calls = insertedByKey.get(key) ?? new Set<number>();
      calls.add(callIndex);
      insertedByKey.set(key, calls);
    }
  });
  for (const [key, expectedRows] of incomingByKey) {
    assert.equal(insertedByKey.get(key)?.size, 1, `group ${key} split across chunks`);
    const callIndex = [...(insertedByKey.get(key) ?? [])][0]!;
    assert.equal(db.insertCalls[callIndex]!.filter((row) => `${row.game_id}::${row.market_type}::${row.sportsbook}` === key).length, expectedRows);
  }
}

// Partial insert chunk failure isolates groups and preserves the bad group's LKG.
{
  const initial = [
    line({ id: 1, game: 1, market: "moneyline", book: "good", side: "home", fetched: "2026-09-02T12:00:00Z" }),
    line({ id: 2, game: 2, market: "moneyline", book: "bad", side: "home", fetched: "2026-09-02T12:00:00Z" }),
  ] as StoredLine[];
  const incoming = [
    line({ game: 1, market: "moneyline", book: "good", side: "home", fetched: "2026-09-02T14:00:00Z" }),
    line({ game: 2, market: "moneyline", book: "bad", side: "home", fetched: "2026-09-02T14:00:00Z" }),
  ];
  const db = new FakeLinesDb(initial);
  db.failInsertBooks.add("bad");
  const result = await replaceCurrentGameLinesBatched(db.asClient(), incoming, "test", { insertChunkRows: 10 });
  assert.equal(result.insertedGroups, 1);
  assert.equal(result.failedGroups, 1);
  assert.equal(result.failedRows, 1);
  assert.equal(result.insertFallbackQueries, 2);
  assert.ok(!db.rows.some((row) => row.id === 1));
  assert.ok(db.rows.some((row) => row.id === 2));
  assert.ok(db.rows.some((row) => row.game_id === 1 && row.fetched_at === "2026-09-02T14:00:00Z"));
}

// Delete failure keeps both generations, reports cleanup, and newest still wins.
{
  const initial = [
    line({ id: 1, game: 1, market: "total", book: "good", side: "over", fetched: "2026-09-02T12:00:00Z" }),
    line({ id: 2, game: 2, market: "total", book: "stuck", side: "over", fetched: "2026-09-02T12:00:00Z" }),
  ] as StoredLine[];
  const incoming = [
    line({ game: 1, market: "total", book: "good", side: "over", fetched: "2026-09-02T14:00:00Z" }),
    line({ game: 2, market: "total", book: "stuck", side: "over", fetched: "2026-09-02T14:00:00Z" }),
  ];
  const db = new FakeLinesDb(initial);
  db.failDeleteIds.add(2);
  const result = await replaceCurrentGameLinesBatched(db.asClient(), incoming, "test", { deleteChunkIds: 10 });
  assert.equal(result.insertedRows, 2);
  assert.equal(result.cleanupFailedGroups, 1);
  assert.equal(result.failedRows, 0);
  assert.ok(!db.rows.some((row) => row.id === 1));
  assert.ok(db.rows.some((row) => row.id === 2));
  const stuckRows = db.rows.filter((row) => row.game_id === 2);
  assert.equal(stuckRows.length, 2);
  assert.equal(stuckRows.sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at)))[0]!.fetched_at, "2026-09-02T14:00:00Z");
}

// Prior-read errors, pagination truncation, and both caps perform zero mutation.
for (const mode of ["read_error", "truncated_page", "prior_overflow", "input_overflow"] as const) {
  const initial = [line({ id: 1, game: 1, market: "moneyline", book: "book", side: "home", fetched: "2026-09-02T12:00:00Z" })] as StoredLine[];
  const incoming = [line({ game: 1, market: "moneyline", book: "book", side: "home", fetched: "2026-09-02T14:00:00Z" })];
  if (mode === "input_overflow") {
    incoming.push(line({ game: 1, market: "moneyline", book: "book", side: "away", fetched: "2026-09-02T14:00:00Z" }));
  }
  const db = new FakeLinesDb(initial);
  if (mode === "read_error") db.failSelect = true;
  else if (mode === "truncated_page") db.truncateSelectPage = true;
  else if (mode === "prior_overflow") db.reportedCount = 11;
  const before = structuredClone(db.rows);
  const result = await replaceCurrentGameLinesBatched(
    db.asClient(),
    incoming,
    "test",
    mode === "input_overflow" ? { maxIncomingRows: 1, maxIncomingGroups: 1 } : { maxPriorRows: 10 },
  );
  assert.equal(result.failedGroups, 1);
  assert.deepEqual(db.rows, before);
  assert.equal(db.insertCalls.length, 0);
  assert.equal(db.deleteCalls.length, 0);
}

// Duplicate prior IDs are deduplicated before cleanup.
{
  const initial = [line({ id: 1, game: 1, market: "moneyline", book: "book", side: "home", fetched: "2026-09-02T12:00:00Z" })] as StoredLine[];
  const db = new FakeLinesDb(initial);
  db.duplicateSelectIds = true;
  db.reportedCount = 2;
  const result = await replaceCurrentGameLinesBatched(db.asClient(), [line({ game: 1, market: "moneyline", book: "book", side: "home", fetched: "2026-09-02T14:00:00Z" })], "test");
  assert.equal(result.priorRowsRead, 1);
  assert.deepEqual(db.deleteCalls, [[1]]);
}

console.log("PASS current-line batching and opener baselines: bounded pagination, exact-key filtering, failure isolation, and old-output equality");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
