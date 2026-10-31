import assert from "node:assert/strict";
import type { BdlEplTeamMatchStats } from "../lib/providers/real_api/BallDontLieEplProvider";
import { EPL_BASELINE_MODEL_RELEASE, fitEplShadowModel, predictEplMatch, type EplTrainingMatch } from "../lib/services/epl/eplShadowModel";
import {
  EPL_PROFESSIONAL_SCORE_CONFIG,
  EPL_PROFESSIONAL_SCORE_RELEASE,
  fitEplProfessionalScoreModel,
  predictEplProfessionalMatch,
} from "../lib/services/epl/eplProfessionalScoreModel";

const matches: EplTrainingMatch[] = Array.from({ length: 24 }, (_, index) => {
  const home = index % 4 + 1;
  const away = (index + 1) % 4 + 1;
  const homeScore = home === 1 ? 3 : home === 2 ? 2 : 1;
  const awayScore = away === 4 ? 0 : 1;
  return {
    id: 1_000 + index,
    season: 2025,
    home_team_id: home,
    away_team_id: away,
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    name: `${home}-${away}`,
    short_name: `${home}-${away}`,
    status: "FT",
    status_state: "final",
    status_detail: "FT",
    home_score: homeScore,
    away_score: awayScore,
    venue_name: null,
    venue_city: null,
    round_number: Math.floor(index / 4) + 1,
    home_xg: homeScore - 0.2,
    away_xg: awayScore + 0.1,
  };
});

const stats: BdlEplTeamMatchStats[] = matches.flatMap((match) => [
  {
    match_id: match.id,
    team_id: match.home_team_id,
    possession_pct: match.home_team_id === 1 ? 61 : 52,
    shots: match.home_team_id === 1 ? 18 : 12,
    shots_on_target: match.home_team_id === 1 ? 7 : 4,
    expected_goals: match.home_xg,
    big_chances: 2,
    red_cards: 0,
  },
  {
    match_id: match.id,
    team_id: match.away_team_id,
    possession_pct: match.away_team_id === 4 ? 39 : 48,
    shots: match.away_team_id === 4 ? 7 : 10,
    shots_on_target: match.away_team_id === 4 ? 2 : 3,
    expected_goals: match.away_xg,
    big_chances: 1,
    red_cards: 0,
  },
]);

const asOf = "2026-02-01T00:00:00.000Z";
const incumbent = predictEplMatch(fitEplShadowModel(matches, asOf), 1, 4);
const fit = fitEplProfessionalScoreModel(matches, stats, asOf);
const prediction = predictEplProfessionalMatch(fit, 1, 4);

assert.equal(fit.release, EPL_PROFESSIONAL_SCORE_RELEASE);
assert.equal(fit.incumbent.release, EPL_BASELINE_MODEL_RELEASE);
assert.equal(EPL_PROFESSIONAL_SCORE_CONFIG.candidateMarginWeight, 0.75);
assert.ok(Math.abs(prediction.expectedTotal - incumbent.expectedTotal) < 1e-10, "r20 must preserve the incumbent Total head exactly");
assert.ok(prediction.lambdaHome > prediction.lambdaAway, "matchup process and attack/defence strength must preserve the stronger club direction");
assert.ok(Math.abs((prediction.probabilities.home + prediction.probabilities.draw + prediction.probabilities.away) - 1) < 1e-9);
assert.ok(Math.abs((prediction.probabilities.over25 + prediction.probabilities.under25) - 1) < 1e-9);
assert.ok(Math.abs((prediction.probabilities.bttsYes + prediction.probabilities.bttsNo) - 1) < 1e-9);
assert.equal(prediction.release, "epl_goals_coherent_2026_10_31_r23_partial_price_publication");

const future = {
  ...matches[0]!,
  id: 9_999,
  date: "2026-03-01T00:00:00.000Z",
  home_score: 9,
  away_score: 0,
};
const withFuture = predictEplProfessionalMatch(fitEplProfessionalScoreModel([...matches, future], stats, asOf), 1, 4);
assert.deepEqual(withFuture, prediction, "post-cutoff outcomes must not alter a pre-kickoff prediction");

console.log("EPL professional coherent total/margin score-model tests passed.");
