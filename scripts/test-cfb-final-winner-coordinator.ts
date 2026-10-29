import assert from "node:assert/strict";
import {
  buildCfbFinalWinnerCoordinatorMarketFeatures,
  CFB_FINAL_WINNER_COORDINATOR_ARTIFACT_RELEASE,
  CFB_FINAL_WINNER_COORDINATOR_BOUNDARY_RELEASE,
  CFB_FINAL_WINNER_COORDINATOR_RELEASE,
  CFB_PMF_WINNER_COHERENCE_RELEASE,
  evaluateCfbFinalWinnerCoordinator,
  reconcileCfbNearTiePmfWinnerCoherence,
  reconcileCfbFinalWinnerPmf,
} from "../lib/services/football/cfbFinalWinnerCoordinator";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";
import type { CfbForwardMarketReaderObservation } from "../lib/services/football/cfbForwardEvidenceCapture";
import { CFB_SHARP_API_SPLITS_RELEASE } from "../lib/services/football/cfbSharpApiSplits";
import { summarizePmf } from "../lib/services/football/cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "../lib/services/football/cfbV1Decision";
import { auditFootballCrossMarketCoherence } from "../lib/services/football/footballCrossMarketCoherence";

const book = (
  sportsbook: string,
  homePrice: number,
  awayPrice: number,
  homeLine: number,
  total: number,
): NcaafBookOdds => ({
  providerGameId: "coordinator-test",
  sportsbook,
  observedAt: "2026-10-13T12:00:00.000Z",
  moneyline: { homePrice, awayPrice },
  spread: { homeLine, awayLine: -homeLine, homePrice: -110, awayPrice: -110 },
  total: { line: total, overPrice: -110, underPrice: -110 },
});

const observation: CfbForwardMarketReaderObservation = {
  capturedAt: "2026-10-13T12:00:00.000Z",
  markets: {
    moneyline: { families: [], targetExcludedFamilies: [] },
    spread: { families: [], targetExcludedFamilies: [] },
    total: { families: [], targetExcludedFamilies: [] },
  },
  playbookSplits: {
    moneyline: {
      provider: "playbook",
      capturedAt: "2026-10-13T12:00:00.000Z",
      booksUsed: 10,
      homeMoneyPct: 40,
      homeBetsPct: 50,
      awayMoneyPct: 60,
      awayBetsPct: 50,
      overMoneyPct: null,
      overBetsPct: null,
      underMoneyPct: null,
      underBetsPct: null,
    },
    spread: {
      provider: "playbook",
      capturedAt: "2026-10-13T12:00:00.000Z",
      booksUsed: null,
      homeMoneyPct: null, homeBetsPct: null, awayMoneyPct: null, awayBetsPct: null,
      overMoneyPct: null, overBetsPct: null, underMoneyPct: null, underBetsPct: null,
    },
    total: {
      provider: "playbook",
      capturedAt: "2026-10-13T12:00:00.000Z",
      booksUsed: null,
      homeMoneyPct: null, homeBetsPct: null, awayMoneyPct: null, awayBetsPct: null,
      overMoneyPct: null, overBetsPct: null, underMoneyPct: null, underBetsPct: null,
    },
  },
  sharpApiSplits: [{
    release: CFB_SHARP_API_SPLITS_RELEASE,
    providerGameId: "coordinator-test",
    providerEventId: "circa-event",
    sportsbook: "circa",
    sourceSemantics: "sharp_adjacent",
    capturedAt: "2026-10-13T12:00:00.000Z",
    moneyline: {
      home: { moneyPct: 68, ticketsPct: 48 },
      away: { moneyPct: 32, ticketsPct: 52 },
    },
    spread: null,
    total: null,
  }, {
    release: CFB_SHARP_API_SPLITS_RELEASE,
    providerGameId: "coordinator-test",
    providerEventId: "fallback-event",
    sportsbook: "draftkings",
    sourceSemantics: "public_recreational",
    capturedAt: "2026-10-13T12:00:00.000Z",
    moneyline: {
      home: { moneyPct: 35, ticketsPct: 50 },
      away: { moneyPct: 65, ticketsPct: 50 },
    },
    spread: null,
    total: null,
  }],
};

