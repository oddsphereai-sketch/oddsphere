import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyCfbCompleteMarketReader,
  CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE,
  CFB_COMPLETE_MARKET_READER_RELEASE,
} from "../lib/services/football/cfbCompleteMarketReader";
import type { CfbForwardMarketReaderObservation } from "../lib/services/football/cfbForwardEvidenceCapture";
import { summarizePmf } from "../lib/services/football/cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "../lib/services/football/cfbV1Decision";

const pmf = [
  { home: 17, away: 14, probability: 0.08 },
  { home: 21, away: 17, probability: 0.12 },
  { home: 24, away: 20, probability: 0.18 },
  { home: 27, away: 20, probability: 0.18 },
  { home: 28, away: 24, probability: 0.16 },
  { home: 31, away: 24, probability: 0.12 },
  { home: 34, away: 27, probability: 0.08 },
  { home: 24, away: 27, probability: 0.04 },
  { home: 20, away: 24, probability: 0.04 },
];
const summary = summarizePmf(pmf);
const forecast: CfbV1Forecast = {
  providerGameId: "reader-test",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-10-10T23:00:00.000Z",
  ...summary,
  pmf,
};
const landmark = (
  observedAt: string,
  line: number | null,
  firstPrice: number,
  secondPrice: number,
) => [observedAt, 30, "f", line, firstPrice, secondPrice] as const;
const observation = (
  allowed: string[],
  fallbackTotal = false,
  spreadOpening = 3,
  spreadCurrent = 6,
): CfbForwardMarketReaderObservation => ({
  capturedAt: "2026-10-10T22:00:00.000Z",
  markets: {
    moneyline: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", null, 145, -165),
        landmark("2026-10-10T22:00:00.000Z", null, 175, -205),
      ]],
      targetExcludedFamilies: allowed,
    },
    spread: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", spreadOpening, -110, -110),
        landmark("2026-10-10T22:00:00.000Z", spreadCurrent, -110, -110),
      ]],
      targetExcludedFamilies: allowed,
    },
    total: {
      families: [[
        "circa", "s", "c", null,
        landmark("2026-10-10T12:00:00.000Z", 48, -110, -110),
        landmark("2026-10-10T22:00:00.000Z", 55, -110, -110),
      ]],
      targetExcludedFamilies: allowed,
    },
  },
  playbookSplits: null,
  sharpApiSplits: fallbackTotal ? [{
    release: "cfb_sharpapi_splits_2026_08_30_r2_full_week_capacity",
    providerGameId: "reader-test",
    providerEventId: "reader-test-event",
    sportsbook: "draftkings",
    sourceSemantics: "public_recreational",
    capturedAt: "2026-10-10T22:00:00.000Z",
    moneyline: null,
    spread: null,
    total: {
      line: 48,
      over: { moneyPct: 65, ticketsPct: 55 },
      under: { moneyPct: 35, ticketsPct: 45 },
    },
  }] : [],
});
const common = {
  forecast,
  independentForecast: forecast,
  histories: [],
  kickoffAt: forecast.gameStartsAt,
  awayFbs: true,
  homeFbs: true,
  awayConferenceId: 1,
  homeConferenceId: 2,
  evaluatedLines: { homeSpread: -3, total: 48 },
};

const excluded = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation([]),
});
assert.equal(excluded.marginEvidenceAvailable, false);
assert.equal(excluded.totalEvidenceAvailable, false);
assert.ok(Math.abs(excluded.marginShiftPoints) < 1e-9);
assert.ok(Math.abs(excluded.totalShiftPoints) < 1e-9);

const independent = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"]),
});
assert.equal(independent.marginEvidenceAvailable, true);
assert.equal(independent.totalEvidenceAvailable, false);
assert.ok(Math.abs(independent.marginShiftPoints) > 1e-6, "target-excluded movement must be allowed to move the score axis");
assert.ok(Math.abs(independent.forecast.expectedMarginHome -
  (independent.forecast.expectedHomePoints - independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.expectedTotal -
  (independent.forecast.expectedHomePoints + independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 1e-9);
assert.ok(independent.forecast.expectedAwayPoints >= 0 && independent.forecast.expectedHomePoints >= 0);

const staticConsensus = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], false, 6, 6),
});
assert.equal(staticConsensus.marginEvidenceAvailable, true);
assert.ok(
  Math.abs(staticConsensus.marginShiftPoints) > 1e-6,
  "a static target-excluded consensus must retain authority without movement or splits",
);

const keyThreeUpset = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], false, 3, 3),
});
assert.ok(
  Math.abs(keyThreeUpset.forecast.expectedMarginHome - forecast.expectedMarginHome) < 1e-9,
  "an independent upset must survive the empirically retained football key-three band",
);
assert.match(CFB_COMPLETE_MARKET_READER_RELEASE, /consensus_authority_split_specialization/);
assert.equal(CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE, "cfb_market_reader_artifact_2026_10_11_r5_consensus_authority_split_specialization");
const artifact = JSON.parse(readFileSync(
  new URL("../lib/services/football/modelArtifacts/cfbCompleteMarketReaderArtifact.json", import.meta.url),
  "utf8",
)) as {
  margin: { baseConsensusAuthority: number; minimumResolvedSpreadEdgePoints: number };
  total: { splitProvenance: string; reflectionAuthority: number };
};
assert.equal(artifact.margin.baseConsensusAuthority, 0.5);
assert.equal(artifact.margin.minimumResolvedSpreadEdgePoints, 1);
assert.equal(artifact.total.splitProvenance, "fallback");
assert.equal(artifact.total.reflectionAuthority, 1);

const totalReflection = applyCfbCompleteMarketReader({
  ...common,
  currentObservation: observation(["circa"], true),
});
assert.equal(totalReflection.totalEvidenceAvailable, true);
assert.equal(totalReflection.totalSideFlipped, true);
assert.ok(totalReflection.forecast.expectedTotal > 48, "fallback Total flow must be able to reflect an Under baseline to Over");
assert.ok(Math.abs(totalReflection.forecast.expectedTotal -
  (totalReflection.forecast.expectedHomePoints + totalReflection.forecast.expectedAwayPoints)) < 1e-9);
const reflectedOverProbability = totalReflection.forecast.pmf.reduce((sum, cell) => {
  const total = cell.home + cell.away;
  return sum + (total > 48 ? cell.probability : total === 48 ? 0.5 * cell.probability : 0);
}, 0);
assert.ok(
  reflectedOverProbability > 0.5,
  "the final PMF—not only its mean score—must agree with the fallback Total read",
);

console.log("CFB static-consensus, key-three, target-exclusion, fallback-Total, and score-coherence tests passed.");
