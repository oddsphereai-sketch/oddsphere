import assert from "node:assert/strict";
import { gradeCbbProvisional } from "../lib/cbb/provisionalGradePolicy";
import type { CbbForecast, CbbQuote } from "../lib/cbb/types";

const asOf = "2026-11-01T12:00:00.000Z";
const forecast: CbbForecast = {
  release: "cbb_candidate_test", gameId: 10882407, asOf, homeId: 92, awayId: 11,
  homeScore: 78.5, awayScore: 68.3, margin: 10.2, total: 146.8,
  possessions: 71, homeWinProbability: 0.81,
  uncertainty: { marginSd: 11, totalSd: 16, marginTotalCorrelation: 0,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 3000 },
  inputStatus: "complete", issues: [],
};
const target: CbbQuote = {
  gameId: forecast.gameId, sportsbook: "fanduel", market: "spread", line: -7.5,
  firstPrice: -105, secondPrice: -115, providerObservedAt: "2026-11-01T11:50:00.000Z",
  fetchedAt: "2026-11-01T11:55:00.000Z", phase: "current",
};
const input = { target, forecast, asOf, references: [] as CbbQuote[] };
const withoutSharp = gradeCbbProvisional(input);
assert.equal(withoutSharp.grade, "Lean");
assert.equal(withoutSharp.referenceState, "unavailable");
assert.equal(withoutSharp.professionalReferences, 0);
assert.equal(withoutSharp.stake, 0);

const sharp: CbbQuote = { ...target, sportsbook: "pinnacle", line: -9.5,
  firstPrice: -110, secondPrice: -110 };
const withSharp = gradeCbbProvisional({ ...input, references: [sharp] });
assert.equal(withSharp.grade, "Best Angle");
assert.equal(withSharp.referenceState, "agrees");
assert.equal(withSharp.professionalReferences, 1);
assert.equal(gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "ps3838" }] })
  .professionalReferences, 1);
assert.equal(gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "ps3838", line: -5.5 }] })
  .professionalReferences, 0);
const against = gradeCbbProvisional({ ...input, references: [{ ...sharp, line: -5.5 }] });
assert.equal(against.referenceState, "opposes");
assert.notEqual(against.grade, "Best Angle");
assert.notEqual(against.grade, "Lean");
const mixed = gradeCbbProvisional({ ...input, references: [sharp, { ...sharp, sportsbook: "circa", line: -5.5 }] });
assert.equal(mixed.referenceState, "mixed");
assert.equal(mixed.grade, "Watchlist");
assert.equal(gradeCbbProvisional({ ...input, references: [{ ...sharp, sportsbook: "fanduel" }] })
  .referenceState, "unavailable");
assert.equal(gradeCbbProvisional({ ...input, target: { ...target, fetchedAt: "2026-11-01T09:00:00.000Z" } })
  .grade, "Held");
assert.equal(gradeCbbProvisional({ ...input, forecast: { ...forecast, inputStatus: "incomplete" } })
  .grade, "Held");
assert.throws(() => gradeCbbProvisional({ ...input, forecast: { ...forecast, gameId: 9 } }), /identity/);
console.log("CBB provisional exact-quote grade tests passed");
