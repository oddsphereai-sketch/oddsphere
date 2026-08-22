import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tournamentPath = path.join(
  root,
  "scripts/operator/tournament_nfl_market_led_best_available_v6.py",
);
const scorerPath = path.join(
  root,
  "scripts/operator/score_current_nfl_market_led_best_available_v6.py",
);
const sharedScorerPath = path.join(
  root,
  "scripts/operator/score_current_nfl_market_led_lean.py",
);
const auditPath = path.join(
  root,
  "docs/model-audits/2026-08-22-nfl-market-led-best-available-r6.md",
);

const tournament = fs.readFileSync(tournamentPath, "utf8");
const scorer = fs.readFileSync(scorerPath, "utf8");
const sharedScorer = fs.readFileSync(sharedScorerPath, "utf8");
const audit = fs.readFileSync(auditPath, "utf8");

assert.match(tournament, /nfl_market_led_moneyline_shadow_2026_08_22_r6/);
assert.match(tournament, /nfl_market_led_moneyline_lean_shadow_2026_08_22_r6/);
assert.match(tournament, /price_band="all_bounded"/);
assert.match(tournament, /maximum_actions_per_week=None/);
assert.match(tournament, /for policy in candidate_policies/);
assert.match(tournament, /r4\.SELECTION_SEASON/);
assert.match(tournament, /r4\.CONFIRMATION_SEASONS/);
assert.match(tournament, /largestWinIndependentEachSeason/);
assert.match(tournament, /bootstrapPositiveProbability/);
assert.match(tournament, /"historicalLeanCandidateAccepted": accepted/);
assert.match(tournament, /"bestAngleAuthorized": False/);
assert.match(tournament, /"productionAuthorized": False/);
assert.match(tournament, /no weekly cap or forced minimum/);

assert.match(scorer, /nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r6/);
assert.match(scorer, /shared_scorer\.main/);
assert.match(scorer, /fixed_policy=EXPECTED_POLICY/);
assert.match(scorer, /quarterback confirmation is a health hold/);
assert.match(sharedScorer, /other_book_consensus/);
assert.match(sharedScorer, /low_price, high_price = r4\.PRICE_BANDS\[fixed_policy\.price_band\]/);
assert.match(sharedScorer, /"productionActionable": False/);
assert.match(sharedScorer, /"publicationEnabled": False/);
assert.match(sharedScorer, /"trackingEnabled": False/);

assert.match(audit, /best currently evidenced Lean candidate/);
assert.match(audit, /-3\.37% to \+18\.34%/);
assert.match(audit, /\+1 shadow promotion, 0 shadow demotions/);
assert.match(audit, /9 moneyline promotions and 0/);
assert.match(audit, /32 are\s+projected and 0 confirmed/);
assert.match(audit, /Production remains 0 actionable/);
assert.match(audit, /Outcome confidence\/likely winner remains separate/);

const tournamentReportPath = path.join(
  root,
  "football-research/reports/nfl_market_led_best_available_tournament_2026_08_22_r6.json",
);
if (fs.existsSync(tournamentReportPath)) {
  const report = JSON.parse(fs.readFileSync(tournamentReportPath, "utf8"));
  assert.equal(report.localOnly, true);
  assert.equal(report.shadowOnly, true);
  assert.equal(report.selection2023.policy.maximum_actions_per_week, null);
  assert.equal(report.selection2023.policy.price_band, "all_bounded");
  assert.equal(report.selection2023.actions, 120);
  assert.ok(Math.abs(report.selection2023.units - 18.77332419046306) < 1e-10);
  assert.equal(report.confirmation2024To2025.actions, 252);
  assert.ok(Math.abs(report.confirmation2024To2025.bySeason["2024"].units - 14.179451290831949) < 1e-10);
  assert.ok(Math.abs(report.confirmation2024To2025.bySeason["2025"].units - 4.764454545172805) < 1e-10);
  assert.ok(report.confirmationLargestWinSensitivity["2024"].unitsWithoutLargestWin > 0);
  assert.ok(report.confirmationLargestWinSensitivity["2025"].unitsWithoutLargestWin > 0);
  assert.ok(report.confirmationUncertainty.roiCi95[0] < 0);
  assert.ok(report.confirmationUncertainty.roiCi95[1] > 0);
  assert.equal(Object.values(report.gates).every(Boolean), true);
  assert.equal(report.historicalLeanCandidateAccepted, true);
  assert.equal(report.bestAngleAuthorized, false);
  assert.equal(report.productionAuthorized, false);
  assert.equal(report.boardImpact.productionPromotions, 0);
  assert.equal(report.boardImpact.productionDemotions, 0);
}

const forwardReportPath = path.join(
  root,
  "football-research/reports/nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r6.json",
);
if (fs.existsSync(forwardReportPath)) {
  const report = JSON.parse(fs.readFileSync(forwardReportPath, "utf8"));
  assert.equal(report.games.length, 16);
  assert.equal(report.boardCounts.shadowLeanCandidates, 9);
  assert.equal(report.boardCounts.productionActionable, 0);
  assert.equal(report.boardCounts.betGradeHeld, 16);
  assert.equal(report.boardImpact.relativeToComparisonShadow.promotions, 1);
  assert.equal(report.boardImpact.relativeToComparisonShadow.demotions, 0);
  assert.deepEqual(report.boardImpact.relativeToComparisonShadow.promotedMatchups, ["WSH@PHI"]);
  assert.equal(report.boardImpact.relativeToProductionHeld.proposedShadowPromotions, 9);
  assert.equal(report.boardImpact.relativeToProductionHeld.appliedProductionPromotions, 0);
  assert.equal(report.health.matchedExpectedQuarterbacks, 32);
  assert.equal(report.health.projectedExpectedQuarterbacks, 32);
  assert.equal(report.health.confirmedExpectedQuarterbacks, 0);
  const candidates = report.games.filter((game: { decision: { shadowCandidate: boolean } }) =>
    game.decision.shadowCandidate);
  assert.equal(candidates.length, 9);
  assert.ok(candidates.some((game: { selectedMoneyline: { team: string; americanPrice: number } }) =>
    game.selectedMoneyline.team === "PHI" && game.selectedMoneyline.americanPrice === -205));
  for (const game of report.games) {
    assert.equal(game.decision.productionActionable, false);
    assert.equal(game.decision.decisionTimestamp, game.selectedMoneyline.quoteObservedAt);
    assert.ok(game.selectedMoneyline.otherBookCount >= 2);
    assert.ok(game.selectedMoneyline.modelProbability > 0);
    assert.ok(game.selectedMoneyline.modelProbability < 1);
    assert.ok(game.selectedMoneyline.otherBooksConsensusFairProbability > 0);
    assert.ok(game.selectedMoneyline.otherBooksConsensusFairProbability < 1);
  }
}

console.log("NFL r6 best-available shadow policy, evidence, and no-production boundaries passed.");
