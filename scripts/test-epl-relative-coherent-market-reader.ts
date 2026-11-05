import assert from "node:assert/strict";
import { deriveEplCoherentMarketOutcome, EPL_COHERENT_MARKET_OUTCOME_RELEASE } from "../lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "../lib/services/epl/eplForwardEvidenceCapture";
import type { EplStoredPriceObservation } from "../lib/services/epl/buildEplDailyEdgePreview";
import { deriveSoccerMarketProbabilities } from "../lib/services/soccer/soccerMarketProbabilities";
import { deriveEplPreviewGrade } from "../lib/services/epl/eplPreviewGrade";
import { deriveEplR23IncumbentOutcome, EPL_R23_INCUMBENT_OUTCOME_RELEASE } from "./operator/epl-r23-incumbent-outcome";
import { readFileSync } from "node:fs";

const baselineAt = "2026-11-04T12:00:00Z";
const currentAt = "2026-11-04T15:00:00Z";
const decisionAt = "2026-11-04T15:05:00Z";
const kickoff = "2026-11-04T20:00:00Z";
const american = (p: number) => p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const sides = (market: "match_result" | "total" | "btts") => market === "match_result"
  ? ["home", "draw", "away"] : market === "total" ? ["over", "under"] : ["yes", "no"];
function vector(market: "match_result" | "total" | "btts", probabilities: number[], book = "pinnacle", at = currentAt): EplForwardBookVector {
  return { identity: `owls:${market}:${book}:${at}`, provider: "owls", providerEndpoint: "/odds", providerEventId: "evt",
    sportsbook: book, canonicalBook: book, sourceClass: book === "pinnacle" ? "named_originator" : "named_retail",
    market, line: market === "total" ? 2.5 : null, capturedAt: decisionAt, fetchedAtMin: at, fetchedAtMax: at,
    vectorSkewMs: 0, overround: 1, probabilityTotal: 1,
    outcomes: sides(market).map((side, index) => ({ side, american: american(probabilities[index]!), decimal: 1 / probabilities[index]!,
      rawImpliedProbability: probabilities[index]!, noVigProbability: probabilities[index]!, fetchedAt: at, fetchedAtSource: "provider" })) };
}
function history(v: EplForwardBookVector, at = baselineAt): EplStoredPriceObservation[] {
  return v.outcomes.map(outcome => ({ providerId: 41, market: v.market as "match_result" | "total" | "btts", side: outcome.side,
    line: v.line, american: outcome.american, sportsbook: v.canonicalBook, recordedAt: at, isOpener: false }));
}
const input = { matchId: 41, independentLambdaHome: 1.65, independentLambdaAway: 1.05,
  evaluatedMatchResultCanonicalBook: "caesars", evaluatedTotalCanonicalBook: "caesars", evaluatedBttsCanonicalBook: "caesars",
  providerEventId: "evt", decisionAt, kickoff };
const baseline = deriveEplCoherentMarketOutcome({ ...input, totalVectors: [] });
assert.equal(baseline.release, EPL_COHERENT_MARKET_OUTCOME_RELEASE);
const incumbentBaseline = deriveEplR23IncumbentOutcome({ ...input, totalVectors: [] });
assert.equal(incumbentBaseline.release, EPL_R23_INCUMBENT_OUTCOME_RELEASE);
assert.equal(incumbentBaseline.source, "independent_club_pmf");
const draw = deriveEplCoherentMarketOutcome({ ...input, independentLambdaHome: 0.75, independentLambdaAway: 0.95, totalVectors: [] });
assert.equal(draw.audit.drawCalibration?.status, "applied");
assert.ok(draw.markets.match_result.draw >= draw.markets.match_result.home - 1e-9);
assert.ok(draw.markets.match_result.draw >= draw.markets.match_result.away - 1e-9);
assert.equal(draw.source, "independent_draw_calibrated_pmf", "draw handling must live inside the same PMF, not override its side afterward");

const before = vector("match_result", [0.58, 0.24, 0.18]);
const current = vector("match_result", [0.30, 0.25, 0.45]);
const moved = deriveEplCoherentMarketOutcome({ ...input, matchResultVectors: [current], totalVectors: [], storedPriceHistory: history(before) });
assert.equal(moved.source, "relative_same_book_market_paths");
assert.equal(moved.audit.goalsReader?.relativeMarketReader?.markets.match_result.status, "applied");
assert.notDeepEqual(moved.joint, baseline.joint, "qualified relative innovation must update the one score law");