const features = buildCfbFinalWinnerCoordinatorMarketFeatures({
  currentBooks: [
    book("BetMGM", -1000, 600, -14, 68),
    book("Circa", -120, 105, -2.5, 48),
    book("DraftKings", -110, -105, -1.5, 50),
  ],
  evaluatedSportsbookByMarket: {
    moneyline: "BetMGM",
    spread: "Circa",
    total: "DraftKings",
  },
  histories: [],
  currentObservation: observation,
});

const circaHome = (120 / 220) / ((120 / 220) + (100 / 205));
const draftKingsHome = (110 / 210) / ((110 / 210) + (105 / 205));
assert.ok(Math.abs(features.market_home_probability! - (circaHome + draftKingsHome) / 2) < 1e-12);
assert.equal(features.market_eligible_books, 2, "the evaluated moneyline target must be excluded");
assert.equal(features.market_home_spread, -7.75, "spread target exclusion is market scoped");
assert.equal(features.market_total_consensus, 58, "total target exclusion is market scoped");
assert.equal(features.market_history_observations, 1);
assert.equal(features.moneyline_namedSharp_side, 1);
assert.equal(features.moneyline_namedSharp_gap_pp, 20);
assert.equal(features.moneyline_fallback_side, -1);
assert.equal(features.moneyline_fallback_gap_pp, 15);
assert.equal(features.moneyline_public_side, -1);
assert.equal(features.moneyline_public_gap_pp, 10);

const evaluation = evaluateCfbFinalWinnerCoordinator({
  ...features,
  both_fbs: 1,
}, 0.2);
assert.ok(evaluation.authority > 0 && evaluation.authority < 0.75);
assert.ok(Number.isFinite(evaluation.learnedHomeWinProbability));
assert.ok(Number.isFinite(evaluation.combinedHomeWinProbability));
assert.match(CFB_FINAL_WINNER_COORDINATOR_RELEASE, /correct_qb_target_excluded_smooth_net_accuracy/);
assert.match(CFB_FINAL_WINNER_COORDINATOR_ARTIFACT_RELEASE, /correct_qb_target_excluded_smooth_net_accuracy/);
assert.match(CFB_FINAL_WINNER_COORDINATOR_BOUNDARY_RELEASE, /actual_pmf_incumbent/);

const actualPmfBoundary = evaluateCfbFinalWinnerCoordinator({
  ...features,
  both_fbs: 1,
}, 0.2, 0.49);
assert.equal(actualPmfBoundary.baselineHomeWinProbability, 0.49);
assert.equal(
  actualPmfBoundary.crossesWinnerBoundary,
  (actualPmfBoundary.combinedHomeWinProbability > 0.5) !== false,
  "diagnostic crossing must compare against the actual incumbent PMF side",
);

const pmf = [
  { away: 27, home: 21, probability: 0.3 },
  { away: 24, home: 24, probability: 0.4 },
  { away: 21, home: 27, probability: 0.3 },
];
const pmfSummary = summarizePmf(pmf);
const nearTieForecast: CfbV1Forecast = {
  providerGameId: "coordinator-coherence",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-10-17T16:00:00.000Z",
  ...pmfSummary,
  pmf,
};
const coherentSummary = summarizePmf(reconcileCfbFinalWinnerPmf(nearTieForecast, 0.001, true));
assert.ok(coherentSummary.homeWinProbability > 0.5);
assert.ok(Math.round(coherentSummary.expectedHomePoints * 10) > Math.round(coherentSummary.expectedAwayPoints * 10));
assert.ok(coherentSummary.representativeScore.home > coherentSummary.representativeScore.away);

