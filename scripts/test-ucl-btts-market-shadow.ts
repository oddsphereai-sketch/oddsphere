import assert from "node:assert/strict";
import type { EplForwardBookVector } from "../lib/services/epl/eplForwardEvidenceCapture";
import { deriveUclCoherentMarketOutcome } from "../lib/services/ucl/uclCoherentMarketOutcome";
import { deriveUclBttsMarketShadow, UCL_BTTS_MARKET_SHADOW_RELEASE } from "../lib/services/ucl/uclBttsMarketShadow";

const decisionAt = "2026-10-20T16:00:00.000Z";
const kickoff = "2026-10-20T19:00:00.000Z";

function vector(book: string, yes: number, fetchedAt = "2026-10-20T15:59:00.000Z"): EplForwardBookVector {
  return {
    identity: `${book}:btts`,
    sportsbook: book,
    canonicalBook: book,
    sourceClass: "named_other",
    provider: "sharpapi",
    providerEndpoint: "/odds",
    providerEventId: "event-1",
    market: "btts",
    line: null,
    capturedAt: decisionAt,
    fetchedAtMin: fetchedAt,
    fetchedAtMax: fetchedAt,
    vectorSkewMs: 0,
    overround: 1.05,
    probabilityTotal: 2,
    outcomes: [
      { side: "yes", american: 110, decimal: 2.1, rawImpliedProbability: yes, noVigProbability: yes, fetchedAt, fetchedAtSource: "provider" },
      { side: "no", american: -120, decimal: 1.833, rawImpliedProbability: 1 - yes, noVigProbability: 1 - yes, fetchedAt, fetchedAtSource: "provider" },
    ],
  };
}

const shadow = deriveUclBttsMarketShadow({
  modelYes: 0.68,
  vectors: [vector("pinnacle", 0.49), vector("betmgm", 0.46), vector("fanduel", 0.47), vector("betonline", 0.48)],
  evaluatedBook: "pinnacle",
  providerEventId: "event-1",
  decisionAt,
  kickoff,
});
assert.equal(shadow.release, UCL_BTTS_MARKET_SHADOW_RELEASE);
assert.equal(shadow.productionAuthority, false);
assert.equal(shadow.available, true);
assert.deepEqual(shadow.eligibleBooks, ["betmgm", "betonline", "fanduel"]);
assert.equal(shadow.consensusSide, "no");
assert.ok(shadow.candidateYes < shadow.modelYes);

const thin = deriveUclBttsMarketShadow({
  modelYes: 0.55,
  vectors: [vector("pinnacle", 0.47), vector("betmgm", 0.46), vector("fanduel", 0.48)],
  evaluatedBook: "pinnacle",
  providerEventId: "event-1",
  decisionAt,
  kickoff,
});
assert.equal(thin.available, false);
assert.equal(thin.candidateYes, thin.modelYes);
assert.ok(thin.gateReasons.includes("eligible_target_excluded_books_below_3"));

const postDecision = deriveUclBttsMarketShadow({
  modelYes: 0.55,
  vectors: [vector("a", 0.46, "2026-10-20T16:01:00.000Z"), vector("b", 0.47), vector("c", 0.48)],
  evaluatedBook: null,
  providerEventId: "event-1",
  decisionAt,
  kickoff,
});
assert.equal(postDecision.available, false);
assert.equal(postDecision.eligibleBooks.includes("a"), false);

const coherent = deriveUclCoherentMarketOutcome({
  independentLambdaHome: 1.7,
  independentLambdaAway: 1.1,
  bttsVectors: [vector("pinnacle", 0.49), vector("betmgm", 0.46), vector("fanduel", 0.47), vector("betonline", 0.48)],
  totalVectors: [],
  evaluatedMatchResultCanonicalBook: null,
  evaluatedTotalCanonicalBook: null,
  evaluatedBttsCanonicalBook: "pinnacle",
  providerEventId: "event-1",
  decisionAt,
  kickoff,
});
const control = deriveUclCoherentMarketOutcome({
  independentLambdaHome: 1.7,
  independentLambdaAway: 1.1,
  totalVectors: [],
  evaluatedMatchResultCanonicalBook: null,
  evaluatedTotalCanonicalBook: null,
  evaluatedBttsCanonicalBook: "pinnacle",
  providerEventId: "event-1",
  decisionAt,
  kickoff,
});
assert.equal(coherent.audit.bttsShadow?.available, true);
assert.equal(coherent.markets.btts.yes, control.markets.btts.yes);
assert.deepEqual(coherent.joint, control.joint);

console.log("UCL BTTS market shadow: target exclusion, minimum coverage, chronology, and production isolation passed.");
