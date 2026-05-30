/**
 * Phase 3.x.0d — mocked-Supabase unit tests for firstInningStatsWriter.
 *
 * Run: npx tsx scripts/test-first-inning-stats-writer.ts
 *
 * The mock captures every chained call (.from, .select, .update, .eq) so
 * assertions can verify (a) which table was hit, (b) which columns were
 * set, (c) the exact WHERE clause, and (d) that non-FI columns are never
 * touched.
 */
import {
  persistMlbPersonId,
  persistFirstInningStats,
  type PersistResult,
} from "../lib/services/firstInningStatsWriter";
import type { PitcherFirstInningStatsRecord } from "../lib/providers/real_api/_mlbStatsApiClient";

type CallShape = {
  table: string;
  op?: "select" | "update";
  selectCols?: string;
  values?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  isSingle: boolean;
  awaited: boolean;
};

type ProgrammedResult = { data?: unknown; error?: { message: string } | null };

type MockClient = {
  from: (table: string) => unknown;
  calls: CallShape[];
};

function makeMockClient(programmed: ProgrammedResult[]): MockClient {
  const calls: CallShape[] = [];
  let resIdx = 0;
  const from = (table: string): unknown => {
    const call: CallShape = { table, eqs: [], isSingle: false, awaited: false };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    const select = (cols: string) => {
      call.op = call.op ?? "select";
      call.selectCols = cols;
      return builder;
    };
    const update = (values: Record<string, unknown>) => {
      call.op = "update";
      call.values = values;
      return builder;
    };
    const eq = (col: string, val: unknown) => {
      call.eqs.push([col, val]);
      return builder;
    };
    const single = () => {
      call.isSingle = true;
      call.awaited = true;
      const r = programmed[resIdx++] ?? { data: null, error: null };
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    };
    const then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      call.awaited = true;
      const r = programmed[resIdx++] ?? { data: null, error: null };
      resolve({ data: r.data ?? null, error: r.error ?? null });
    };
    builder.select = select;
    builder.update = update;
    builder.eq = eq;
    builder.single = single;
    builder.then = then;
    return builder;
  };
  return { from, calls };
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, details?: string): void {
  if (ok) {
    pass++;
    console.log(`✓ ${label}`);
  } else {
    fail++;
    console.log(`✗ ${label}${details ? `\n    ${details}` : ""}`);
  }
}

const FI_RECORD: PitcherFirstInningStatsRecord = {
  mlb_person_id: 676979,
  season: 2025,
  first_inning_era: 2.25,
  first_inning_starts: 32,
  first_inning_runs_allowed: 8,
  first_inning_earned_runs: 8,
  first_inning_innings_pitched: 32.0,
  first_inning_whip: 1.03,
  raw_source: "mlb_stats_api",
};

const FI_COLUMNS = [
  "first_inning_era",
  "first_inning_starts",
  "first_inning_runs_allowed",
  "first_inning_earned_runs",
  "first_inning_innings_pitched",
  "first_inning_whip",
];

const ALLOWED_NON_FI_KEYS = ["updated_at"];