const meanProbabilityCrossPmf = [
  { away: 23, home: 22, probability: 0.63 },
  { away: 21, home: 24, probability: 0.37 },
];
const meanProbabilityCrossForecast: CfbV1Forecast = {
  providerGameId: "pmf-coherence",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-10-27T23:30:00.000Z",
  ...summarizePmf(meanProbabilityCrossPmf),
  pmf: meanProbabilityCrossPmf,
};
assert.ok(meanProbabilityCrossForecast.expectedMarginHome > 0);
assert.ok(meanProbabilityCrossForecast.expectedMarginHome <= 0.5);
assert.ok(meanProbabilityCrossForecast.homeWinProbability < 0.5);
const originalMassByTotal = new Map<number, number>();
for (const cell of meanProbabilityCrossForecast.pmf) {
  const total = cell.home + cell.away;
  originalMassByTotal.set(total, (originalMassByTotal.get(total) ?? 0) + cell.probability);
}
const reconciled = reconcileCfbNearTiePmfWinnerCoherence(meanProbabilityCrossForecast);
assert.equal(reconciled.applied, true);
assert.equal(reconciled.reason, "near_tie_mean_probability_direction_cross");
assert.equal(reconciled.forecast.directionalAlignment?.release, CFB_PMF_WINNER_COHERENCE_RELEASE);
assert.ok(reconciled.forecast.expectedMarginHome > 0);
assert.ok(reconciled.forecast.homeWinProbability > 0.5);
assert.ok(Math.round(reconciled.forecast.expectedHomePoints * 10) > Math.round(reconciled.forecast.expectedAwayPoints * 10));
assert.ok(reconciled.forecast.representativeScore.home > reconciled.forecast.representativeScore.away);
assert.ok(Math.abs(reconciled.forecast.expectedTotal - meanProbabilityCrossForecast.expectedTotal) < 1e-10);
assert.ok(Math.abs(reconciled.forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 1e-10);
for (const [total, mass] of originalMassByTotal) {
  const reconciledMass = reconciled.forecast.pmf
    .filter((cell) => cell.home + cell.away === total)
    .reduce((sum, cell) => sum + cell.probability, 0);
  assert.ok(Math.abs(reconciledMass - mass) < 1e-10, `total ${total} mass must remain unchanged`);
}

const outsideToleranceForecast = {
  ...meanProbabilityCrossForecast,
  expectedAwayPoints: 24,
  expectedHomePoints: 25,
  expectedMarginHome: 1,
};
const outsideTolerance = reconcileCfbNearTiePmfWinnerCoherence(outsideToleranceForecast);
assert.equal(outsideTolerance.applied, false);
assert.equal(outsideTolerance.reason, "outside_tolerance");
assert.equal(outsideTolerance.forecast, outsideToleranceForecast);

// Exact production failure: a sub-unit floating sum lets the legacy bisection
// stop below the downstream UNIT-mass complement's winner-direction boundary.
const boundaryHomeProbability = 0.5000000004999998;
const roundedMass = 0.9999999999999996;
assert.ok(boundaryHomeProbability - (roundedMass - boundaryHomeProbability) > 1e-9);
assert.ok(boundaryHomeProbability - (1 - boundaryHomeProbability) <= 1e-9);
for (const scale of [1, roundedMass, 1.0000000000000002]) {
  for (const reverse of [false, true]) {
    const raw = meanProbabilityCrossPmf.map(cell => ({
      away: reverse ? cell.home : cell.away, home: reverse ? cell.away : cell.home,
      probability: cell.probability * scale,
    }));
    const input = { ...meanProbabilityCrossForecast, ...summarizePmf(raw), pmf: raw };
    const output = reconcileCfbNearTiePmfWinnerCoherence(input).forecast;
    const report = auditFootballCrossMarketCoherence({
      sport: "cfb", providerGameId: input.providerGameId, awayTeam: "AWY", homeTeam: "HME",
      forecast: { ...output, awayWinProbability: 1 - output.homeWinProbability },
      decisions: [], unavailableMarkets: ["moneyline", "spread", "total"],
      publicScoreDirectionTolerancePoints: 0.5,
    });
    assert.deepEqual(report.fatalIssues, [], "both winner directions must pass the actual downstream normalized validator");
    assert.ok(Math.abs(output.expectedTotal - input.expectedTotal) < 1e-10);
    for (const total of new Set(raw.map(cell => cell.home + cell.away))) {
      const massAt = (cells: typeof raw) => cells.filter(cell => cell.home + cell.away === total).reduce((sum, cell) => sum + cell.probability, 0);
      assert.ok(Math.abs(massAt(output.pmf) - massAt(raw)) < 1e-12, "total buckets are unchanged");
    }
    const coherentAgain = reconcileCfbNearTiePmfWinnerCoherence(output);
    assert.equal(coherentAgain.forecast, output, "already coherent forecasts retain exact reference and values");
  }
}

console.log("CFB final-winner diagnostic boundary and near-tie PMF coherence tests passed.");
