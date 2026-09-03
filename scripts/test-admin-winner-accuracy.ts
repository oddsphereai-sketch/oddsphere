import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

type Operation = { table: string; method: string; args: unknown[] };

function fakeClient(
  recordRows: Array<Record<string, unknown>>,
  gradeRows: Array<Record<string, unknown>>,
  uclManifestRows: Array<Record<string, unknown>> = recordRows,
) {
  const operations: Operation[] = [];
  class Query {
    private selection = "";
    constructor(private readonly table: string) {}
    select(...args: unknown[]) { this.selection = String(args[0] ?? ""); operations.push({ table: this.table, method: "select", args }); return this; }
    in(...args: unknown[]) { operations.push({ table: this.table, method: "in", args }); return this; }
    not(...args: unknown[]) { operations.push({ table: this.table, method: "not", args }); return this; }
    eq(...args: unknown[]) { operations.push({ table: this.table, method: "eq", args }); return this; }
    contains(...args: unknown[]) { operations.push({ table: this.table, method: "contains", args }); return this; }
    gte(...args: unknown[]) { operations.push({ table: this.table, method: "gte", args }); return this; }
    lt(...args: unknown[]) { operations.push({ table: this.table, method: "lt", args }); return this; }
    order(...args: unknown[]) { operations.push({ table: this.table, method: "order", args }); return this; }
    range(from: number, to: number) {
      operations.push({ table: this.table, method: "range", args: [from, to] });
      return Promise.resolve({ data: recordRows.slice(from, to + 1), error: null });
    }
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const manifestRead = this.table === "prediction_records" && !this.selection.includes("matchup");
      const value = { data: this.table === "prediction_grades" ? gradeRows : manifestRead ? uclManifestRows : recordRows, error: null as null };
      return Promise.resolve(value).then(onfulfilled, onrejected);
    }
  }
  return {
    client: { from: (table: string) => new Query(table) },
    operations,
  };
}

