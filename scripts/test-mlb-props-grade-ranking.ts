import assert from "node:assert/strict";
import type { PlayerPropPreviewRow } from "../app/mlb/props/components/PlayerPropsDashboard";
import { applyMlbPropsReleasePureGradeRanking } from "../lib/mlb/props/gradeRankingPolicy";

function row(overrides: Partial<PlayerPropPreviewRow>): PlayerPropPreviewRow {
  return {
    id: "row",
    player: "Player",
    team: "PHI",
    opponent: "NYM",
    homeAway: "home",
    gameStartTime: "2026-10-21T23:00:00.000Z",
    market: "batter_runs_scored",
    marketLabel: "Runs Scored",
    marketFamily: "batter",
    offerContract: "two_way",
    marketGroup: "Runs/RBI",
    side: "under",
    line: 0.5,
    odds: -180,
    book: "Book",
    modelProbability: 0.7,
    independentProbability: 0.7,
    marketProbability: 0.6,
    finalProbability: 0.66,
    shrinkageWeight: 0.5,
    modelEdge: 0.06,
    expectedValue: 0.03,
    fairOdds: -194,
    units: 1,
    confidence: 0.8,
    confidenceBucket: "high",
    playGrade: "LEAN",
    source: "test",
    lastUpdated: "2026-10-21T20:00:00.000Z",
    projection: 0.4,
    projectionSource: "model",
    overProbability: 0.34,
    underProbability: 0.66,
    keyFeatures: [],
    missingFeatures: [],
    reasonCodes: ["TARGET_EXCLUDED_MARKET_REFERENCE"],
    oddsSanity: [],
    settlementStatus: "pending",
    clvStatus: "pending",
    ...overrides,
  };
}

const runsScored = row({ id: "runs" });
const [promoted] = applyMlbPropsReleasePureGradeRanking([runsScored]);
assert.equal(promoted.playGrade, "BEST_ANGLE");
assert.equal(promoted.units, runsScored.units);
for (const key of [
  "side", "projection", "modelProbability", "independentProbability",
  "marketProbability", "finalProbability", "odds", "modelEdge",
  "expectedValue", "fairOdds",
] as const) assert.equal(promoted[key], runsScored[key], `${key} changed on promotion`);

const [shortPrice] = applyMlbPropsReleasePureGradeRanking([
  row({ id: "short", odds: -205 }),
]);
assert.equal(shortPrice.playGrade, "LEAN");

for (const candidate of [
  row({
    id: "hrr",
    market: "batter_hits_runs_rbis",
    marketLabel: "Hits + Runs + RBIs",
    playGrade: "BEST_ANGLE",
  }),
  row({
    id: "pitcher-k",
    market: "pitcher_strikeouts",
    marketLabel: "Pitcher Strikeouts",
    marketFamily: "pitcher",
    marketGroup: "Pitcher Strikeouts",
    side: "over",
    playGrade: "BEST_ANGLE",
  }),
]) {
  const [reranked] = applyMlbPropsReleasePureGradeRanking([candidate]);
  assert.equal(reranked.playGrade, "LEAN");
  assert.equal(reranked.units, candidate.units);
  assert.equal(reranked.side, candidate.side);
  assert.equal(reranked.projection, candidate.projection);
  assert.equal(reranked.finalProbability, candidate.finalProbability);
}

const locked = row({
  id: "locked",
  playGrade: "LEAN",
  lockStatus: { status: "locked", lockedAt: "2026-10-21T22:00:00.000Z" },
});
const [preserved] = applyMlbPropsReleasePureGradeRanking([locked]);
assert.equal(preserved, locked, "locked record must retain exact object precedence");

console.log("MLB props release-pure grade-ranking tests passed");
