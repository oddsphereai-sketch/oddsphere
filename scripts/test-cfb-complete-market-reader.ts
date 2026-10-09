import assert from "node:assert/strict";
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
const observation = (allowed: string[]): CfbForwardMarketReaderObservation => ({
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
        landmark("2026-10-10T12:00:00.000Z", 3, -110, -110),
        landmark("2026-10-10T22:00:00.000Z", 6, -110, -110),
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
  sharpApiSplits: [],
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
assert.equal(independent.totalEvidenceAvailable, true);
assert.ok(Math.abs(independent.marginShiftPoints) > 1e-6, "target-excluded movement must be allowed to move the score axis");
assert.ok(Math.abs(independent.forecast.expectedMarginHome -
  (independent.forecast.expectedHomePoints - independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.expectedTotal -
  (independent.forecast.expectedHomePoints + independent.forecast.expectedAwayPoints)) < 1e-9);
assert.ok(Math.abs(independent.forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 1e-9);
assert.ok(independent.forecast.expectedAwayPoints >= 0 && independent.forecast.expectedHomePoints >= 0);
assert.match(CFB_COMPLETE_MARKET_READER_RELEASE, /target_excluded_sequence/);
assert.equal(CFB_COMPLETE_MARKET_READER_ARTIFACT_RELEASE, "cfb_market_reader_artifact_2026_10_08_r1");

console.log("CFB complete market-reader target exclusion and score-coherence tests passed.");
