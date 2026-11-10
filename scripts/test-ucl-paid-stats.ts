import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EplTrainingMatch } from "../lib/services/epl/eplShadowModel";
import { fitUclPaidStats, uclPaidTrainingInputs } from "../lib/services/ucl/uclPaidStatsFit";
import { fitAndPredictUclPaidStats, UCL_MODEL_RELEASE, UCL_CALIBRATION_RELEASE } from "../lib/services/ucl/uclModel";
import { buildUclCompetitionContexts } from "../lib/services/ucl/uclCompetitionContext";
import { deriveSoccerMarketProbabilities } from "../lib/services/soccer/soccerMarketProbabilities";

const names = ["", "Arsenal", "Liverpool", "Bayern Munich", "Paris Saint-Germain"];
const match = (id: number, home: number, away: number, day: number, goals: [number, number]): EplTrainingMatch => ({
  id, season: 2026, date: new Date(Date.UTC(2026, 8, day)).toISOString(), home_team_id: home, away_team_id: away,
  name: `${names[away]} at ${names[home]}`, short_name: "AWY @ HOM", status: "STATUS_FINAL", status_state: "final",
  status_detail: "FT", home_score: goals[0], away_score: goals[1], home_xg: goals[0] + .2, away_xg: goals[1] + .2,
  venue_name: null, venue_city: null, round_number: 1,
});
const ucl = Array.from({ length: 24 }, (_, i) => match(i + 1, i % 4 + 1, (i + 1) % 4 + 1, i + 1, [i % 3, i % 2]));
const epl = Array.from({ length: 24 }, (_, i) => match(i + 1, i % 2 + 1, (i + 1) % 2 + 1, i + 1, [i % 4, i % 2]));
const rows = uclPaidTrainingInputs(ucl, epl), cutoff = "2026-10-01T12:00:00Z";
const fit = fitUclPaidStats(rows, cutoff);
assert.equal(fit.rows, 48, "numeric fixture IDs in different competitions cannot collide");
assert.equal(fit.uclRows, 24); assert.equal(fit.eplRows, 24); assert(fit.converged);
assert.deepEqual(fitUclPaidStats([...rows, rows[0]!], cutoff), fit, "identical repeated observations add no likelihood");
assert.throws(() => fitUclPaidStats([...rows, { ...rows[0]!, home_score: 11 }], cutoff), /Conflicting/);
assert.throws(() => uclPaidTrainingInputs(ucl, [{ ...epl[0]!, name: "Wrong Club at Wrong Club" }]), /identity/);
assert.throws(() => fitUclPaidStats(uclPaidTrainingInputs(ucl, []), cutoff), /Both licensed/);
assert.throws(() => fitUclPaidStats(rows, "bad-date"), /bounds/);
assert.throws(() => fitUclPaidStats([{ ...rows[0]!, home_score: -1 }, ...rows.slice(1)], cutoff), /Invalid licensed/);
const future = { ...rows[0]!, id: 999, date: cutoff, home_score: 99 };
assert.deepEqual(fitUclPaidStats([...rows, future], cutoff), fit, "same-kickoff/future results cannot enter the forecast");
const forecastMatch = { ...match(900, 1, 3, 30, [0, 0]), date: "2026-10-02T20:00:00Z", status: "STATUS_SCHEDULED", status_state: "scheduled" as const, home_score: null, away_score: null };
const context = { ...buildUclCompetitionContexts([forecastMatch]).get(900)!, neutralVenue: true };
const prediction = fitAndPredictUclPaidStats({ training: ucl, paidTraining: rows, match: forecastMatch, history: [], context, availableAt: cutoff });
assert.equal(prediction.release, UCL_MODEL_RELEASE); assert.equal(prediction.calibrationRelease, UCL_CALIBRATION_RELEASE);
assert(prediction.coherentJoint); assert.equal(prediction.adjustment.currentStrengthPrior, undefined);
assert.equal(prediction.adjustment.strengthPrior, "licensed_ucl_epl_results_xg");
assert.equal(prediction.adjustment.licensedStats?.availableAt, cutoff);
const markets = deriveSoccerMarketProbabilities({ joint: prediction.coherentJoint!, totalLine: 2.5 });
for (const side of ["home", "draw", "away"] as const) assert(Math.abs(prediction.probabilities[side] - markets.match_result[side]) < 1e-12);
assert(Math.abs(prediction.probabilities.over25 - markets.total.over) < 1e-12);
assert(Math.abs(prediction.probabilities.bttsYes - markets.btts.yes) < 1e-12);
const swapped = fitAndPredictUclPaidStats({ training: ucl, paidTraining: rows, match: { ...forecastMatch, home_team_id: 3, away_team_id: 1 }, history: [], context, availableAt: cutoff });
assert(Math.abs(prediction.lambdaHome - swapped.lambdaAway) < 1e-12);
assert(Math.abs(prediction.lambdaAway - swapped.lambdaHome) < 1e-12, "neutral sites remove both venue intercepts symmetrically");
assert.throws(() => fitAndPredictUclPaidStats({ training: ucl, paidTraining: rows, match: forecastMatch, history: [], context, availableAt: forecastMatch.date }), /unavailable before/);
const unseen = fitAndPredictUclPaidStats({ training: ucl, paidTraining: rows, match: { ...forecastMatch, home_team_id: 999 }, history: [], context, availableAt: cutoff });
assert.equal(unseen.homeStrengthSource, "promoted_proxy"); assert.equal(unseen.confidence, "limited");
assert.equal(unseen.adjustment.effectiveMatches.home, 0, "cohort prior cannot claim observed club history");
const source = readFileSync("lib/services/ucl/buildUclSlate.ts", "utf8");
assert.doesNotMatch(source, /loadUclOfficialStrength|buildUclCurrentStrengthPrior/);
assert.match(source, /loadEplLicensedTrainingFoundation/);
assert.match(source, /Date.parse\(foundation.availableAt\)<Date.parse\(match.date\)/);
console.log("PASS licensed UCL/EPL fit: exact identities and fixture namespaces, duplicate/future exclusion, invalid inputs, shared all-market joint, neutral symmetry, actual input clock, honest unseen-club prior and no ClubElo dependency");
