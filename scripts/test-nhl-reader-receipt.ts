import assert from "node:assert/strict";
import {
  NHL_READER_RECEIPT_MAX_BYTES,
  NHL_READER_RECEIPT_RELEASE,
  NHL_READER_RECEIPT_SCHEMA_VERSION,
  buildNhlReaderReceipt,
  canonicalNhlReaderReceiptJson,
  decodeNhlReaderReceipt,
  hashNhlReaderReceiptBody,
  type NhlReaderMarketReceipt,
  type NhlReaderReceiptBody,
} from "../lib/services/nhl/nhlReaderReceipt";
import { professionalSectionFromReaderReceipt } from "../lib/services/nhl/buildNhlDailyEdgeAdapted";

const receivedAt = "2026-11-03T18:01:00.000Z";
const capturedAt = "2026-11-03T18:02:00.000Z";
const clock = (sourceObservedAt: string | null) => ({ sourceObservedAt, receivedAt, capturedAt });

function market(
  selectedSide: "home" | "over",
  pick: string,
  interpretation: "confirmation" | "resistance" | "unresolved",
): NhlReaderMarketReceipt {
  const opposingSide = selectedSide === "home" ? "away" : "under";
  const selected = {
    sportsbook: "circa",
    side: selectedSide,
    line: selectedSide === "home" ? null : 6.5,
    american: -110,
    clock: clock("2026-11-03T18:00:00.000Z"),
  } as const;
  const opposing = {
    sportsbook: "circa",
    side: opposingSide,
    line: selectedSide === "home" ? null : 6.5,
    american: -110,
    clock: clock("2026-11-03T18:00:00.000Z"),
  } as const;
  return {
    evaluatedQuote: selected,
    opposingQuote: opposing,
    selectedTrail: [{ ...selected, american: -105 }, selected],
    opposingTrail: [{ ...opposing, american: -115 }, opposing],
    lineTrail: selectedSide === "home" ? [] : [selected],
    splits: {
      publicConsensus: {
        family: "public_consensus",
        provider: "playbook",
        sourceBook: null,
        selectedSide,
        selectedMoneyPct: 62,
        selectedBetsPct: 55,
        opposingMoneyPct: 38,
        opposingBetsPct: 45,
        marketLine: selected.line,
        confidence: "medium",
        selectedForPressure: false,
        rejectionReason: "not_selected_for_pressure",
        clock: clock("2026-11-03T17:57:00.000Z"),
      },
      professionalBooks: [{
        family: "professional_book",
        provider: "owls",
        sourceBook: "circa",
        selectedSide,
        selectedMoneyPct: 67,
        selectedBetsPct: 52,
        opposingMoneyPct: 33,
        opposingBetsPct: 48,
        marketLine: selected.line,
        confidence: "high",
        selectedForPressure: false,
        rejectionReason: "stale_observation",
        clock: clock("2026-11-03T17:59:00.000Z"),
      }, {
        family: "professional_book",
        provider: "owls",
        sourceBook: "draftkings",
        selectedSide,
        selectedMoneyPct: 64,
        selectedBetsPct: 51,
        opposingMoneyPct: 36,
        opposingBetsPct: 49,
        marketLine: selected.line,
        confidence: "high",
        selectedForPressure: true,
        rejectionReason: null,
        clock: clock("2026-11-03T18:00:00.000Z"),
      }],
    },
    consideredPaths: [{
      sportsbook: "circa",
      sourceClass: "named",
      state: "stable",
      direction: selectedSide,
      selected: true,
      rejectionReason: null,
      openingCoordinate: 0.50,
      currentCoordinate: 0.53,
      netMove: 0.03,
      latestLeg: 0.01,
      clock: clock("2026-11-03T18:00:00.000Z"),
    }, {
      sportsbook: "pinnacle",
      sourceClass: "named",
      state: "buyback",
      direction: null,
      selected: false,
      rejectionReason: "buyback",
      openingCoordinate: 0.50,
      currentCoordinate: 0.505,
      netMove: 0.005,
      latestLeg: -0.02,
      clock: clock("2026-11-03T17:58:00.000Z"),
    }],
    interpretation: {
      state: interpretation,
      side: interpretation === "unresolved" ? null : selectedSide,
      pressureBasis: interpretation === "unresolved" ? null : "money_differential",
      authoritySource: interpretation === "unresolved" ? "independent" : "market_episode",
      observedInnovation: interpretation === "unresolved" ? null : 0.03,
      appliedInnovation: interpretation === "unresolved" ? 0 : 0.03,
      selectedMoveAt: interpretation === "unresolved" ? null : "2026-11-03T18:00:00.000Z",
      reasonCodes: interpretation === "unresolved" ? ["named_paths_conflict"] : ["later_named_response"],
    },
    before: { awayScore: 2.9, homeScore: 3.1, pick, probability: 0.54, verdict: "watchlist" },
    after: { awayScore: 2.85, homeScore: 3.15, pick, probability: 0.56, verdict: "lean" },
  };
}

