import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildNflExactProviderIndependentScore,
  evaluateNflExactProviderModelsForParity,
  nflExactProviderParityCases,
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
  NFL_EXACT_PROVIDER_RUNTIME_RELEASE,
} from "../lib/services/football/nflExactProviderScoreRuntime";
import {
  NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  type NflPlayerPropsCurrentSeasonState,
} from "../lib/services/football/nflPlayerPropsCurrentSeasonState";

assert.equal(createHash("sha256").update(readFileSync(
  "lib/services/football/modelArtifacts/nflExactProviderScoreR11.json.gz",
)).digest("hex"), NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
"the independent-prior lineage hash must bind the exact compressed model artifact bytes");

for (const row of nflExactProviderParityCases()) {
  const actual = evaluateNflExactProviderModelsForParity(row.features, row.baseTotal);
  assert.ok(Math.abs(actual.margin - row.margin) < 1e-10, `${row.gameId} margin parity`);
  assert.ok(Math.abs(actual.total - row.total) < 1e-10, `${row.gameId} total parity`);
}

const state: NflPlayerPropsCurrentSeasonState = {
  release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  season: 2026,
  completeThroughWeek: 5,
  updatedAt: "2026-10-15T12:00:00.000Z",
  games: [],
  teamStats: [],
  playMetrics: [],
  stats: [],
};
const score = buildNflExactProviderIndependentScore({
  currentSeasonState: state,
  context: {
    season: 2026,
    week: 6,
    awayTeam: "BUF",
    homeTeam: "KC",
    neutralSite: false,
    divisionGame: false,
    homeRestDays: 7,
    awayRestDays: 7,
    roofIndoor: false,
    surfaceGrass: true,
  },
});
assert.equal(score.release, NFL_EXACT_PROVIDER_RUNTIME_RELEASE);
assert.equal(score.marketInputPolicy, "prohibited_from_independent_score");
assert.equal(score.completeThroughWeek, 5);
assert.ok(Number.isFinite(score.expectedHomeScore));
assert.ok(Number.isFinite(score.expectedAwayScore));
assert.ok(Math.abs(score.expectedHomeScore - score.expectedAwayScore - score.expectedHomeMargin) < 1e-10);
assert.ok(Math.abs(score.expectedHomeScore + score.expectedAwayScore - score.expectedTotal) < 1e-10);

assert.throws(() => buildNflExactProviderIndependentScore({
  currentSeasonState: { ...state, completeThroughWeek: 6 },
  context: {
    season: 2026, week: 7, awayTeam: "BUF", homeTeam: "KC",
    neutralSite: false, divisionGame: false, homeRestDays: 7, awayRestDays: 7,
    roofIndoor: false, surfaceGrass: true,
  },
}), /incomplete Week 6 state/);

console.log(JSON.stringify({
  ok: true,
  parityCases: nflExactProviderParityCases().length,
  sample: {
    awayTeam: score.awayTeam,
    homeTeam: score.homeTeam,
    awayScore: score.expectedAwayScore,
    homeScore: score.expectedHomeScore,
    margin: score.expectedHomeMargin,
    total: score.expectedTotal,
  },
}, null, 2));