async function main(): Promise<void> {
  // ── persistMlbPersonId ───────────────────────────────────────────────

  // [1] DRY-RUN — no client call at all
  {
    const mock = makeMockClient([]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: false,
      quiet: true,
      client: mock as never,
    });
    check("[1a] persistMlbPersonId dry-run returns dry_run kind", r.kind === "dry_run");
    check("[1b] persistMlbPersonId dry-run makes ZERO client calls", mock.calls.length === 0);
  }

  // [2] Write — existing mlb_person_id is null → UPDATE proceeds
  {
    const mock = makeMockClient([
      { data: { mlb_person_id: null }, error: null }, // SELECT
      { data: null, error: null }, // UPDATE
    ]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[2a] write + existing null → updated", r.kind === "updated");
    check(
      "[2b] write + existing null → rows_affected = 1",
      r.kind === "updated" && r.rows_affected === 1
    );
    check("[2c] write makes 2 calls (SELECT, UPDATE)", mock.calls.length === 2);
    check("[2d] first call is SELECT on players", mock.calls[0]?.op === "select" && mock.calls[0]?.table === "players");
    check("[2e] second call is UPDATE on players", mock.calls[1]?.op === "update" && mock.calls[1]?.table === "players");
    check(
      "[2f] UPDATE set keys are exactly mlb_person_id + updated_at",
      mock.calls[1]?.values !== undefined &&
        Object.keys(mock.calls[1]!.values!).sort().join(",") ===
          ["mlb_person_id", "updated_at"].sort().join(",")
    );
    check(
      "[2g] UPDATE has WHERE id=6272",
      mock.calls[1]?.eqs.some(([c, v]) => c === "id" && v === 6272) === true
    );
  }

  // [3] Write — existing mlb_person_id equals target → idempotent no-op
  {
    const mock = makeMockClient([
      { data: { mlb_person_id: 676979 }, error: null }, // SELECT
    ]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[3a] write + existing matches → updated (idempotent)", r.kind === "updated");
    check(
      "[3b] idempotent → rows_affected = 0 (no row touched)",
      r.kind === "updated" && r.rows_affected === 0
    );
    check("[3c] no UPDATE call issued on idempotent path", mock.calls.length === 1);
  }

  // [4] Write — existing differs → defensive refuse
  {
    const mock = makeMockClient([
      { data: { mlb_person_id: 543037 }, error: null }, // SELECT
    ]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[4a] write + existing differs → skipped_conflict", r.kind === "skipped_conflict");
    check(
      "[4b] conflict reason mentions existing id",
      r.kind === "skipped_conflict" && r.reason.includes("543037")
    );
    check("[4c] no UPDATE call issued on conflict path", mock.calls.length === 1);
  }

  // [5] DB error on SELECT → error
  {
    const mock = makeMockClient([
      { data: null, error: { message: "connection refused" } },
    ]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[5] select error → error kind", r.kind === "error");
  }

  // [6] DB error on UPDATE → error
  {
    const mock = makeMockClient([
      { data: { mlb_person_id: null }, error: null }, // SELECT ok
      { data: null, error: { message: "constraint violation" } }, // UPDATE fails
    ]);
    const r = await persistMlbPersonId(6272, 676979, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[6] update error → error kind", r.kind === "error");
  }

  // ── persistFirstInningStats ──────────────────────────────────────────

  // [7] DRY-RUN — no client call
  {
    const mock = makeMockClient([]);
    const r = await persistFirstInningStats(6272, 2025, FI_RECORD, {
      write: false,
      quiet: true,
      client: mock as never,
    });
    check("[7a] persistFirstInningStats dry-run → dry_run kind", r.kind === "dry_run");
    check("[7b] persistFirstInningStats dry-run → zero client calls", mock.calls.length === 0);
    check(
      "[7c] dry-run intended_update contains all 6 FI columns",
      r.kind === "dry_run" &&
        FI_COLUMNS.every((c) => c in (r.intended_update.set as Record<string, unknown>))
    );
  }

  // [8] Write — UPDATE succeeds, 1 row affected
  {
    const mock = makeMockClient([
      { data: [{ id: 999 }], error: null }, // UPDATE + .select() returns 1 row
    ]);
    const r = await persistFirstInningStats(6272, 2025, FI_RECORD, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[8a] write success → updated", r.kind === "updated");
    check(
      "[8b] rows_affected = 1",
      r.kind === "updated" && r.rows_affected === 1
    );
    const call = mock.calls[0];
    check("[8c] call is UPDATE on player_season_stats", call?.op === "update" && call?.table === "player_season_stats");
    check(
      "[8d] UPDATE set keys are exactly the 6 FI columns + updated_at",
      call?.values !== undefined &&
        Object.keys(call.values).sort().join(",") ===
          [...FI_COLUMNS, ...ALLOWED_NON_FI_KEYS].sort().join(",")
    );
    check(
      "[8e] UPDATE never touches pitching_era / batting_obp / pitching_whip",
      call?.values !== undefined &&
        !("pitching_era" in call.values!) &&
        !("batting_obp" in call.values!) &&
        !("pitching_whip" in call.values!)
    );
    check(
      "[8f] UPDATE has WHERE player_id=6272 AND season=2025 AND season_type=regular",
      call?.eqs.length === 3 &&
        call.eqs.some(([c, v]) => c === "player_id" && v === 6272) &&
        call.eqs.some(([c, v]) => c === "season" && v === 2025) &&
        call.eqs.some(([c, v]) => c === "season_type" && v === "regular")
    );
    check(
      "[8g] UPDATE values mirror record fields (era=2.25)",
      call?.values?.first_inning_era === 2.25
    );
    check(
      "[8h] UPDATE values mirror record fields (starts=32)",
      call?.values?.first_inning_starts === 32
    );
    check(
      "[8i] UPDATE values mirror record fields (ip=32.0)",
      call?.values?.first_inning_innings_pitched === 32.0
    );
  }

  // [9] Write — 0 rows match → skipped_no_row
  {
    const mock = makeMockClient([
      { data: [], error: null }, // UPDATE returns empty array (no rows matched)
    ]);
    const r = await persistFirstInningStats(99999, 2025, FI_RECORD, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[9] zero-match → skipped_no_row", r.kind === "skipped_no_row");
  }

  // [10] Write — DB error → error
  {
    const mock = makeMockClient([
      { data: null, error: { message: "permission denied" } },
    ]);
    const r = await persistFirstInningStats(6272, 2025, FI_RECORD, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[10] db error → error kind", r.kind === "error");
  }

  // [11] All-null FI record → still UPDATE-only with nulls (preserves
  // explicit "we tried and got nothing" — fallback path continues to work)
  {
    const mock = makeMockClient([
      { data: [{ id: 999 }], error: null },
    ]);
    const allNull: PitcherFirstInningStatsRecord = {
      mlb_person_id: 1,
      season: 2025,
      first_inning_era: null,
      first_inning_starts: null,
      first_inning_runs_allowed: null,
      first_inning_earned_runs: null,
      first_inning_innings_pitched: null,
      first_inning_whip: null,
      raw_source: "mlb_stats_api",
    };
    const r = await persistFirstInningStats(6272, 2025, allNull, {
      write: true,
      quiet: true,
      client: mock as never,
    });
    check("[11a] all-null record → write succeeds", r.kind === "updated");
    const call = mock.calls[0];
    check(
      "[11b] all-null record UPDATE values still have all 6 FI keys (with null values)",
      call?.values !== undefined &&
        FI_COLUMNS.every((c) => c in call.values!) &&
        FI_COLUMNS.every((c) => call.values![c] === null)
    );
  }

  console.log("\n" + "━".repeat(70));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Failures.");
    process.exit(1);
  }
  console.log("\n✅ All Phase 3.x.0d firstInningStatsWriter tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
