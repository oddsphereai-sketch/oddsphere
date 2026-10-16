import assert from "node:assert/strict";

import { type NbaPortableModelArtifact } from "../lib/automodel/nba/nbaPortableScoreModel";
import { runNbaAutoModelV2 } from "../lib/automodel/nba/nbaAutoModelV2";
import type { NbaGameSnapshot, NbaTeamRatingPack } from "../lib/automodel/nba/types";
import { buildNbaGameIntelligence } from "../lib/services/nba/nbaMarketIntelligence";
import {
  applyNbaProfessionalCandidate,
  buildNbaProfessionalCandidate,
} from "../lib/services/nba/nbaProfessionalCandidate";
import { buildNbaProfessionalMarketReader } from "../lib/services/nba/nbaProfessionalMarketReader";

const artifact: NbaPortableModelArtifact = {
  release: "fixture",
  featureRelease: "fixture_features",
  architecture: "margin_total",
  model: { family: "ridge", alpha: 1000 },
  design: {
    features: ["strength"], missingIndicatorColumns: [], rawFeatureMedians: [0],
    designMeans: [0], designStandardDeviations: [1], designColumns: 1, splineKnots: [],
  },
  coefficients: {
    target_home_margin: [1, 0],
    target_total: [0, 220],
  },
  distribution: {
    family: "normal_residual", marginSigma: 11.5, totalSigma: 16, calibratedOn: "fixture",
  },
};

const fetchedAt = "2026-10-20T16:00:00Z";
const lines = ["pinnacle", "draftkings"].flatMap((sportsbook) => [
  { market_type: "moneyline", sportsbook, side: "home", line_value: null, odds_american: -125, fetched_at: fetchedAt },
  { market_type: "moneyline", sportsbook, side: "away", line_value: null, odds_american: 110, fetched_at: fetchedAt },
  { market_type: "spread", sportsbook, side: "home", line_value: -2, odds_american: -110, fetched_at: fetchedAt },
  { market_type: "spread", sportsbook, side: "away", line_value: 2, odds_american: -110, fetched_at: fetchedAt },
  { market_type: "total", sportsbook, side: "over", line_value: 218, odds_american: -110, fetched_at: fetchedAt },
  { market_type: "total", sportsbook, side: "under", line_value: 218, odds_american: -110, fetched_at: fetchedAt },
]);
const history = ["pinnacle", "draftkings"].map((sportsbook) => ({
  externalGameId: 9,
  market: "spread" as const,
  side: "home",
  sportsbook,
  line: 0,
  americanPrice: -110,
  observedAt: "2026-10-20T12:00:00Z",
}));

const independentOnly = buildNbaProfessionalCandidate({
  artifact,
  featureRow: { strength: -4 },
  lines,
  history,
  externalGameId: 9,
});

assert.equal(independentOnly.independent.marginHome, -4);
assert.equal(independentOnly.final.marginHome, -4);
assert.equal(independentOnly.final.total, 220);
assert.equal(independentOnly.final.movementApplied, false);

const priceRows = ["pinnacle", "bookmaker"].flatMap((sportsbook) => [
  {
    sportsbook, sharpBook: true, market: "spread" as const, selectionKey: "9:spread:home",
    americanPrice: -110, line: 0, providerTimestamp: "2026-10-20T14:00:00Z", fetchedAt: "2026-10-20T14:00:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "spread" as const, selectionKey: "9:spread:away",
    americanPrice: -110, line: 0, providerTimestamp: "2026-10-20T14:00:00Z", fetchedAt: "2026-10-20T14:00:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "spread" as const, selectionKey: "9:spread:home",
    americanPrice: -125, line: -2, providerTimestamp: "2026-10-20T15:30:00Z", fetchedAt: "2026-10-20T15:30:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "spread" as const, selectionKey: "9:spread:away",
    americanPrice: 105, line: 2, providerTimestamp: "2026-10-20T15:30:00Z", fetchedAt: "2026-10-20T15:30:00Z",
  },
]);
const marketReader = buildNbaProfessionalMarketReader({
  evaluatedAt: "2026-10-20T16:00:00Z",
  priceRows,
  splitRows: [{
    provider: "sharpapi", sourceBook: "draftkings", sourceType: "retail_book",
    market: "spread", selectionKey: "9:spread:home", betsPct: 40, moneyPct: 60,
    marketLine: -2, sourceObservedAt: "2026-10-20T15:45:00Z", fetchedAt: "2026-10-20T15:46:00Z",
  }],
  selectedLines: { spreadHome: -2, total: 218 },
});
const result = buildNbaProfessionalCandidate({
  artifact,
  featureRow: { strength: -4 },
  lines,
  history,
  externalGameId: 9,
  marketReader,
});

assert.equal(result.independent.marginHome, -4);
assert.equal(result.final.movementApplied, true);
assert.ok(result.final.marginHome > 2, "qualified home movement must flip the residual beyond the home -2 threshold");
assert.equal(result.picks.moneyline, "home");
assert.equal(result.picks.spread, "home");
assert.equal(result.picks.total, "over");
assert.deepEqual(result.readerDecisionAudit, {
  independentPicks: { moneyline: "away", spread: "away", total: "over" },
  finalPicks: { moneyline: "home", spread: "home", total: "over" },
  spreadReadQualified: true,
  spreadCorrectionApplied: true,
  totalReadQualified: false,
  totalCorrectionApplied: false,
  effects: {
    moneyline: "flipped_by_validated_spread_score",
    spread: "flipped_by_validated_spread_read",
    total: "unchanged_no_qualified_total_read",
  },
});
assert.ok(Math.abs(result.final.homeScore + result.final.awayScore - result.final.total) < 1e-9);
assert.ok(Math.abs(result.final.homeScore - result.final.awayScore - result.final.marginHome) < 1e-9);

