import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__,
  appendWnbaActionPromotionEvidence,
  normalizeWnbaActionPromotionCycle,
  WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC,
  WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES,
  WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION,
  WNBA_ACTION_PROMOTION_EVIDENCE_KEY,
  WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES,
  WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS,
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
} from "../lib/services/wnba/buildWnbaPredictionRecords";
import { WNBA_DECISION_TUPLE_CONTRACT_VERSION } from "../lib/services/wnba/wnbaDecisionTuple";
import {
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../lib/automodel/wnbaChampionRuntime";

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game_prediction_id: 9481,
    game_id: 481,
    external_id: 900481,
    market: "moneyline",
    side: "away",
    line_value: null,
    odds_american: 120,
    model_probability: 0.49,
    market_probability: 0.45,
    confidence: 49,
    edge: 4,
    play_grade: "lean",
    pick: "SEA",
    published_at: "2026-08-29T19:00:05.000Z",
    tracking_identity: "wnba:481:moneyline",
    snapshot_json: {
      unrelated_candidate_key: { preserved: true },
      market: "moneyline",
      side: "away",
      line: null,
      grade: "Lean",
      model_version: EXPECTED_WNBA_MODEL_VERSION,
      distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
      grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
      prediction_record_contract_version: WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
      decision_tuple_contract_version: WNBA_DECISION_TUPLE_CONTRACT_VERSION,
      decision_tuple: {
        contract_version: WNBA_DECISION_TUPLE_CONTRACT_VERSION,
        market: "moneyline",
        side: "away",
        line: null,
        model_probability: 0.49,
        market_fair_probability: 0.45,
        outcome_confidence: 0.49,
        bet_grade: "Lean",
        evaluated_price_american: 120,
        evaluated_sportsbook: "saba",
        evaluated_at: "2026-08-29T18:59:00.000Z",
        decision_at: "2026-08-29T19:00:00.000Z",
        model_version: EXPECTED_WNBA_MODEL_VERSION,
        distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
        grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
      },
    },
    ...overrides,
  };
}

const sourceComputedAt1 = "2026-08-29T19:24:00.000Z";
const cycle1 = "2026-08-29T19:23:00.000Z";
const captured1 = "2026-08-29T19:24:05.000Z";
const priorSnapshot = {
  unrelated_existing_key: { also_preserved: true },
  grade: "Watchlist",
};
const firstCandidate = candidate();
const first = appendWnbaActionPromotionEvidence({
  existingSnapshot: priorSnapshot,
  candidateRecord: firstCandidate,
  sourceComputedAt: sourceComputedAt1,
  capturedAt: captured1,
});
const firstEvidence = __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__.readWnbaActionPromotionEvidence(first);
assert.ok(firstEvidence);
assert.equal(firstEvidence.contract_version, WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION);
assert.equal(firstEvidence.mode, "shadow_only");
assert.equal(firstEvidence.production_gate_enabled, false);
assert.equal(firstEvidence.canonical_cycle_source, "game_predictions.computed_at");
assert.equal(firstEvidence.cadence_interval_minutes, WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES);
assert.equal(firstEvidence.cadence_anchor_minute_utc, WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC);
assert.equal(firstEvidence.observations.length, 1);
assert.equal(firstEvidence.observations[0]?.cycle_id, cycle1);
assert.equal(firstEvidence.observations[0]?.source_computed_at, sourceComputedAt1);
assert.equal(firstEvidence.observations[0]?.external_id, 900481);
assert.equal(firstEvidence.observations[0]?.actionable, true);
assert.equal(firstEvidence.observations[0]?.offered_price_ev, 0.078);
assert.equal(firstEvidence.observations[0]?.evaluated_sportsbook, "saba");
assert.equal(firstEvidence.observations[0]?.prediction_record_contract_version, WNBA_PREDICTION_RECORD_CONTRACT_VERSION);
assert.deepEqual(first.unrelated_existing_key, priorSnapshot.unrelated_existing_key);
assert.deepEqual(first.unrelated_candidate_key, { preserved: true });

