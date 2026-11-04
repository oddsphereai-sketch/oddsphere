import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";
import { publishedProbabilityComparison } from "../app/lab/lib/publishedProbabilityComparison";
import { DecisionMetricGrid } from "../app/dev/experience-preview/ActualDailyEdgePreview";
import { adaptCbbProvisionalGame } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { cbbMemberGameForReader, writeCbbMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";

// Published Butler example: DK -110/-110 is 50% no-vig, while raw
// break-even remains 52.38095%. Its stored selected-side gap is +0.2226pp.
const butler = { modelProb: .5022258825624357, marketFairProb: .5, marketImpliedPct: 52.38095238095239,
  modelMarketGapPct: .22258825624357215, publishedProbabilityComparisonBasis: "stored_no_vig",
  marketSource: "draftkings", recommendationConfidence: 50.2226 } as MarketEdgeDto;
const before = JSON.stringify(butler);
assert.deepEqual(publishedProbabilityComparison(butler), { marketProbabilityText: "50.0%", probabilityGap: .22258825624357215,
  storedBasis: true, marketAvailable: true });
const legacy = { ...butler }; delete legacy.publishedProbabilityComparisonBasis;
assert.equal(publishedProbabilityComparison(legacy).marketProbabilityText, "52.4%");
assert.equal(publishedProbabilityComparison(legacy).probabilityGap, -2.2);
// Stored integer-spread evidence from game10882565: -39, 2.2465% push.
// This is a new-basis fixture; its actual legacy lock remains unflagged below.
const pushed = { ...butler, line: -39, modelProb: .8037360760191512, marketFairProb: .4891657638136511,
  marketImpliedPct: 51.21951219512195, modelMarketGapPct: 31.457031220550007, pushProbability: .022465225520621034 };
assert.equal(publishedProbabilityComparison(pushed).probabilityGap, 31.457031220550007,
  "an integer-line stored comparison is used verbatim, never reconstructed from display probability or push mass");
for (const fair of [null, NaN, Infinity, -1, 1.1]) {
  const result = publishedProbabilityComparison({ ...butler, marketFairProb: fair });
  assert.equal(result.marketProbabilityText, "—"); assert.equal(result.probabilityGap, null);
}
for (const gap of [null, NaN, Infinity]) assert.equal(publishedProbabilityComparison({ ...butler, modelMarketGapPct: gap }).probabilityGap, null,
  "missing stored gap never falls back to raw break-even or new subtraction");
assert.equal(publishedProbabilityComparison({ ...legacy, marketImpliedPct: null }).marketProbabilityText, "50.0%");
assert.equal(publishedProbabilityComparison({ ...legacy, marketImpliedPct: null }).probabilityGap, null);
assert.equal(JSON.stringify(butler), before);

// The node TSX harness uses classic JSX; production Next compiles this client
// component normally. Render the actual production metric grid, not a mock.
Object.assign(globalThis, { React });
const render = (market: MarketEdgeDto) => renderToStaticMarkup(React.createElement(DecisionMetricGrid, { market, probabilityLabel: "Model" }));
const html = render(butler);
assert.match(html, /50\.0%/); assert.match(html, /\+0\.2 pp/); assert.doesNotMatch(html, /52\.4%|−2\.2 pp|-2\.2 pp/);
const legacyHtml = render(legacy);
assert.match(legacyHtml, /52\.4%/); assert.match(legacyHtml, /-2\.2 pp/);
assert.equal(render({ ...legacy, publishedProbabilityComparisonBasis: undefined }), legacyHtml,
  "an absent optional flag retains exact legacy/other-sport rendering");
const absent = render({ ...butler, marketFairProb: null, modelMarketGapPct: null });
assert.match(absent, /Unavailable/); assert.doesNotMatch(absent, /no-vig|52\.4%/);
assert.match(render(pushed), /\+31\.5 pp/);
assert.equal(publishedProbabilityComparison({ ...pushed, publishedProbabilityComparisonBasis: undefined }).probabilityGap, 29.2,
  "the actual unflagged integer-line legacy comparison remains unchanged");
assert.equal(publishedProbabilityComparison({ ...pushed, modelProb: .59 }).probabilityGap, pushed.modelMarketGapPct,
  "stored gap authority is independent of a later display probability; never reconstruct it");

const start = "2026-11-04T22:00:00Z", at = "2026-11-04T20:00:00Z", lock = "2026-11-04T21:00:00Z";
const team = (id: number, college: string, abbr: string) => ({ id, college, abbreviation: abbr, name: college, full_name: college, conference_id: 1 });
const game: CbbGame = { id: 10882636, date: start, season: 2026, status: "pre", period: 0, home_score: 0, away_score: 0,
  home_team: team(1, "Butler", "BUT"), visitor_team: team(2, "Fairleigh Dickinson", "FDU") };
const forecast: CbbForecast = { release: "display-fixture", gameId: game.id, asOf: at, homeId: 1, awayId: 2,
  homeScore: 90, awayScore: 62, margin: 28, total: 152, possessions: 70, homeWinProbability: .99,
  inputStatus: "complete", issues: [], uncertainty: { marginSd: 11, totalSd: 16, marginTotalCorrelation: 0,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 1000 } };
const base: CbbQuote = { gameId: game.id, sportsbook: "draftkings", market: "moneyline", line: null,
  firstPrice: -50000, secondPrice: 4000, phase: "current", providerObservedAt: at, fetchedAt: at };
const board = buildCbbProvisionalBoard(forecast, [base, { ...base, market: "spread", line: -28, firstPrice: -110, secondPrice: -110 },
  { ...base, market: "total", line: 152, firstPrice: -110, secondPrice: -110 }]);
board.rows.find(row => row.market === "spread")!.probability = butler.modelProb;
board.rows.find(row => row.market === "spread")!.marketFairProbability = .5;
const snapshot = { release: "cbb_candidate_2026_10_29_r1_locked_board_contract", gameId: game.id, startsAt: start,
  capturedAt: at, lockedAt: null, board } as Parameters<typeof adaptCbbProvisionalGame>[0]["snapshot"];
const unlocked = adaptCbbProvisionalGame({ game, snapshot, homeLogo: null, awayLogo: null, now: at });
const oldLock = adaptCbbProvisionalGame({ game, snapshot: { ...snapshot, lockedAt: lock }, homeLogo: null, awayLogo: null, now: lock });
for (const key of ["moneyline", "first_inning", "total"] as const) {
  assert.equal(unlocked.markets[key].publishedProbabilityComparisonBasis, "stored_no_vig");
  assert.equal(oldLock.markets[key].publishedProbabilityComparisonBasis, undefined);
  for (const field of ["modelProb", "marketFairProb", "marketImpliedPct", "modelMarketGapPct", "line", "priceAmerican", "grade", "verdict"] as const)
    assert.deepEqual(unlocked.markets[key][field], oldLock.markets[key][field], "display basis cannot change stored numerical decisions");
}
let payload: unknown = null, writes = 0;
const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: payload ? { payload } : null, error: null }) }) }),
  upsert: async (row: { payload: unknown }) => { payload = structuredClone(row.payload); writes++; return { error: null }; } }) } as unknown as Parameters<typeof writeCbbMemberGame>[1];
