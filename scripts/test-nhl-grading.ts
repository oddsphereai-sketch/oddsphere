import assert from "node:assert/strict";
import {
  gradeMoneyline,
  gradeSpread,
  gradeTotal,
} from "../lib/services/nhl/gradeNhlPredictions";
import { nhlVerdictFromStoredDecision } from "../lib/services/nhl/buildNhlDailyEdgeAdapted";

assert.equal(gradeMoneyline("home", 4, 2), "win");
assert.equal(gradeMoneyline("away", 4, 2), "loss");
assert.equal(gradeMoneyline("home", null, 2), "pending");

assert.equal(gradeTotal("over", 5.5, 4, 2), "win");
assert.equal(gradeTotal("under", 5.5, 4, 2), "loss");
assert.equal(gradeTotal("over", 6, 4, 2), "push");
assert.equal(gradeTotal("over", null, 4, 2), "pending");

assert.equal(gradeSpread("home", -1.5, 4, 2), "win");
assert.equal(gradeSpread("away", 1.5, 4, 2), "loss");
assert.equal(gradeSpread("away", 2, 4, 2), "push");
assert.equal(gradeSpread("home", null, 4, 2), "void");
assert.equal(gradeSpread("home", -1.5, null, 2), "pending");

assert.equal(nhlVerdictFromStoredDecision("best_signal", false), "best_angle");
assert.equal(nhlVerdictFromStoredDecision("model_only", false), "lean");
assert.equal(nhlVerdictFromStoredDecision("model_only", true), "pass");
assert.equal(nhlVerdictFromStoredDecision("market_watch", false), "watchlist");

console.log("NHL grading tests: PASS");