const withoutEvidence = { ...first };
delete withoutEvidence[WNBA_ACTION_PROMOTION_EVIDENCE_KEY];
assert.deepEqual(withoutEvidence, {
  ...priorSnapshot,
  ...(firstCandidate.snapshot_json as Record<string, unknown>),
});
assert.deepEqual(firstCandidate, candidate(), "evidence collection must not mutate the candidate/public record");

const changedSameCycle = candidate({
  odds_american: 105,
  snapshot_json: {
    ...(candidate().snapshot_json as Record<string, unknown>),
    decision_tuple: {
      ...((candidate().snapshot_json as Record<string, unknown>).decision_tuple as Record<string, unknown>),
      evaluated_price_american: 105,
      evaluated_sportsbook: "fanduel",
      evaluated_at: "2026-08-29T19:00:03.000Z",
    },
  },
});
let duplicate = first;
for (const sourceComputedAt of [
  "2026-08-29T19:24:30.000Z",
  "2026-08-29T19:33:00.000Z",
  "2026-08-29T19:43:00.000Z",
  "2026-08-29T19:52:59.999Z",
]) {
  duplicate = appendWnbaActionPromotionEvidence({
    existingSnapshot: duplicate,
    candidateRecord: changedSameCycle,
    sourceComputedAt,
    capturedAt: new Date(Date.parse(sourceComputedAt) + 5_000).toISOString(),
  });
}
assert.deepEqual(
  duplicate[WNBA_ACTION_PROMOTION_EVIDENCE_KEY],
  first[WNBA_ACTION_PROMOTION_EVIDENCE_KEY],
  "same-cycle retry must not advance or rewrite evidence even when retry inputs differ",
);

const stale = appendWnbaActionPromotionEvidence({
  existingSnapshot: duplicate,
  candidateRecord: candidate(),
  sourceComputedAt: "2026-08-29T19:22:59.999Z",
  capturedAt: "2026-08-29T19:01:00.000Z",
});
assert.deepEqual(
  stale[WNBA_ACTION_PROMOTION_EVIDENCE_KEY],
  first[WNBA_ACTION_PROMOTION_EVIDENCE_KEY],
  "stale/out-of-order cycles must be ignored",
);

const rotatedBook = candidate({
  snapshot_json: {
    ...(candidate().snapshot_json as Record<string, unknown>),
    decision_tuple: {
      ...((candidate().snapshot_json as Record<string, unknown>).decision_tuple as Record<string, unknown>),
      evaluated_sportsbook: "betmgm",
      evaluated_at: "2026-08-29T19:52:59.000Z",
      decision_at: "2026-08-29T19:53:00.000Z",
    },
  },
});
const second = appendWnbaActionPromotionEvidence({
  existingSnapshot: first,
  candidateRecord: rotatedBook,
  sourceComputedAt: "2026-08-29T19:53:00.000Z",
  capturedAt: "2026-08-29T19:53:05.000Z",
});
const secondEvidence = __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__.readWnbaActionPromotionEvidence(second);
assert.equal(secondEvidence?.observations.length, 2);
assert.equal(
  secondEvidence?.observations[0]?.economic_equivalence_key,
  secondEvidence?.observations[1]?.economic_equivalence_key,
  "a named-book rotation is economically equivalent only when every economic/release field is exact",
);
assert.notEqual(secondEvidence?.observations[0]?.evidence_identity, secondEvidence?.observations[1]?.evidence_identity);

const gradeOnlyCandidate = candidate({
  play_grade: "watchlist",
  snapshot_json: {
    ...(candidate().snapshot_json as Record<string, unknown>),
    grade: "Watchlist",
    decision_tuple: {
      ...((candidate().snapshot_json as Record<string, unknown>).decision_tuple as Record<string, unknown>),
      bet_grade: "Watchlist",
    },
  },
});
const observe = (candidateRecord: Record<string, unknown>) =>
  __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__.makeWnbaActionPromotionObservation({
    candidateRecord,
    sourceComputedAt: "2026-08-29T20:23:00.000Z",
    capturedAt: "2026-08-29T20:23:05.000Z",
  });