async function main() {
  const query = await import("../lib/services/tracking/winnerAccuracyScorecardQuery");

  assert.deepEqual(query.utcBoundsForEtDate("2026-03-08"), {
    from: "2026-03-08T05:00:00.000Z",
    to: "2026-03-09T04:00:00.000Z",
  }, "spring DST day must be a truthful 23-hour ET window");
  assert.deepEqual(query.utcBoundsForEtDate("2026-11-01"), {
    from: "2026-11-01T04:00:00.000Z",
    to: "2026-11-02T05:00:00.000Z",
  }, "fall DST day must be a truthful 25-hour ET window");
  assert.equal(query.resolveLockedDate("morning", null, new Date("2026-09-02T16:00:00.000Z")), "2026-09-01");
  assert.equal(query.resolveLockedDate("nightly", null, new Date("2026-09-02T16:00:00.000Z")), "2026-09-02");

  const records = [{
    id: 11,
    game_id: 22,
    external_id: 33,
    sport: "mlb",
    slate_date: "2026-09-01",
    matchup: "AWAY @ HOME",
    market: "moneyline",
    pick: "HOME",
    side: "home",
    odds_american: -110,
    model_used: "mlb",
    model_version: "decision-r1",
    calibration_version: "calibration-r1",
    model_probability: 0.6,
    market_probability: 0.55,
    play_grade: "lean",
    no_bet: false,
    locked_at: "2026-09-01T18:00:00.000Z",
    competition: null,
    model_layer_versions: { decision_release_id: "decision-r1", active_probability_head: "head-r1", calibration_version: "calibration-r1" },
    decision_tuple: null,
    distribution_version: null,
    grade_policy_version: null,
    prediction_record_contract_version: null,
    epl_forecast: null,
    epl_model_release: null,
    epl_calibration_release: null,
    cfb_tracking_record_release: null,
    nfl_tracking_record_release: null,
    closing_line_value: { closing_odds_american: -115, clv_pct: 1.2 },
  }];
  const grades = [{
    prediction_record_id: 11,
    win: true,
    loss: false,
    actual_home_score: 4,
    actual_away_score: 2,
    graded_at: "2026-09-02T02:00:00.000Z",
  }];
  const fake = fakeClient(records, grades);
  const result = await query.loadWinnerAccuracyScorecards(
    { window: "morning", lockedDate: "2026-09-01", recordCap: 2_000 },
    fake.client as never,
  );
  assert.equal(result.monitoring.state, "healthy");
  assert.equal(result.scorecards.length, 1);
  assert.equal(result.scorecards[0].winnerAccuracy.accuracyPct, 100);
  assert.equal(result.scorecards[0].exactPriceReturns.actionableOnly.resolved, 1);
  assert.equal(fake.operations.filter((entry) => entry.table === "prediction_records" && entry.method === "select").length, 1);
  assert.equal(fake.operations.filter((entry) => entry.table === "prediction_grades" && entry.method === "select").length, 1);
  assert.ok(fake.operations.some((entry) => entry.table === "prediction_records" && entry.method === "gte"));
  assert.ok(fake.operations.some((entry) => entry.table === "prediction_records" && entry.method === "lt"));
  assert.equal(query.WINNER_ACCURACY_RECORD_SELECT.split(",").includes("snapshot_json"), false, "raw snapshot_json must never be selected");

  const uclWinner = {
    ...records[0], id: 31, game_id: 41, external_id: 51, sport: "soccer",
    market: "match_result", pick: "HOME", side: "home",
    model_used: "ucl", model_version: "ucl-model-r1", calibration_version: "ucl-cal-r1",
    competition: "uefa_champions_league",
    epl_forecast: {
      displayed_side: "home",
      model: { home: 0.6, draw: 0.22, away: 0.18 },
      market: { home: 0.55, draw: 0.25, away: 0.2 },
    },
  };
  const uclGrade = { ...grades[0], prediction_record_id: 31 };
  const uclManifest = ["match_result", "double_chance", "total", "btts"].map((market, index) => ({
    game_id: 41, external_id: 51, sport: "soccer", slate_date: "2026-09-01", market,
    model_version: "ucl-model-r1", calibration_version: "ucl-cal-r1",
    locked_at: "2026-09-01T18:00:00.000Z", competition: "uefa_champions_league", id: 31 + index,
  }));
  const partialUcl = await query.loadWinnerAccuracyScorecards(
    { window: "morning", lockedDate: "2026-09-01" },
    fakeClient([uclWinner], [uclGrade], uclManifest.slice(0, 3)).client as never,
  );
  assert.equal(partialUcl.settledRows, 0, "partial UCL locks cannot enter the release-pure winner scorecard");
  assert.equal(partialUcl.scorecards.length, 0);
  const completeUcl = await query.loadWinnerAccuracyScorecards(
    { window: "morning", lockedDate: "2026-09-01" },
    fakeClient([uclWinner], [uclGrade], uclManifest).client as never,
  );
  assert.equal(completeUcl.settledRows, 1, "the fourth exact UCL market makes its Match Result scorecard-eligible");
  assert.equal(completeUcl.scorecards[0]?.sport, "ucl");

  const empty = fakeClient([], []);
  const emptyResult = await query.loadWinnerAccuracyScorecards(
    { window: "nightly", lockedDate: "2026-09-02" },
    empty.client as never,
  );
  assert.equal(emptyResult.monitoring.state, "no_data");
  assert.equal(emptyResult.monitoring.degraded, false, "an honest zero-settlement daily window is not an outage");

  const capRows = Array.from({ length: 2_000 }, (_, index) => ({ ...records[0], id: index + 1 }));
  const capped = fakeClient(capRows, []);
  await assert.rejects(
    query.loadWinnerAccuracyScorecards(
      { window: "morning", lockedDate: "2026-09-01", recordCap: 2_000 },
      capped.client as never,
    ),
    /record cap reached/,
  );
  assert.equal(capped.operations.filter((entry) => entry.table === "prediction_records" && entry.method === "range").length, 2);
  assert.equal(capped.operations.some((entry) => entry.table === "prediction_grades"), false, "cap refusal must happen before grade reads");

  const route = readFileSync("app/api/admin/tracking/winner-accuracy/route.ts", "utf8");
  const authIndex = route.indexOf("validateAdminAuth(request)");
  const loadIndex = route.indexOf("loadCachedDailyScorecard(rawWindow, lockedDate)");
  assert.ok(authIndex >= 0 && loadIndex > authIndex, "admin auth must complete before cached/query work");
  assert.match(route, /rawWindow !== "morning" && rawWindow !== "nightly"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /stale_fallback/);
  assert.match(route, /status: "degraded"/);

  const panel = readFileSync("app/admin/tracking/WinnerAccuracyPanel.tsx", "utf8");
  assert.match(panel, /if \(!expanded\)[\s\S]*setExpanded\(true\); void load\(\)/, "panel must require an explicit open action before loading");
  assert.match(panel, /Load release-pure winner accuracy/);
  assert.match(panel, /Actionable exact-price ROI/);
  assert.match(panel, /Actionable CLV/);

  const operator = readFileSync("scripts/operator/audit-cross-sport-winner-accuracy.ts", "utf8");
  assert.match(operator, /--apply is not supported; this audit is SELECT-only/);

  console.log("admin winner-accuracy integration: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
