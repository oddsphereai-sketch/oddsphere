import assert from "node:assert/strict";
import { assertCbbR2ResearchCohort } from "../lib/cbb/researchCohort";
import { CBB_SCORE_RESEARCH_RELEASE } from "../lib/cbb/scoreResearch";
import type { CbbForecast } from "../lib/cbb/types";

const forecast: CbbForecast = {
  release: CBB_SCORE_RESEARCH_RELEASE, gameId: 42, asOf: "2026-02-01T00:00:00.000Z",
  homeId: 1, awayId: 2, homeScore: 78, awayScore: 72, margin: 6, total: 150,
  possessions: 70, homeWinProbability: 0.7, inputStatus: "complete", issues: [],
  uncertainty: { marginSd: 10, totalSd: 14, marginTotalCorrelation: 0,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2024, games: 100 },
};
const row = { game: { id: 42 }, forecast };
assert.doesNotThrow(() => assertCbbR2ResearchCohort([row]));
assert.throws(() => assertCbbR2ResearchCohort([{ ...row, forecast: { ...forecast, release: "cbb_r1" } }]), /release\/score mismatch/);
assert.throws(() => assertCbbR2ResearchCohort([row, row]), /duplicate/);
assert.throws(() => assertCbbR2ResearchCohort([{ ...row, forecast: { ...forecast, total: 151 } }]), /release\/score mismatch/);
assert.throws(() => assertCbbR2ResearchCohort([{ ...row, forecast: { ...forecast, total: Number.NaN } }]), /release\/score mismatch/);
console.log("CBB research cohort: release purity, identity, score coherence, and duplicate rejection passed.");