const body: NhlReaderReceiptBody = {
  schemaVersion: NHL_READER_RECEIPT_SCHEMA_VERSION,
  release: NHL_READER_RECEIPT_RELEASE,
  capturedAt,
  cutoffAt: capturedAt,
  identity: {
    gameId: 123,
    externalId: 2026020123,
    slateDate: "2026-11-03",
    gameStartAt: "2026-11-03T23:00:00.000Z",
    awayAbbr: "NYR",
    homeAbbr: "NJD",
    lockBoundaryAt: "2026-11-03T23:00:00.000Z",
  },
  modelRelease: {
    modelVersion: "nhl_model_test",
    calibrationVersion: "nhl_calibration_test",
    decisionVersion: "nhl_decision_test",
  },
  markets: {
    moneyline: market("home", "NJD ML", "confirmation"),
    total: market("over", "OVER 6.5", "resistance"),
    spread: market("home", "NJD -1.5", "unresolved"),
  },
  finalDecision: {
    independentAwayGoals: 2.9,
    independentHomeGoals: 3.1,
    finalAwayGoals: 2.85,
    finalHomeGoals: 3.15,
  },
};

const receipt = buildNhlReaderReceipt(body);
assert.equal(receipt.receiptHash, hashNhlReaderReceiptBody(body));
assert.equal(receipt.receiptHash.length, 64);
const lockedProfessionalDisplay = professionalSectionFromReaderReceipt(receipt.markets.moneyline, "NJD", "NYR");
assert.equal(lockedProfessionalDisplay?.sourceBook, "draftkings", "locked display uses the selected fresh pressure source");
assert.equal(lockedProfessionalDisplay?.rows.some((row) => row.isStale), false);
const conflictMarket: NhlReaderMarketReceipt = {
  ...receipt.markets.moneyline,
  splits: {
    ...receipt.markets.moneyline.splits,
    professionalBooks: receipt.markets.moneyline.splits.professionalBooks.map((split) => ({
      ...split,
      selectedForPressure: false,
      rejectionReason: "professional_conflict",
    })),
  },
};
const conflictDisplay = professionalSectionFromReaderReceipt(conflictMarket, "NJD", "NYR");
assert.equal(
  conflictDisplay?.sourceBook,
  "circa",
  "fresh conflicting splits stay visible while their numerical-authority veto remains frozen separately",
);

const reordered = {
  finalDecision: body.finalDecision,
  markets: {
    spread: body.markets.spread,
    total: body.markets.total,
    moneyline: body.markets.moneyline,
  },
  cutoffAt: body.cutoffAt,
  capturedAt: body.capturedAt,
  identity: body.identity,
  modelRelease: body.modelRelease,
  release: body.release,
  schemaVersion: body.schemaVersion,
} as NhlReaderReceiptBody;
assert.equal(
  hashNhlReaderReceiptBody(reordered),
  receipt.receiptHash,
  "canonical hash is invariant to object insertion order",
);
assert.equal(canonicalNhlReaderReceiptJson(body), canonicalNhlReaderReceiptJson(reordered));

const stored = JSON.parse(JSON.stringify(receipt));
const decoded = decodeNhlReaderReceipt(stored);
assert.equal(decoded.status, "valid");
if (decoded.status === "valid") assert.deepEqual(decoded.receipt, receipt, "stored JSON round-trips exactly");

assert.deepEqual(decodeNhlReaderReceipt(stored, {
  ...body.identity,
  ...body.modelRelease,
  gameId: 999,
}), {
  status: "invalid",
  receipt: null,
  reason: "identity_mismatch",
}, "a valid whole receipt cannot be substituted onto another game");

const mutated = structuredClone(stored);
mutated.finalDecision.finalHomeGoals = 8.25;
assert.deepEqual(decodeNhlReaderReceipt(mutated), {
  status: "invalid",
  receipt: null,
  reason: "hash_mismatch",
}, "any locked decision mutation is detected");

assert.deepEqual(decodeNhlReaderReceipt(null), {
  status: "absent",
  receipt: null,
  reason: "legacy_or_unwritten",
}, "legacy snapshots without a receipt remain explicitly absent");

const splits = receipt.markets.moneyline.splits;
assert.equal(splits.publicConsensus?.family, "public_consensus");
assert.equal(splits.publicConsensus?.provider, "playbook");
assert.equal(splits.publicConsensus?.clock.sourceObservedAt, "2026-11-03T17:57:00.000Z");
assert.equal(splits.professionalBooks[0]?.family, "professional_book");
assert.equal(splits.professionalBooks[0]?.sourceBook, "circa");
assert.equal(splits.professionalBooks[0]?.clock.sourceObservedAt, "2026-11-03T17:59:00.000Z");
assert.notEqual(
  splits.publicConsensus?.clock.sourceObservedAt,
  splits.professionalBooks[0]?.clock.sourceObservedAt,
  "public and professional split families retain distinct evidence clocks",
);

const oversizedBody = structuredClone(body);
oversizedBody.markets.moneyline.interpretation.reasonCodes = ["x".repeat(NHL_READER_RECEIPT_MAX_BYTES)];
assert.throws(
  () => buildNhlReaderReceipt(oversizedBody),
  /exceeds/,
  "the immutable receipt has an enforced serialized size ceiling",
);

console.log("NHL immutable reader receipt: canonical hash, mutation detection, legacy absence, distinct split clocks, exact round-trip and size ceiling passed.");
