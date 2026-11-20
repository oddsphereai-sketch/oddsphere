import assert from "node:assert/strict";
import { buildNbaFrozenPerformance, type FrozenNbaRow } from "./audit/nba/frozen-performance";
const row: FrozenNbaRow = { id: 1, game_id: 10, external_id: 100, slate_date: "2026-11-18", game_date: "2026-11-19T00:00:00Z", matchup: "A@H",
  market: "spread", side: "away", line_value: 5.5, odds_american: -110, model_version: "r36", calibration_version: null, grade_policy_release: "r31",
  model_probability: .6, play_grade: "lean", locked_at: "2026-11-18T23:00:00Z", held: false, independent_picks: { spread: "home" },
  grades: { result: "win", actual_home_score: 100, actual_away_score: 96, grade_source: "auto_score_ingest", graded_at: "2026-11-19T03:00:00Z" } };
const input = [row, { ...row, id: 2, model_version: "r35", play_grade: "market_aligned" },
  { ...row, id: 3, market: "total", side: "under", line_value: 196, model_probability: .5, independent_picks: { total: "over" }, grades: { ...row.grades!, result: "push" } },
  { ...row, id: 4, market: "moneyline", side: "home", line_value: null, odds_american: null, model_probability: .7, play_grade: "market_aligned", independent_picks: null }];
const original = JSON.stringify(input), report = buildNbaFrozenPerformance(input);
assert.equal(JSON.stringify(input), original, "Audit cannot mutate frozen evidence");
assert.deepEqual(report.issues, []);
assert.equal(report.eras.length, 2, "Never blend model eras");
const current = report.eras.find(e => e.model === "r36")!;
const spread = current.markets.find(m => m.market === "spread")!;
assert.equal(spread.all.wins, 1, "Away +5.5 covers a four-point home win");
assert.ok(Math.abs(spread.all.oneUnitProfit - 100 / 110) < 1e-12);
assert.equal(spread.pairedIndependentDirection.independentWins, 0);
assert.equal(spread.pairedIndependentDirection.changedToWin, 1);
const total = current.markets.find(m => m.market === "total")!;
assert.equal(total.all.pushes, 1);
assert.equal(total.all.probabilityRows, 0, "Do not score returned pushes as binary losses");
assert.equal(total.all.oneUnitProfit, 0);
assert.equal(current.markets[0]!.all.unpricedSettlements, 1, "Missing price cannot become fictional -110 return");
assert.equal(current.markets[0]!.actionable.records, 0, "Watch/No Play accuracy is separate from wagers");
assert.equal(buildNbaFrozenPerformance([{ ...row, grades: { ...row.grades!, result: "loss" } }]).issues.length, 1);
assert.equal(buildNbaFrozenPerformance([{ ...row, locked_at: "2026-11-19T00:01:00Z" }]).issues.length, 1);
assert.throws(() => buildNbaFrozenPerformance([row, row]), /Duplicate/);
assert.equal(buildNbaFrozenPerformance([row, { ...row, id: 99 }]).status, "invalid_evidence");
const held = buildNbaFrozenPerformance([{ ...row, held: true }]);
assert.equal(held.eras[0]!.markets[1]!.actionable.records, 0);
assert.equal(held.status, "invalid_evidence");
assert.deepEqual(buildNbaFrozenPerformance([]).eras, []);
console.log("NBA frozen performance: signed away handicap, release separation, exact returns, push exclusion, immutable inputs and bad-evidence detection passed.");
