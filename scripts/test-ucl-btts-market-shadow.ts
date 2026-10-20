import assert from "node:assert/strict";
import type { EplForwardBookVector } from "../lib/services/epl/eplForwardEvidenceCapture";
import { deriveUclCoherentMarketOutcome } from "../lib/services/ucl/uclCoherentMarketOutcome";
import { deriveUclBttsMarketShadow, UCL_BTTS_MARKET_SHADOW_RELEASE, type UclBttsHistoryObservation } from "../lib/services/ucl/uclBttsMarketShadow";

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

function american(probability: number): number {
  return Math.round(probability <= 0.5 ? (1 / probability - 1) * 100 : -100 * probability / (1 - probability));
}

function history(book: string, yes: number, providerId = 1): UclBttsHistoryObservation[] {
  return [
    { providerId, market: "btts", side: "yes", american: american(yes), sportsbook: book, recordedAt: "2026-10-20T14:00:00.000Z" },
    { providerId, market: "btts", side: "no", american: american(1 - yes), sportsbook: book, recordedAt: "2026-10-20T14:00:00.000Z" },
  ];
}

const thinEvidence = { homeStatMatches: 2, awayStatMatches: 2, homeXgMatches: 2, awayXgMatches: 2, promotedProxy: false };

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
assert.equal(shadow.lane, "conflicted");
assert.equal(shadow.modelEvidenceQuality, "thin");

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

const opposingMovement = ["betmgm", "betonline", "fanduel"].flatMap((book) => history(book, 0.52));
const conflicted = deriveUclBttsMarketShadow({
  modelYes: 0.68,
  vectors: [vector("pinnacle", 0.49), vector("betmgm", 0.45), vector("fanduel", 0.46), vector("betonline", 0.47)],
  evaluatedBook: "pinnacle",
  evaluatedPrices: { yes: 102, no: -124 },
  providerEventId: "event-1",
  providerId: 1,
  history: opposingMovement,
  modelEvidence: thinEvidence,
  decisionAt,
  kickoff,
});
assert.equal(conflicted.lane, "conflicted");
assert.equal(conflicted.movementSide, "no");
assert.equal(conflicted.movementCorroboratesConsensus, true);
assert.equal(conflicted.currentVerdict, "lean");
assert.equal(conflicted.candidateVerdict, "watchlist");
assert.equal(conflicted.gradeEffect, "demotion");

const closeCorrection = deriveUclBttsMarketShadow({
  modelYes: 0.52,
  vectors: [vector("pinnacle", 0.49), vector("betmgm", 0.45), vector("fanduel", 0.46), vector("betonline", 0.47)],
  evaluatedBook: "pinnacle",
  evaluatedPrices: { yes: 105, no: -125 },
  providerEventId: "event-1",
  providerId: 1,
  history: opposingMovement,
  modelEvidence: thinEvidence,
  decisionAt,
  kickoff,
});
assert.equal(closeCorrection.lane, "corrected");
assert.equal(closeCorrection.candidateSide, "no");
assert.ok(closeCorrection.authority <= 0.45);

const supportingMovement = ["betmgm", "betonline", "fanduel"].flatMap((book) => history(book, 0.53));
const alignedPromotion = deriveUclBttsMarketShadow({
  modelYes: 0.52,
  vectors: [vector("pinnacle", 0.51), vector("betmgm", 0.59), vector("fanduel", 0.60), vector("betonline", 0.61)],
  evaluatedBook: "pinnacle",
  evaluatedPrices: { yes: 100, no: -120 },
  providerEventId: "event-1",
  providerId: 1,
  history: supportingMovement,
  modelEvidence: thinEvidence,
  decisionAt,
  kickoff,
});
assert.equal(alignedPromotion.lane, "aligned");
assert.equal(alignedPromotion.movementSide, "yes");
assert.equal(alignedPromotion.currentVerdict, "no_play");
assert.equal(alignedPromotion.candidateVerdict, "lean");
assert.equal(alignedPromotion.gradeEffect, "promotion");

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

console.log("UCL BTTS market shadow: target exclusion, movement, three lanes, symmetric grades, chronology, and production isolation passed.");
