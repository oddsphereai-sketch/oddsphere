/**
 * Phase 4.2.A — Unit tests for AutoMlbScoresModelSource and the factory
 * wiring that routes USE_AUTO_SCORES_MODEL_MLB=true to it.
 *
 * Pure unit tests — uses a hand-built fake SupabaseClient so no real DB
 * I/O happens. The auto-model runner is stubbed via the runnerOverride
 * constructor injection point so no automodelService work runs either.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-auto-scores-model-source.ts
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AutoMlbScoresModelSource,
  type AutoModelRunner,
} from "../lib/scoresModel/auto/AutoMlbScoresModelSource";
import {
  getScoresModelSource,
  __resetScoresModelSourceCache,
} from "../lib/scoresModel/factory";
import { ManualScoresModelSource } from "../lib/scoresModel/manual/ManualScoresModelSource";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ──────────────────────────────────────────────────────────────────────
// Fake Supabase client — recorded canned responses per (table, op-path).
// Just enough surface to satisfy the adapter's calls. The adapter
// uses .from(t).select(...).eq(...).eq(...).eq(...).maybeSingle()
// for hasCompletedRun + getLastUpdated, and .from(t).select(...).eq(...)
// .eq(...).eq(...) for readExistingRows.
// ──────────────────────────────────────────────────────────────────────

type QueryRecord = {
  table: string;
  type: "maybeSingle" | "list";
  filters: Array<{ field: string; value: unknown }>;
};

type CannedResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type CannedResponse =
  | CannedResult
  | ((rec: QueryRecord) => CannedResult);

class FakeQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  constructor(
    private readonly table: string,
    private readonly recorder: (r: QueryRecord) => void,
    private readonly responder: (r: QueryRecord) => CannedResult
  ) {}
  select(_: string) {
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }
  async maybeSingle() {
    const rec: QueryRecord = { table: this.table, type: "maybeSingle", filters: this.filters };
    this.recorder(rec);
    return this.responder(rec);
  }
  // For list reads (readExistingRows), the adapter awaits the chain directly.
  then<R1 = unknown, R2 = never>(
    resolve?: (value: CannedResult) => R1 | PromiseLike<R1>,
    reject?: (reason: unknown) => R2 | PromiseLike<R2>
  ) {
    const rec: QueryRecord = { table: this.table, type: "list", filters: this.filters };
    this.recorder(rec);
    const result = this.responder(rec);
    return Promise.resolve(result).then(resolve, reject);
  }
}

function createFakeClient(opts: {
  responses: Record<string, CannedResponse>;
  onQuery?: (rec: QueryRecord) => void;
}): SupabaseClient {
  const queries: QueryRecord[] = [];
  const responder = (rec: QueryRecord): CannedResult => {
    const key = `${rec.table}:${rec.type}`;
    const r = opts.responses[key] ?? opts.responses[rec.table];
    if (r === undefined) {
      return { data: null, error: { message: `no canned response for ${key}` } };
    }
    return typeof r === "function" ? r(rec) : r;
  };
  const recorder = (rec: QueryRecord) => {
    queries.push(rec);
    opts.onQuery?.(rec);
  };
  const client = {
    from(table: string) {
      return new FakeQuery(table, recorder, responder);
    },
    // expose recorded queries for assertions
    __queries: queries,
  } as unknown as SupabaseClient;
  return client;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers — common canned shapes
// ──────────────────────────────────────────────────────────────────────

function completedRunRow(): CannedResult {
  return {
    data: { successful_count: 12, completed_at: "2026-06-03T13:05:23.000Z" },
    error: null,
  };
}

function noRunRow(): CannedResult {
  return { data: null, error: null };
}

function failedRunRow(): CannedResult {
  return {
    data: { successful_count: 0, completed_at: null },
    error: null,
  };
}

function joinRows(count: number): CannedResult {
  const data = Array.from({ length: count }, (_, i) => ({
    predicted_home_score: 4.5 + i * 0.1,
    predicted_away_score: 3.8,
    predicted_total: 8.3,
    predicted_ml_winner: "home",
    ml_confidence: 60,
    predicted_ou_side: "under",
    ou_confidence: 55,
    predicted_nrfi: true,
    nrfi_confidence: 62,
    sport_specific: { auto_factors: { nrfi_expected_runs: 0.78 } },
    prediction_source: "auto_v1_mlb_rules",
    is_override: false,
    original_auto_prediction: null,
    model_version: "auto_v1",
    computed_at: "2026-06-03T13:05:24.000Z",
    games: {
      external_id: 700000 + i,
      sport: "mlb",
      game_date: "2026-06-03T23:05:00.000Z",
      slate_date: "2026-06-03",
    },
  }));
  return { data, error: null };
}

function emptyRows(): CannedResult {
  return { data: [], error: null };
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

async function testExistingRunPath() {
  section("getPredictionsForDate — completed prior run exists");

  let runnerCallCount = 0;
  const runner: AutoModelRunner = async () => {
    runnerCallCount++;
  };

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": completedRunRow(),
      "game_predictions:list": joinRows(12),
    },
  });
  const source = new AutoMlbScoresModelSource(client, runner);
  const rows = await source.getPredictionsForDate("2026-06-03");

  check(
    "returns 12 predictions matching the canned existing rows",
    rows.length === 12,
    `got ${rows.length}`
  );
  check(
    "runner NOT invoked when completed run exists (idempotent)",
    runnerCallCount === 0,
    `runner called ${runnerCallCount} times`
  );
  check(
    "first row carries auto_v1_mlb_rules prediction_source",
    rows[0]?.prediction_source === "auto_v1_mlb_rules"
  );
  check(
    "first row carries the game_external_id from the JOIN",
    rows[0]?.game_external_id === 700000
  );
  check(
    "first row's sport_specific includes auto_factors (round-trip integrity)",
    rows[0]?.sport_specific !== null &&
      typeof rows[0]?.sport_specific === "object" &&
      "auto_factors" in (rows[0]!.sport_specific as Record<string, unknown>)
  );
}

async function testGenerateOnEmptyPath() {
  section("getPredictionsForDate — no prior run, generates then reads back");

  let runnerCallCount = 0;
  let capturedSport: string | null = null;
  let capturedDate: string | null = null;
  const runner: AutoModelRunner = async (sport, date) => {
    runnerCallCount++;
    capturedSport = sport;
    capturedDate = date;
  };

  // Simulate: probe finds no completed run, then read-back returns rows
  // written by the (stubbed) auto-model.
  let probeCalls = 0;
  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": () => {
        probeCalls++;
        // First probe (hasCompletedRun) → empty
        // Subsequent probes (none expected, but safe to return empty) → empty
        return noRunRow();
      },
      "game_predictions:list": joinRows(8),
    },
  });
  const source = new AutoMlbScoresModelSource(client, runner);
  const rows = await source.getPredictionsForDate("2026-06-03");

  check("runner WAS invoked", runnerCallCount === 1, `got ${runnerCallCount} calls`);
  check("runner received sport=mlb", capturedSport === "mlb");
  check("runner received the requested date", capturedDate === "2026-06-03");
  check("read-back returned 8 rows from stubbed write", rows.length === 8);
  check("hasCompletedRun probed exactly once", probeCalls === 1);
}

async function testFailedPriorRunReruns() {
  section("getPredictionsForDate — failed prior run (successful_count=0) re-attempts");

  let runnerCallCount = 0;
  const runner: AutoModelRunner = async () => {
    runnerCallCount++;
  };

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": failedRunRow(),
      "game_predictions:list": joinRows(10),
    },
  });
  const source = new AutoMlbScoresModelSource(client, runner);
  const rows = await source.getPredictionsForDate("2026-06-03");

  check("runner WAS invoked because prior run had successful_count=0", runnerCallCount === 1);
  check("read-back returned 10 rows", rows.length === 10);
}

async function testRunnerErrorPropagation() {
  section("getPredictionsForDate — runner throws → adapter wraps with context");

  const runner: AutoModelRunner = async () => {
    throw new Error(
      "automodelService.generatePredictionsForSlate: writeToDb=true requires AUTOMODEL_DB_WRITES_ENABLED=true"
    );
  };

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": noRunRow(),
      "game_predictions:list": emptyRows(),
    },
  });
  const source = new AutoMlbScoresModelSource(client, runner);

  let thrown: Error | null = null;
  try {
    await source.getPredictionsForDate("2026-06-03");
  } catch (e) {
    thrown = e as Error;
  }
  check("threw an error", thrown !== null);
  check(
    "error message includes AutoMlbScoresModelSource prefix for clear cron logs",
    thrown?.message.includes("AutoMlbScoresModelSource") ?? false,
    `message="${thrown?.message ?? ""}"`
  );
  check(
    "error message includes the wrapped original cause",
    thrown?.message.includes("AUTOMODEL_DB_WRITES_ENABLED") ?? false,
    `message="${thrown?.message ?? ""}"`
  );
}

async function testEmptySlate() {
  section("getPredictionsForDate — runner succeeds but slate is empty (0 games)");

  let runnerCallCount = 0;
  const runner: AutoModelRunner = async () => {
    runnerCallCount++;
  };

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": noRunRow(),
      "game_predictions:list": emptyRows(),
    },
  });
  const source = new AutoMlbScoresModelSource(client, runner);
  const rows = await source.getPredictionsForDate("2026-06-03");

  check("runner was invoked", runnerCallCount === 1);
  check("read-back returns empty array (matches cron's partial:true semantics)", rows.length === 0);
}

async function testGetLastUpdatedExists() {
  section("getLastUpdated — completed run exists");

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": completedRunRow(),
    },
  });
  const source = new AutoMlbScoresModelSource(client);
  const ts = await source.getLastUpdated("2026-06-03");

  check("returns Date object", ts instanceof Date);
  check(
    "Date matches completed_at",
    ts?.toISOString() === "2026-06-03T13:05:23.000Z",
    `got ${ts?.toISOString()}`
  );
}

async function testGetLastUpdatedNoRow() {
  section("getLastUpdated — no row exists");

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": noRunRow(),
    },
  });
  const source = new AutoMlbScoresModelSource(client);
  const ts = await source.getLastUpdated("2026-06-03");

  check("returns null", ts === null);
}

async function testGetLastUpdatedSwallowsPGRST116() {
  section("getLastUpdated — PGRST116 (no rows matched) returns null instead of throwing");

  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": {
        data: null,
        error: { message: "no rows found", code: "PGRST116" },
      },
    },
  });
  const source = new AutoMlbScoresModelSource(client);
  const ts = await source.getLastUpdated("2026-06-03");

  check("returns null instead of throwing on PGRST116", ts === null);
}

async function testFilterShapeCorrect() {
  section("Internal — adapter sends correct (sport, source, date) filters to scores_model_runs");

  const recordedFilters: Array<{ field: string; value: unknown }>[] = [];
  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": noRunRow(),
      "game_predictions:list": emptyRows(),
    },
    onQuery: (rec) => {
      if (rec.table === "scores_model_runs") recordedFilters.push(rec.filters);
    },
  });
  const source = new AutoMlbScoresModelSource(client, async () => {});
  await source.getPredictionsForDate("2026-06-03");

  check("scores_model_runs probed at least once", recordedFilters.length >= 1);
  const first = recordedFilters[0] ?? [];
  const map = new Map(first.map((f) => [f.field, f.value]));
  check("filter includes sport=mlb", map.get("sport") === "mlb");
  check(
    "filter includes source=auto_v1_mlb_rules (NOT manual_daniel)",
    map.get("source") === "auto_v1_mlb_rules"
  );
  check("filter includes run_date=2026-06-03", map.get("run_date") === "2026-06-03");
}

async function testReadFiltersCorrect() {
  section("Internal — readExistingRows filters on prediction_source=auto_v1_mlb_rules");

  const recordedFilters: Array<{ field: string; value: unknown }>[] = [];
  const client = createFakeClient({
    responses: {
      "scores_model_runs:maybeSingle": completedRunRow(),
      "game_predictions:list": joinRows(3),
    },
    onQuery: (rec) => {
      if (rec.table === "game_predictions") recordedFilters.push(rec.filters);
    },
  });
  const source = new AutoMlbScoresModelSource(client, async () => {});
  await source.getPredictionsForDate("2026-06-03");

  check("game_predictions read once", recordedFilters.length === 1);
  const map = new Map((recordedFilters[0] ?? []).map((f) => [f.field, f.value]));
  check(
    "filter prediction_source=auto_v1_mlb_rules (isolates auto rows from manual)",
    map.get("prediction_source") === "auto_v1_mlb_rules"
  );
  check("filter games.sport=mlb", map.get("games.sport") === "mlb");
  check("filter games.slate_date=2026-06-03", map.get("games.slate_date") === "2026-06-03");
}

async function testMetadataShape() {
  section("Metadata + identity contract");

  const client = createFakeClient({ responses: {} });
  const source = new AutoMlbScoresModelSource(client);

  check("sport === 'mlb'", source.sport === "mlb");
  check("isAutomated === true", source.isAutomated === true);
  check("metadata.source === 'auto_v1_mlb_rules'", source.metadata.source === "auto_v1_mlb_rules");
  check("metadata.isAutomated === true", source.metadata.isAutomated === true);
  check("metadata.name is human-readable", source.metadata.name === "Auto v1 (MLB rules)");
}

async function testFactoryRoutesAutoWhenFlagOn() {
  section("factory — routes AutoMlbScoresModelSource when USE_AUTO_SCORES_MODEL_MLB=true");

  __resetScoresModelSourceCache();
  const prev = process.env.USE_AUTO_SCORES_MODEL_MLB;
  process.env.USE_AUTO_SCORES_MODEL_MLB = "true";
  try {
    const client = createFakeClient({ responses: {} });
    const source = getScoresModelSource("mlb", client);
    check("returned source isAutomated === true", source.isAutomated === true);
    check(
      "returned source is an instance of AutoMlbScoresModelSource",
      source instanceof AutoMlbScoresModelSource
    );
    check("metadata.source === 'auto_v1_mlb_rules'", source.metadata.source === "auto_v1_mlb_rules");
  } finally {
    if (prev === undefined) delete process.env.USE_AUTO_SCORES_MODEL_MLB;
    else process.env.USE_AUTO_SCORES_MODEL_MLB = prev;
    __resetScoresModelSourceCache();
  }
}

async function testFactoryRoutesManualWhenFlagOff() {
  section("factory — still routes Manual when USE_AUTO_SCORES_MODEL_MLB is unset");

  __resetScoresModelSourceCache();
  const prev = process.env.USE_AUTO_SCORES_MODEL_MLB;
  delete process.env.USE_AUTO_SCORES_MODEL_MLB;
  try {
    const client = createFakeClient({ responses: {} });
    const source = getScoresModelSource("mlb", client);
    check(
      "returned source is an instance of ManualScoresModelSource",
      source instanceof ManualScoresModelSource
    );
    check("source.isAutomated === false", source.isAutomated === false);
  } finally {
    if (prev !== undefined) process.env.USE_AUTO_SCORES_MODEL_MLB = prev;
    __resetScoresModelSourceCache();
  }
}

async function testFactoryRejectsAutoForOtherSports() {
  section("factory — throws helpfully when auto flag set for non-MLB sport");

  __resetScoresModelSourceCache();
  const prev = process.env.USE_AUTO_SCORES_MODEL_NBA;
  process.env.USE_AUTO_SCORES_MODEL_NBA = "true";
  try {
    const client = createFakeClient({ responses: {} });
    let thrown: Error | null = null;
    try {
      getScoresModelSource("nba", client);
    } catch (e) {
      thrown = e as Error;
    }
    check("threw for NBA when auto flag set", thrown !== null);
    check(
      "error message names the sport",
      thrown?.message.toLowerCase().includes("nba") ?? false,
      `msg="${thrown?.message ?? ""}"`
    );
  } finally {
    if (prev === undefined) delete process.env.USE_AUTO_SCORES_MODEL_NBA;
    else process.env.USE_AUTO_SCORES_MODEL_NBA = prev;
    __resetScoresModelSourceCache();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.A — AutoMlbScoresModelSource + factory unit tests");
  console.log("==========================================================");

  await testExistingRunPath();
  await testGenerateOnEmptyPath();
  await testFailedPriorRunReruns();
  await testRunnerErrorPropagation();
  await testEmptySlate();
  await testGetLastUpdatedExists();
  await testGetLastUpdatedNoRow();
  await testGetLastUpdatedSwallowsPGRST116();
  await testFilterShapeCorrect();
  await testReadFiltersCorrect();
  await testMetadataShape();
  await testFactoryRoutesAutoWhenFlagOn();
  await testFactoryRoutesManualWhenFlagOff();
  await testFactoryRejectsAutoForOtherSports();

  console.log();
  console.log("==========================================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