const totalArtifact: NbaPortableModelArtifact = {
  ...artifact,
  coefficients: {
    ...artifact.coefficients,
    target_total: [0, 210],
  },
};
const totalPriceRows = ["pinnacle", "bookmaker"].flatMap((sportsbook) => [
  {
    sportsbook, sharpBook: true, market: "total" as const, selectionKey: "9:total:over",
    americanPrice: -110, line: 213, providerTimestamp: "2026-10-20T14:00:00Z", fetchedAt: "2026-10-20T14:00:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "total" as const, selectionKey: "9:total:under",
    americanPrice: -110, line: 213, providerTimestamp: "2026-10-20T14:00:00Z", fetchedAt: "2026-10-20T14:00:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "total" as const, selectionKey: "9:total:over",
    americanPrice: -110, line: 218, providerTimestamp: "2026-10-20T15:30:00Z", fetchedAt: "2026-10-20T15:30:00Z",
  },
  {
    sportsbook, sharpBook: true, market: "total" as const, selectionKey: "9:total:under",
    americanPrice: -110, line: 218, providerTimestamp: "2026-10-20T15:30:00Z", fetchedAt: "2026-10-20T15:30:00Z",
  },
]);
const totalReader = buildNbaProfessionalMarketReader({
  evaluatedAt: "2026-10-20T16:00:00Z",
  priceRows: totalPriceRows,
  splitRows: [],
  selectedLines: { spreadHome: -2, total: 218 },
});
const totalCorrected = buildNbaProfessionalCandidate({
  artifact: totalArtifact,
  featureRow: { strength: -4 },
  lines,
  history,
  externalGameId: 9,
  marketReader: totalReader,
});
assert.equal(totalCorrected.independent.total, 210);
assert.equal(totalCorrected.final.totalMovementQualified, true);
assert.equal(totalCorrected.final.totalMovementApplied, true);
assert.equal(totalCorrected.final.total, 226);
assert.equal(totalCorrected.picks.total, "over");
assert.equal(totalCorrected.readerDecisionAudit.effects.total, "flipped_by_validated_total_read");
assert.ok(Math.abs(totalCorrected.final.homeScore + totalCorrected.final.awayScore - 226) < 1e-9);

const ratingPack: NbaTeamRatingPack = {
  off_rating: 115,
  def_rating: 115,
  net_rating: 0,
  pace: 99,
  four_factors: {
    off_efg_pct: 0.55, off_tov_pct: 0.13, off_orb_pct: 0.27, off_ft_rate: 0.24,
    def_efg_pct: 0.55, def_tov_pct: 0.13, def_drb_pct: 0.73, def_ft_rate_allowed: 0.24,
  },
  sample_games: 82,
  source: "fixture",
  source_url: "fixture://rating",
  fetched_at: fetchedAt,
};
const snapshot: NbaGameSnapshot = {
  game_external_id: 9,
  slate_date: "2026-10-20",
  game_time_iso: "2026-10-21T00:00:00.000Z",
  season_type: "regular",
  home_team: {
    team_external_id: 1, abbreviation: "HME", off_rating: 115, def_rating: 115,
    net_rating: 0, pace: 99, recent_form_10g_net_rating: null,
    regular_season_ratings: ratingPack, playoff_ratings: null,
  },
  away_team: {
    team_external_id: 2, abbreviation: "AWY", off_rating: 115, def_rating: 115,
    net_rating: 0, pace: 99, recent_form_10g_net_rating: null,
    regular_season_ratings: ratingPack, playoff_ratings: null,
  },
  home_injuries: [], away_injuries: [], series: null,
  market: {
    ml: { home_odds_american: -125, away_odds_american: 110 },
    spread: { home_line: -2, home_odds_american: -110, away_odds_american: -110 },
    total: { line: 218, over_odds_american: -110, under_odds_american: -110 },
  },
  data_quality: {
    ratings_present: true, home_injuries_known: true, away_injuries_known: true,
    market_present: true, series_context_derived: true,
  },
};
const baseline = runNbaAutoModelV2(snapshot, "t60_locked", { bookCount: 2 });
const applied = applyNbaProfessionalCandidate({ baseline, candidate: result });
const intelligence = buildNbaGameIntelligence({
  snapshot,
  prediction: applied,
  lines,
  splitsRow: null,
  opportunities: [],
  injuriesSource: "espn",
});
assert.equal(applied.predicted_home_score, result.final.homeScore);
assert.equal(applied.predicted_away_score, result.final.awayScore);
assert.equal(intelligence.ml.pick_side, result.picks.moneyline);
assert.equal(intelligence.spread.pick_side, result.picks.spread);
assert.equal(intelligence.total.pick_side, result.picks.total);
assert.equal(intelligence.ml.current_price.odds_american, -125);
assert.equal(intelligence.spread.current_price.odds_american, -110);
assert.equal(intelligence.total.current_price.odds_american, -110);
assert.notEqual(intelligence.ml.grade, "held");
assert.notEqual(intelligence.spread.grade, "held");
assert.notEqual(intelligence.total.grade, "held");

console.log("NBA professional score, picks, exact prices, and grade-input coherence tests passed");
