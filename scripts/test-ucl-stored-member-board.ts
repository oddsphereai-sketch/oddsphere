import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { restoreUclStoredMemberGame, type UclStoredMemberRecord } from "../lib/services/ucl/uclStoredMemberBoard";
const now = new Date("2026-11-10T13:00Z");
const fixture = { external_id: 34_000_001, game_date: "2026-11-24T20:00Z", home_team_id: 1, away_team_id: 2 };
const teams = [{ id: 1, display_name: "Arsenal", abbreviation: "ARS" }, { id: 2, display_name: "Dortmund", abbreviation: "DOR" }];
const projection = { coherentScorePresentation: { score: { away: 1.2, home: 2.1 } }, expectedGoals: { away: 1.2, home: 2.1 } };
const rows: UclStoredMemberRecord[] = ["match_result", "total", "btts", "double_chance"].map(market => ({
  external_id: fixture.external_id, game_date: fixture.game_date, market, model_version: "legacy-model", calibration_version: "legacy-grade", locked_at: null,
  snapshot_json: { competition: "uefa_champions_league", model_release: "legacy-model", calibration_release: "legacy-grade",
    captured_at: "2026-11-05T22:17:47Z", scheduled_lock_at: "2026-11-24T19:00Z", member_projection_at_capture: projection,
    member_market_at_capture: { pick: "ARS", modelProb: .7123456789, verdict: { key: "lean", label: "Lean" },
      priceAmerican: -122, currentPriceAmerican: -122, keyStats: [], reviewFlags: ["legacy-grade"],
      grade: "market_led", sharpStatus: "mixed", held: false, oddsTrail: [{ observedAt: "2026-11-05T22:00Z", american: -122 }] } },
}));
const before = structuredClone(rows);
const restored = restoreUclStoredMemberGame(fixture, teams, rows, now)!;
assert(restored);
assert.equal(restored.external_id, 4_000_001);
assert.deepEqual(restored.markets.moneyline, rows[0]!.snapshot_json!.member_market_at_capture);
assert.deepEqual(restored.soccerProjection, projection);
assert.equal(restored.generatedAt, "2026-11-05T22:17:47Z");
assert.deepEqual(rows, before);
restored.markets.moneyline.modelProb = .99;
assert.deepEqual(rows, before, "render mutation must never alias stored evidence");
assert.equal(restoreUclStoredMemberGame(fixture, teams, rows.slice(0, 3), now), null);
for (const mutate of [
  (r: UclStoredMemberRecord[]) => { r[0]!.snapshot_json!.captured_at = "2026-11-06T22:00Z"; },
  (r: UclStoredMemberRecord[]) => { r[0]!.game_date = "2026-11-25T20:00Z"; },
  (r: UclStoredMemberRecord[]) => { r[0]!.snapshot_json!.member_projection_at_capture = { ...projection, expectedGoals: { home: 8, away: 9 } }; },
  (r: UclStoredMemberRecord[]) => { r[0]!.snapshot_json!.model_release = "wrong-release"; },
]) { const bad = structuredClone(rows); mutate(bad); assert.equal(restoreUclStoredMemberGame(fixture, teams, bad, now), null); }
assert.equal(restoreUclStoredMemberGame(fixture, teams, rows, new Date("2026-11-24T19:01Z")), null, "overdue unlocked rows cannot become synthetic locks");
const locked = structuredClone(rows).map(r => ({ ...r, locked_at: "2026-11-10T12:00Z" }));
const newer = structuredClone(rows).map(r => ({ ...r, snapshot_json: { ...r.snapshot_json, captured_at: "2026-11-10T12:30Z" } }));
const frozen = JSON.stringify(locked);
const lockResult = restoreUclStoredMemberGame(fixture, teams, [...locked, ...newer], now)!;
assert.equal(lockResult.lockState, "locked");
assert.equal(lockResult.generatedAt, "2026-11-05T22:17:47Z", "existing legacy lock beats a newer unlocked release");
assert.deepEqual(lockResult.markets.moneyline, locked[0]!.snapshot_json!.member_market_at_capture);
assert.equal(JSON.stringify(locked), frozen);
assert.equal(restoreUclStoredMemberGame(fixture, teams, [...locked.slice(0, 3), ...newer], now), null, "incomplete lock forbids unlocked replacement");
console.log("PASS exact saved UCL cards: all-market/capture/fixture/release checks, original clocks, legacy lock precedence, no model inference or stored mutation");

const ui = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
assert.match(ui, /<EdgeBoard[^>]+games=\{scopedGames\}/);
assert.doesNotMatch(ui, /UclUpcomingSchedule/);
assert.equal(existsSync("app/dev/experience-preview/UclUpcomingSchedule.tsx"), false);