const derived = deriveSoccerMarketProbabilities({ joint: moved.joint, totalLine: 2.5 });
assert.deepEqual(moved.markets, derived, "every published soccer market must be derived from the final joint PMF");
assert.equal(moved.markets.double_chance.home_or_draw, moved.markets.match_result.home + moved.markets.match_result.draw);
const expectedHome = moved.joint.reduce((sum, row, home) => sum + row.reduce((mass, p) => mass + home * p, 0), 0);
const expectedAway = moved.joint.reduce((sum, row) => sum + row.reduce((mass, p, away) => mass + away * p, 0), 0);
assert.ok(Math.abs(moved.expectedGoals.home - expectedHome) < 1e-12 && Math.abs(moved.expectedGoals.away - expectedAway) < 1e-12);

const excludedBefore = vector("match_result", [0.7, 0.2, 0.1], "caesars");
const excludedCurrent = vector("match_result", [0.1, 0.2, 0.7], "caesars");
const excluded = deriveEplCoherentMarketOutcome({ ...input, matchResultVectors: [excludedCurrent], totalVectors: [], storedPriceHistory: history(excludedBefore) });
assert.deepEqual(excluded.joint, baseline.joint, "the evaluated execution book cannot become forecast evidence");

const wrongEvent = { ...current, providerEventId: "other", identity: `${current.identity}:wrong` };
const wrongIdentity = deriveEplCoherentMarketOutcome({ ...input, matchResultVectors: [wrongEvent], totalVectors: [], storedPriceHistory: history(before) });
assert.deepEqual(wrongIdentity.joint, baseline.joint);
const future = vector("match_result", [0.3, 0.25, 0.45], "pinnacle", "2026-11-04T15:06:00Z");
assert.deepEqual(deriveEplCoherentMarketOutcome({ ...input, matchResultVectors: [future], totalVectors: [], storedPriceHistory: history(before) }).joint, baseline.joint);

const mirrored = deriveEplCoherentMarketOutcome({ ...input, independentLambdaHome: input.independentLambdaAway,
  independentLambdaAway: input.independentLambdaHome, matchResultVectors: [vector("match_result", [0.45, 0.25, 0.30])],
  totalVectors: [], storedPriceHistory: history(vector("match_result", [0.18, 0.24, 0.58])) });
assert.ok(Math.abs(moved.markets.match_result.home - mirrored.markets.match_result.away) < 1e-9);
assert.ok(Math.abs(moved.markets.match_result.away - mirrored.markets.match_result.home) < 1e-9);

const conflicting = deriveEplCoherentMarketOutcome({ ...input, matchResultVectors: [current,
  { ...current, identity: `${current.identity}:conflict`, outcomes: vector("match_result", [0.45, 0.25, 0.30]).outcomes }],
  totalVectors: [], storedPriceHistory: history(before) });
assert.deepEqual(conflicting.joint, baseline.joint, "conflicting same-book contract clocks fail closed");

const pairedBoardImpact = {
  promoted: deriveEplPreviewGrade({ market: "total", modelProbability: 0.56, edgePp: 6, priceAmerican: 100,
    coherentMarket: true, promotedProxy: false }).verdict.key,
  demoted: deriveEplPreviewGrade({ market: "total", modelProbability: 0.52, edgePp: 1, priceAmerican: 100,
    coherentMarket: true, promotedProxy: false }).verdict.key,
};
assert.deepEqual(pairedBoardImpact, { promoted: "lean", demoted: "no_play" },
  "the unchanged final-PMF grade policy retains both a tested promotion and a tested demotion path");

const operator = readFileSync("scripts/operator/audit-epl-current-release-impact.ts", "utf8");
assert.match(operator, /writes: 0/);
assert.match(operator, /auditDecisionAt: decisionAt/g);
assert.match(operator, /new ExactReplayProvider\(recorder\.records\)/);
assert.doesNotMatch(operator, /\b(?:upsert|insert|delete)\s*\(|\.update\s*\(\s*\{/i,
  "release comparison must remain SELECT/provider-read only");

console.log("EPL target-excluded relative-path identity, time, conflict, symmetry, and coherent-PMF checks passed.");
