import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../lib/services/trackingAggregateService";
import { buildAlternateLineCategories } from "../lib/services/tracking/alternateLinePerformance";
import { UCL_MODEL_RELEASE, UCL_CALIBRATION_RELEASE } from "../lib/services/ucl/uclModel";
import type { PredictionRecordRow, PredictionGradeRow } from "../lib/types/domain/Tracking";

async function main() {
  const records: PredictionRecordRow[] = [];
  const grades: PredictionGradeRow[] = [];
  function game(id: number, date: string, release: string, side: string, score: number, extra = {}) {
    for (const [i, market] of ["match_result", "double_chance", "total", "btts"].entries()) {
      const record = {
        id: id * 10 + i, game_id: id, external_id: id, sport: "soccer",
        competition: "uefa_champions_league", slate_date: date, game_date: `${date}T20:00:00Z`,
        created_at: `${date}T10:00:00Z`, published_at: `${date}T18:00:00Z`, locked_at: `${date}T19:00:00Z`,
        model_version: release, calibration_version: release === UCL_MODEL_RELEASE ? UCL_CALIBRATION_RELEASE : `${release}-calibration`,
        market, side: market === "total" ? side : "home", line_value: market === "total" ? 2.5 : null,
        pick: market === "total" ? `${side} 2.5` : "home", held: false, launch_day: false,
        no_bet: false, best_angle: false, play_grade: "lean", matchup: "A @ B",
        snapshot_json: { competition: "uefa_champions_league" },
        ...extra,
      } as unknown as PredictionRecordRow;
      const win = market !== "total" || (side === "under" ? score < 2.5 : score > 2.5);
      records.push(record);
      grades.push({ prediction_record_id: record.id!, result: win ? "win" : "loss", win, loss: !win,
        push: false, void: false, pending: false, actual_home_score: score, actual_away_score: 0,
        actual_total: score, graded_at: `${date}T23:00:00Z`,
      } as PredictionGradeRow);
    }
  }
  game(1, "2026-09-08", "r6-archive", "under", 3);
  game(2, "2026-10-13", "intermediate-r12", "over", 3);
  game(3, "2026-10-14", "intermediate-r18", "under", 4);
  game(4, "2026-11-04", UCL_MODEL_RELEASE, "under", 2);
  game(5, "2026-10-15", "held", "under", 2, { held: true, side: null });
  game(6, "2026-10-16", "partial", "under", 2);
  records.splice(records.findIndex(r => r.game_id === 6 && r.market === "btts"), 1);
  game(7, "2026-10-17", "late-unverified", "over", 3, { created_at: "2026-11-01T00:00:00Z" });
  records.push({ ...records[0], id: 1000, game_id: 1000, external_id: 1000, sport: "nfl",
    competition: null, snapshot_json: null, slate_date: "2026-10-20", market: "total", side: "over", line_value: 45.5,
    created_at: "2026-10-20T10:00:00Z", locked_at: "2026-10-20T18:00:00Z", game_date: "2026-10-20T20:00:00Z",
  });
  grades.push({ ...grades[0], prediction_record_id: 1000, result: "win", win: true, loss: false,
    actual_home_score: 30, actual_away_score: 20, actual_total: 50 });
  const before = structuredClone({ records, grades });
  // Actual aggregate with a SELECT-only relational client. Mutation attempts fail.
  const client = { from(table: string) {
    let values: unknown[] = table === "prediction_grades" ? grades : table === "tracking_baselines" ? [] : records;
    let from = 0, to = Infinity;
    const q = {
      select() { return q; }, order() { return q; }, limit(n: number) { to = n - 1; return q; },
      range(a: number, b: number) { from = a; to = b; return q; },
      eq(k: string, v: unknown) { values = values.filter(r => (r as Record<string, unknown>)[k] === v); return q; },
      gte(k: string, v: string) { values = values.filter(r => String((r as Record<string, unknown>)[k]) >= v); return q; },
      lte(k: string, v: string) { values = values.filter(r => String((r as Record<string, unknown>)[k]) <= v); return q; },
      contains() { return q; },
      in(k: string, ids: number[]) { values = values.filter(r => ids.includes(Number((r as Record<string, unknown>)[k]))); return q; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve({ data: values.slice(from, to + 1), error: null }).then(resolve, reject);
      },
    }; return q;
  } } as unknown as SupabaseClient;
  const result = await computeTrackingAggregate({ supabase: client, from: "2026-06-07", to: "2026-11-05" });
  const alt = result.alternateLinePerformance;
  const lifetime = alt.lifetime.rows.find(r => r.sport === "ucl")!;
  const month = alt.monthly.rows.find(r => r.sport === "ucl")!;
  assert.equal(lifetime.source, "locked_history");
  assert.match(lifetime.sourceLabel, /all model versions/);
  assert.equal(lifetime.original.settled, 4, "all verified releases count once, with unsafe/partial/held records excluded");
  assert.deepEqual(lifetime.adjustments[0].metrics, { wins: 2, losses: 1, pushes: 1, settled: 4, winPct: 66.67 });
  assert.equal(month.original.settled, 3);
  for (const key of ["wins", "losses", "pushes", "settled"] as const) {
    assert(lifetime.adjustments[0].metrics[key] >= month.adjustments[0].metrics[key]);
  }
  assert.equal(alt.currentRelease?.rows.find(r => r.sport === "ucl")?.original.settled, 1);
  assert.equal(result.bySportMarket.find(r => r.sport === "ucl" && r.market === "total")?.metrics.picks, 1,
    "current-model aggregate remains release-pure");
  assert.deepEqual(alt.archives, [], "legacy locks are not appended twice to public Lifetime");
  const nfl = records.find(r => r.sport === "nfl")!;
  assert.deepEqual(alt.lifetime.rows.filter(r => r.sport === "nfl"), buildAlternateLineCategories([
    { record: nfl, grade: grades.find(g => g.prediction_record_id === nfl.id)!, displaySport: "nfl" },
  ], { from: "2026-06-07", to: "2026-11-05" }), "other-sport behavior remains exact");
  assert.deepEqual({ records, grades }, before, "every original lock, evidence field and stored grade stays unchanged");
  console.log("PASS UCL alternate Lifetime: all release cohorts, monthly subset, no archive duplicates, release-pure current metrics, unsafe evidence exclusion and immutable sources");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
