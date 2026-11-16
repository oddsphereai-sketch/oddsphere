import assert from "node:assert/strict";
import {
  parseNflPlayerPropsOutcomeSupplement,
  resolveNflPlayerPropsOutcome,
} from "../lib/services/football/nflPlayerPropsOutcomeSupplement";

const supplement = parseNflPlayerPropsOutcomeSupplement({
  release: "fixture",
  readOnly: true,
  productionWrites: 0,
  lockedRecordMutations: 0,
  season: 2026,
  week: 5,
  rows: [
    {
      providerGameId: "game-1",
      playerName: "Ted Hurst III",
      market: "receiving_yards",
      exactOfferCount: 2,
      classification: "official_participated_zero",
      ledgerTreatment: "supplement_settled_actual_zero",
      actual: 0,
    },
    {
      providerGameId: "game-1",
      playerName: "Inactive Player",
      market: "anytime_td",
      exactOfferCount: 1,
      classification: "official_nonparticipant",
      ledgerTreatment: "exclude_from_settled_accuracy",
      actual: null,
    },
  ],
}, { season: 2026, week: 5 });

assert.deepEqual(resolveNflPlayerPropsOutcome({
  storedActual: 17,
  gameId: "game-1",
  playerName: "Ted Hurst",
  market: "receiving_yards",
  supplement,
}), { actual: 17, disposition: "stored" }, "stored outcome must take precedence over supplement");

assert.deepEqual(resolveNflPlayerPropsOutcome({
  storedActual: null,
  gameId: "game-1",
  playerName: "Ted Hurst",
  market: "receiving_yards",
  supplement,
}), { actual: 0, disposition: "supplemented" }, "suffix-normalized missing outcome should use confirmed zero");

assert.deepEqual(resolveNflPlayerPropsOutcome({
  storedActual: null,
  gameId: "game-1",
  playerName: "Inactive Player",
  market: "anytime_td",
  supplement,
}), { actual: null, disposition: "excluded" }, "confirmed nonparticipant must not be assigned a zero outcome");

assert.throws(() => parseNflPlayerPropsOutcomeSupplement({
  release: "bad",
  readOnly: true,
  productionWrites: 0,
  lockedRecordMutations: 0,
  season: 2026,
  week: 5,
  rows: [{
    providerGameId: "game-1",
    playerName: "Player",
    market: "anytime_td",
    exactOfferCount: 1,
    classification: "official_nonparticipant",
    ledgerTreatment: "supplement_settled_actual_zero",
    actual: 0,
  }],
}, { season: 2026, week: 5 }), /classification\/treatment semantics/);

console.log("NFL player-props outcome supplement precedence tests passed.");