const baselineEconomicKey = firstEvidence.observations[0]?.economic_equivalence_key;
const gradeOnlyObservation = observe(gradeOnlyCandidate);
assert.equal(
  gradeOnlyObservation?.economic_equivalence_key,
  baselineEconomicKey,
  "a grade/actionability-only transition must preserve economic equivalence",
);
assert.notEqual(gradeOnlyObservation?.evidence_identity, firstEvidence.observations[0]?.evidence_identity);

const tuple = (candidate().snapshot_json as Record<string, unknown>).decision_tuple as Record<string, unknown>;
const changedEconomicCandidates: Array<[string, Record<string, unknown>]> = [
  ["price", changedSameCycle],
  ["side", candidate({
    side: "home",
    snapshot_json: { ...(candidate().snapshot_json as Record<string, unknown>), side: "home", decision_tuple: { ...tuple, side: "home" } },
  })],
  ["line", candidate({
    line_value: 1.5,
    snapshot_json: { ...(candidate().snapshot_json as Record<string, unknown>), line: 1.5, decision_tuple: { ...tuple, line: 1.5 } },
  })],
  ["probability", candidate({
    model_probability: 0.5,
    snapshot_json: { ...(candidate().snapshot_json as Record<string, unknown>), decision_tuple: { ...tuple, model_probability: 0.5 } },
  })],
  ["release", candidate({
    snapshot_json: {
      ...(candidate().snapshot_json as Record<string, unknown>),
      grade_policy_version: "wnba_grade_policy_test_other",
      decision_tuple: { ...tuple, grade_policy_version: "wnba_grade_policy_test_other" },
    },
  })],
];
for (const [dimension, changedCandidate] of changedEconomicCandidates) {
  assert.notEqual(
    observe(changedCandidate)?.economic_equivalence_key,
    baselineEconomicKey,
    `a ${dimension} change must reset economic equivalence`,
  );
}

let bounded = first;
for (let index = 1; index <= 50; index += 1) {
  const cycle = new Date(Date.parse(cycle1) + index * 30 * 60 * 1000).toISOString();
  bounded = appendWnbaActionPromotionEvidence({
    existingSnapshot: bounded,
    candidateRecord: candidate(),
    sourceComputedAt: cycle,
    capturedAt: new Date(Date.parse(cycle) + 5_000).toISOString(),
  });
}
const boundedEvidence = __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__.readWnbaActionPromotionEvidence(bounded);
assert.ok(boundedEvidence);
assert.ok(boundedEvidence.observations.length <= WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS);
assert.ok(boundedEvidence.observations.length > 1);
assert.ok(Buffer.byteLength(JSON.stringify(boundedEvidence), "utf8") <= WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES);
assert.equal(boundedEvidence.observations.at(-1)?.cycle_id, new Date(Date.parse(cycle1) + 50 * 30 * 60 * 1000).toISOString());

const source = readFileSync("lib/services/wnba/buildWnbaPredictionRecords.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
const wnbaSchedules = (vercel.crons ?? []).filter((entry) => entry.path === "/api/cron/wnba-daily-refresh");
assert.ok(wnbaSchedules.length > 0);
assert.ok(wnbaSchedules.every((entry) => entry.schedule?.startsWith("23,53 ")));
assert.equal(normalizeWnbaActionPromotionCycle("2026-08-29T19:23:00.000Z"), "2026-08-29T19:23:00.000Z");
assert.equal(normalizeWnbaActionPromotionCycle("2026-08-29T19:52:59.999Z"), "2026-08-29T19:23:00.000Z");
assert.equal(normalizeWnbaActionPromotionCycle("2026-08-29T19:53:00.000Z"), "2026-08-29T19:53:00.000Z");
assert.match(source, /select\("id, game_id, locked_at, computed_at, sport_specific"\)/);
assert.match(source, /filter\(\(r\) => r\.locked_at == null\)/);
assert.match(source, /const toWrite = result\.records\.filter\(\(r\) => !lockedRec\.has/);
assert.ok(
  source.indexOf("const toWrite = result.records.filter") < source.indexOf("appendWnbaActionPromotionEvidence({"),
  "locked rows must be excluded before evidence is attached",
);
assert.doesNotMatch(source, /production_gate_enabled:\s*true/);

console.log("wnba action-promotion forward-evidence tests: PASS");