async function locks() {
  const first = await writeCbbMemberGame({ game, candidate: board, homeLogo: null, awayLogo: null, now: at }, db);
  const frozen = await writeCbbMemberGame({ game, candidate: board, homeLogo: null, awayLogo: null, now: lock }, db);
  for (const key of ["moneyline", "first_inning", "total"] as const) assert.equal(frozen.record.memberGame.markets[key].publishedProbabilityComparisonBasis, "stored_no_vig");
  assert.deepEqual(first.record.memberGame.projected, frozen.record.memberGame.projected);
  const old = structuredClone(frozen.record);
  for (const market of Object.values(old.memberGame.markets)) delete market.publishedProbabilityComparisonBasis;
  payload = old; const saved = JSON.stringify(payload);
  const untouched = await writeCbbMemberGame({ game, candidate: board, homeLogo: null, awayLogo: null, now: "2026-11-04T21:15:00Z" }, db);
  assert.equal(untouched.written, false); assert.equal(writes, 2); assert.equal(JSON.stringify(payload), saved);
  const read = cbbMemberGameForReader(untouched.record, game);
  for (const market of Object.values(read.markets)) assert.equal(market.publishedProbabilityComparisonBasis, undefined);
  assert.equal(JSON.stringify(payload), saved, "legacy lock reader cannot stamp or replace the stored comparison basis");
  console.log("CBB published comparison: actual metric rendering, stored no-vig/gap, missing-data honesty and exact legacy/future locks passed");
}
void locks().catch(error => { console.error(error); process.exitCode = 1; });
