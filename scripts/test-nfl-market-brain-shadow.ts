import assert from "node:assert/strict";

import type { NflFullGameEvidenceLedger, NflFullGameEvidenceSignal } from
  "@/lib/services/football/nflFullGameEvidenceLedger";
import { NFL_FULL_GAME_EVIDENCE_LEDGER_RELEASE } from
  "@/lib/services/football/nflFullGameEvidenceLedger";
import { buildNflMarketBrainShadow } from "@/lib/services/football/nflMarketBrainShadow";
import {
  MARKET_BRAIN_CONTRACT_RELEASE,
  validateMarketBrainArtifact,
  type MarketBrainArtifact,
} from "@/lib/services/marketBrain/marketBrainContract";

const evaluatedAt = "2026-10-26T20:00:00.000Z";
const baseSignal = (overrides: Partial<NflFullGameEvidenceSignal> & Pick<NflFullGameEvidenceSignal, "id">):
NflFullGameEvidenceSignal => {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: "availability",
    market: "game",
    source: "unknown",
    targetExcluded: null,
    observedAt: evaluatedAt,
    status: "usable",
    side: null,
    value: null,
    continuousMagnitude: null,
    disposition: "uncertainty",
    reason: "fixture",
    submittedTo: "full_game_evidence_arbiter",
    influenceClass: "uncertainty",
    ...rest,
  };
};

const signals: NflFullGameEvidenceSignal[] = [
  baseSignal({
    id: "forecast",
    kind: "forecast_expert",
    market: "moneyline",
    source: "independent_exact",
    side: "home",
    value: 2.5,
    continuousMagnitude: 2.5,
    disposition: "supports",
    influenceClass: "forecast_candidate",
  }),
  baseSignal({
    id: "market-moneyline",
    kind: "target_excluded_market",
    market: "moneyline",
    source: "target_excluded_market_consensus",
    targetExcluded: true,
    side: "home",
    value: 0.54,
    continuousMagnitude: 0.04,
    disposition: "supports",
    influenceClass: "continuous_market_evidence",
  }),
  baseSignal({
    id: "market-spread",
    kind: "target_excluded_market",
    market: "spread",
    source: "target_excluded_market_consensus",
    targetExcluded: true,
    side: "away",
    value: -3,
    continuousMagnitude: 0.5,
    disposition: "resists",
    influenceClass: "continuous_market_evidence",
  }),
  baseSignal({
    id: "market-total",
    kind: "target_excluded_market",
    market: "total",
    source: "target_excluded_market_consensus",
    targetExcluded: true,
    side: "under",
    value: 44.5,
    continuousMagnitude: 1.5,
    disposition: "resists",
    influenceClass: "continuous_market_evidence",
  }),
  baseSignal({
    id: "circa-path",
    kind: "book_trail",
    market: "moneyline",
    source: "circa",
    sourceClass: "named",
    targetExcluded: true,
    observedAt: "2026-10-26T19:58:00.000Z",
    side: "home",
    value: 0.56,
    continuousMagnitude: 0.015,
    disposition: "supports",
    influenceClass: "continuous_market_evidence",
    marketObservation: {
      openingAt: "2026-10-26T16:00:00.000Z",
      currentAt: "2026-10-26T19:58:00.000Z",
      firstNumberMoveAt: null,
      firstPriceMoveAt: "2026-10-26T17:00:00.000Z",
      lastEconomicMoveAt: "2026-10-26T19:58:00.000Z",
      openingNumber: null,
      currentNumber: null,
      numberDelta: null,
      openingFairFirstProbability: 0.545,
      currentFairFirstProbability: 0.56,
      fairProbabilityDeltaPp: 1.5,
      holdDeltaPp: -0.2,
      numberDirection: null,
      priceDirection: 1,
    },
    marketPath: {
      persistenceTimeShare: 0.61,
      reversalMagnitude: 0.2,
      buybackToOpening: false,
      moveOrder: "price_only",
      crossedKeyNumbers: [],
    },
  }),
  baseSignal({
    id: "small-public-split",
    kind: "split",
    market: "moneyline",
    source: "public_consensus",
    targetExcluded: true,
    observedAt: "2026-10-26T19:59:00.000Z",
    side: "away",
    value: -1,
    continuousMagnitude: 1,
    disposition: "resists",
    influenceClass: "continuous_market_evidence",
    splitContext: {
      ageMinutes: 1,
      moneyPct: 49,
      ticketPct: 50,
      booksUsed: 1,
      exactLineMatched: true,
      denominatorKnown: false,
      qualifiedForDirection: false,
    },
  }),
  baseSignal({
    id: "missing-sharp-split",
    kind: "split",
    market: "moneyline",
    source: "sharpapi",
    targetExcluded: true,
    observedAt: null,
    status: "unavailable",
    side: null,
    value: null,
    continuousMagnitude: null,
    disposition: "unavailable",
    reason: "source_not_available",
    influenceClass: "data_quality",
  }),
  baseSignal({
    id: "weather-missing",
    source: "weather",
    status: "unavailable",
    observedAt: null,
    value: 0,
    disposition: "unavailable",
    influenceClass: "data_quality",
  }),
];

