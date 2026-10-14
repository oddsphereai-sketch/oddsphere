import assert from "node:assert/strict";
import {
  buildCfbFinalWinnerCoordinatorMarketFeatures,
  CFB_FINAL_WINNER_COORDINATOR_ARTIFACT_RELEASE,
  CFB_FINAL_WINNER_COORDINATOR_RELEASE,
  evaluateCfbFinalWinnerCoordinator,
  reconcileCfbFinalWinnerPmf,
} from "../lib/services/football/cfbFinalWinnerCoordinator";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";
import type { CfbForwardMarketReaderObservation } from "../lib/services/football/cfbForwardEvidenceCapture";
import { CFB_SHARP_API_SPLITS_RELEASE } from "../lib/services/football/cfbSharpApiSplits";
import { summarizePmf } from "../lib/services/football/cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "../lib/services/football/cfbV1Decision";

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

console.log("CFB final-winner target exclusion, split provenance, smooth authority, and artifact tests passed.");
