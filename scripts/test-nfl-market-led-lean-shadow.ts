import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const r5Path = path.join(root, "scripts/operator/tournament_nfl_market_led_lean_v5.py");
const scorerPath = path.join(root, "scripts/operator/score_current_nfl_market_led_lean.py");
const exporterPath = path.join(root, "scripts/operator/export-latest-nfl-forward-evidence.ts");
const auditPath = path.join(root, "docs/model-audits/2026-08-22-nfl-market-led-lean-r5.md");

const r5 = fs.readFileSync(r5Path, "utf8");
const scorer = fs.readFileSync(scorerPath, "utf8");
const exporter = fs.readFileSync(exporterPath, "utf8");
const audit = fs.readFileSync(auditPath, "utf8");

assert.match(r5, /nfl_market_led_moneyline_shadow_2026_08_22_r5/);
assert.match(r5, /nfl_market_led_moneyline_lean_shadow_2026_08_22_r5/);
assert.match(r5, /price_band="competitive"/);
assert.match(r5, /maximum_actions_per_week=None/);
assert.match(r5, /no weekly cap or quota/);
assert.match(r5, /"bestAngleAuthorized": False/);
assert.match(r5, /"productionAuthorized": False/);
assert.match(r5, /uncapped product-compatible policy is negative in 2025 confirmation/);

assert.match(scorer, /nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r5/);
assert.match(scorer, /"publicationEnabled": False/);
assert.match(scorer, /"trackingEnabled": False/);
assert.match(scorer, /"productionActionable": False/);
assert.match(scorer, /other_book_consensus/);
assert.match(scorer, /otherBooksConsensusFairProbability/);
assert.match(scorer, /quarterback confirmation is a health hold, not an ordinary No Play/);
assert.match(scorer, /decisionTimestamp/);
assert.match(scorer, /americanPrice/);
assert.doesNotMatch(scorer, /best_angle/i);

assert.match(exporter, /readNflForwardEvidence/);
assert.match(exporter, /readOnly: true/);
assert.doesNotMatch(exporter, /\.insert\(/);
assert.doesNotMatch(exporter, /\.update\(/);
assert.doesNotMatch(exporter, /\.delete\(/);

assert.match(audit, /Reject r5 for production/);
assert.match(audit, /Best Angle remains unavailable/);
assert.match(audit, /-7\.67% to \+17\.36%/);
assert.match(audit, /eight current shadow\s+candidates/);

const reportPath = path.join(
  root,
  "football-research/reports/nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r5.json",
);
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.localOnly, true);
  assert.equal(report.shadowOnly, true);
  assert.equal(report.publicationEnabled, false);
  assert.equal(report.trackingEnabled, false);
  assert.equal(report.games.length, 16);
  assert.equal(report.boardCounts.shadowLeanCandidates, 8);
  assert.equal(report.boardCounts.productionActionable, 0);
  assert.equal(report.boardCounts.betGradeHeld, 16);
  assert.equal(report.health.matchedExpectedQuarterbacks, 32);
  assert.equal(report.health.projectedExpectedQuarterbacks, 32);
  assert.equal(report.health.confirmedExpectedQuarterbacks, 0);
  for (const game of report.games) {
    const tuple = game.selectedMoneyline;
    assert.ok(tuple.modelProbability > 0 && tuple.modelProbability < 1);
    assert.ok(tuple.otherBooksConsensusFairProbability > 0 && tuple.otherBooksConsensusFairProbability < 1);
    assert.notEqual(tuple.americanPrice, 0);
    assert.equal(game.decision.decisionTimestamp, game.evaluatedQuote.observedAt);
    assert.equal(game.decision.productionActionable, false);
  }
}

console.log("NFL market-led Lean shadow release, exact-price tuple, and no-production boundaries passed.");