const ledger: NflFullGameEvidenceLedger = {
  release: NFL_FULL_GAME_EVIDENCE_LEDGER_RELEASE,
  evaluatedAt,
  finalAxes: {
    homeMargin: 2.5,
    total: 46,
    moneylineSide: "home",
    spreadSide: "home",
    totalSide: "over",
  },
  marketContexts: {
    moneyline: {
      namedDirection: 1,
      namedLeadCompletedAt: "2026-10-26T17:00:00.000Z",
      followerSources: [],
      followerDelaysMinutes: [],
      resistance: "flow_resistance",
    },
    spread: {
      namedDirection: -1,
      namedLeadCompletedAt: "2026-10-26T17:15:00.000Z",
      followerSources: [],
      followerDelaysMinutes: [],
      resistance: "none",
    },
    total: {
      namedDirection: -1,
      namedLeadCompletedAt: null,
      followerSources: [],
      followerDelaysMinutes: [],
      resistance: "book_disagreement",
    },
  },
  signals,
  accounting: {
    captured: signals.length,
    usable: signals.filter((signal) => signal.status === "usable").length,
    accountedUsable: signals.filter((signal) => signal.status === "usable").length,
    supports: 3,
    resists: 3,
    uncertainty: 0,
    stale: 0,
    unavailable: 2,
    allUsableAccounted: true,
  },
};

const unchanged = JSON.stringify(ledger);
const targetMarket = {
  homeSpread: -3.5,
  total: 45.5,
  homeMoneylineFairProbability: 0.52,
};
const shadow = buildNflMarketBrainShadow({ eventId: "nfl-fixture", ledger, targetMarket });

assert.equal(JSON.stringify(ledger), unchanged, "the shadow adapter cannot mutate its source ledger");
assert.equal(shadow.case.release, MARKET_BRAIN_CONTRACT_RELEASE);
assert.equal(shadow.case.mode, "shadow");
assert.equal(shadow.case.visibility, "internal_only");
assert.equal(shadow.case.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.case.invariants.lockedRecordMutationAllowed, false);
assert.equal(shadow.decision.status, "capture_only");
assert.equal(shadow.decision.productionApplied, false);
assert.equal(shadow.decision.candidate, null);
assert.deepEqual(shadow.decision.baseline, { homeMargin: 2.5, total: 46 });
assert.equal(shadow.case.observations.length, signals.length, "every ledger signal must survive the adapter");
assert.deepEqual(shadow.case.targetMarket, targetMarket);
assert.deepEqual(shadow.case.targetExcludedMarket, {
  homeMargin: -3,
  total: 44.5,
  homeMoneylineFairProbability: 0.54,
});

const smallSplit = shadow.case.observations.find((row) => row.id === "small-public-split");
assert.ok(smallSplit);
assert.deepEqual(smallSplit.features.split_gap_pp, { value: -1, observed: 1 },
  "a sub-threshold split remains continuous evidence");
assert.ok(smallSplit.tags.includes("legacy_split_qualified:false"),
  "the old qualification is provenance, not a new-brain authority gate");
assert.equal(smallSplit.denominatorKnown, false);
assert.equal(smallSplit.exactLineMatched, true);

const missingSplit = shadow.case.observations.find((row) => row.id === "missing-sharp-split");
assert.ok(missingSplit);
assert.equal(missingSplit.availability, "unavailable");
assert.deepEqual(missingSplit.features.split_gap_pp, { value: null, observed: 0 },
  "missing SharpAPI evidence must not masquerade as a zero gap");
assert.equal(shadow.case.coverage.split.observed, 1);
assert.equal(shadow.case.coverage.split.unavailable, 1);

assert.equal(shadow.case.observations.find((row) => row.id === "market-moneyline")?.axis, "margin");
assert.equal(shadow.case.observations.find((row) => row.id === "market-spread")?.axis, "margin");
assert.equal(shadow.case.observations.find((row) => row.id === "market-total")?.axis, "total");

const reversed = buildNflMarketBrainShadow({
  eventId: "nfl-fixture",
  ledger: { ...ledger, signals: [...ledger.signals].reverse() },
  targetMarket,
});
assert.deepEqual(
  shadow.case.observations.map((row) => row.id),
  reversed.case.observations.map((row) => row.id),
  "the canonical case order cannot depend on provider insertion order",
);

const validArtifact: MarketBrainArtifact = {
  release: "fixture_artifact",
  sport: "nfl",
  architecture: "masked_sequence_encoder_joint_margin_total",
  featureContractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
  trainedThrough: "2026-09-30T23:59:59.000Z",
  chronologicalValidation: {
    selectionStartsAt: "2026-10-01T00:00:00.000Z",
    confirmationStartsAt: "2026-10-15T00:00:00.000Z",
    confirmationEndsAt: "2026-10-26T00:00:00.000Z",
    games: 32,
  },
  calibration: {
    marginCalibrated: true,
    totalCalibrated: true,
    flipProbabilityCalibrated: true,
  },
  missingnessRegimesEvaluated: ["no_splits", "public_only", "identified_book_only"],
  sourceAblationsEvaluated: ["without_circa", "without_public_splits"],
  immutableChecksum: "fixture-checksum",
};
assert.deepEqual(validateMarketBrainArtifact(validArtifact), []);
assert.deepEqual(validateMarketBrainArtifact({
  ...validArtifact,
  calibration: { ...validArtifact.calibration, flipProbabilityCalibrated: false },
  missingnessRegimesEvaluated: [],
}), ["incomplete_calibration", "missingness_not_evaluated"]);

console.log("NFL Market Brain shadow contract: continuous evidence, missingness, joint state, and no-authority gate passed");
