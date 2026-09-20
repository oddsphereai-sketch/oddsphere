import assert from "node:assert/strict";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { supabase } from "../lib/db/supabase";
import { reconstructVerifiedEplLockedGames } from "../lib/services/epl/eplLockedMemberSnapshot";
import { preserveLockedEplGames } from "../lib/services/epl/eplLockedSnapshot";
import { EPL_COMPETITION, EPL_EXTERNAL_ID_OFFSET } from "../lib/services/epl/eplProductionPipeline";

const providerId = 3818236;
const modelRelease = "test-epl-model";
const calibrationRelease = "test-epl-calibration";
const projection = { expectedHomeGoals: 1.7, expectedAwayGoals: 1.1, likelyScore: { home: 2, away: 1 } };

function market(side: string, price: number, line: number | null = null): MarketEdgeDto {
  const modelProb = 0.6;
  const marketFairProb = 0.44;
  const expectedValue = modelProb * (price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price)) - 1;
  return {
    pick: side,
    currentPriceAmerican: price,
    priceAmerican: price,
    currentPriceSportsbook: "Pinnacle",
    modelProb,
    marketFairProb,
    modelMarketGapPct: 16,
    pinnacleEvPct: expectedValue * 100,
    line,
    held: false,
    verdict: { key: "no_play", label: "No Play" },
    soccerPriceBoard: { rows: [{ side, selected: true }] },
  } as MarketEdgeDto;
}

const captured = {
  match_result: market("home", 127),
  double_chance: market("home_or_draw", -253),
  total: market("over", -188, 2.5),
  btts: market("yes", -211),
};

function record(marketName: keyof typeof captured, id: number) {
  const value = captured[marketName];
  return {
    id,
    external_id: EPL_EXTERNAL_ID_OFFSET + providerId,
    market: marketName,
    model_version: modelRelease,
    calibration_version: calibrationRelease,
    locked_at: "2026-09-20T12:01:02.873Z",
    snapshot_json: {
      competition: EPL_COMPETITION,
      member_market_at_capture: value,
      member_projection_at_capture: projection,
      model_provenance: { release: modelRelease },
    },
    pick: value.pick,
    side: value.pick,
    line_value: marketName === "total" ? value.line : null,
    odds_american: value.currentPriceAmerican,
    model_probability: Math.round((value.modelProb ?? 0) * 1e6) / 1e6,
    market_probability: Math.round((value.marketFairProb ?? 0) * 1e6) / 1e6,
    edge: Math.round((value.modelMarketGapPct ?? 0) * 1e3) / 1e3,
    expected_value: Math.round(((value.pinnacleEvPct ?? 0) / 100) * 1e4) / 1e4,
    play_grade: value.verdict.label,
    best_angle: false,
    no_bet: true,
    held: false,
    hold_reason: null,
  };
}

const rows = (Object.keys(captured) as Array<keyof typeof captured>).map((name, index) => record(name, index + 1));

function verificationClient(data: typeof rows) {
  return {
    from() {
      const chain = {
        select() { return chain; },
        in() { return chain; },
        not() { return chain; },
        then(resolve: (value: unknown) => void) {
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return chain;
    },
  } as unknown as typeof supabase;
}

const emptyMarket = { ...market("home", 127), currentPriceAmerican: null, priceAmerican: null, held: true };
const response = {
  games: [{
    external_id: providerId,
    gameStartAt: "2026-09-20T13:00:00Z",
    scheduledLockAt: "2026-09-20T12:00:00Z",
    lockState: "locking",
    lockedAt: null,
    soccerProjection: null,
    soccerModelProvenance: null,
    markets: { moneyline: emptyMarket, total: emptyMarket, first_inning: emptyMarket },
    soccerDoubleChanceMarket: emptyMarket,
  }],
} as unknown as DailyEdgeResponse;

async function main() {
const verified = await reconstructVerifiedEplLockedGames({
  providerIds: [providerId],
  modelRelease,
  calibrationRelease,
  response,
}, verificationClient(rows));
assert.deepEqual(verified.completeProviderIds, [providerId]);
assert.deepEqual(verified.incompleteProviderIds, []);
assert.equal(verified.lockedResponse.games[0]?.lockState, "locked");
assert.equal(verified.lockedResponse.games[0]?.lockedAt, "2026-09-20T12:01:02.873Z");
assert.equal(verified.lockedResponse.games[0]?.markets.moneyline.currentPriceAmerican, 127);
assert.equal(verified.lockedResponse.games[0]?.soccerDoubleChanceMarket?.currentPriceAmerican, -253);
assert.equal(verified.lockedResponse.games[0]?.markets.total.currentPriceAmerican, -188);
assert.equal(verified.lockedResponse.games[0]?.markets.first_inning.currentPriceAmerican, -211);
assert.deepEqual(verified.lockedResponse.games[0]?.soccerProjection, projection);

const incomplete = await reconstructVerifiedEplLockedGames({
  providerIds: [providerId], modelRelease, calibrationRelease, response,
}, verificationClient(rows.slice(0, 3)));
assert.deepEqual(incomplete.completeProviderIds, []);
assert.deepEqual(incomplete.incompleteProviderIds, [providerId]);
assert.equal(incomplete.lockedResponse.games[0]?.markets.total.currentPriceAmerican, null);

const corruptedRows = rows.map((row) => row.market === "total" ? { ...row, odds_american: -999 } : row);
const corrupted = await reconstructVerifiedEplLockedGames({
  providerIds: [providerId], modelRelease, calibrationRelease, response,
}, verificationClient(corruptedRows));
assert.deepEqual(corrupted.incompleteProviderIds, [providerId]);

const oldLocked = {
  ...verified.lockedResponse,
  games: verified.lockedResponse.games.map((game) => ({
    ...game,
    markets: { ...game.markets, total: { ...game.markets.total, currentPriceAmerican: -999 } },
  })),
};
assert.equal(
  preserveLockedEplGames(oldLocked, verified.lockedResponse).games[0]?.markets.total.currentPriceAmerican,
  -999,
  "ordinary refreshes preserve an existing locked member card",
);
assert.equal(
  preserveLockedEplGames(oldLocked, verified.lockedResponse, new Date(), { authoritativeLockedProviderIds: [providerId] }).games[0]?.markets.total.currentPriceAmerican,
  -188,
  "a DB-verified four-market reconstruction can repair the existing locked member card",
);

console.log("EPL locked member reconstruction: all focused tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
