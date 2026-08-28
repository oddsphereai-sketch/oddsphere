import assert from "node:assert/strict";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";
import {
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  getCfbV1Forecast,
} from "../lib/services/football/cfbV1Decision";
import {
  buildCfbMarketInformedOutcomeForecast,
  resolveCfbCanonicalMarketAnchor,
} from "../lib/services/football/cfbMarketInformedOutcome";

const observedAt = "2026-08-28T12:00:00.000Z";
const books = [
  book("draftkings", -4, 48.5),
  book("fanduel", -4, 48.5),
  book("caesars", -3.5, 49),
];
const independent = getCfbV1Forecast("457159");
const anchor = resolveCfbCanonicalMarketAnchor({ books });
assert.ok(anchor);
assert.equal(anchor.source, "named_book_median");
assert.equal(anchor.homeSpread, -4);
assert.equal(anchor.totalLine, 48.5);

const marketInformed = buildCfbMarketInformedOutcomeForecast({ independentForecast: independent, anchor });
assert.ok(independent.expectedMarginHome < 0, "the frozen football-only Hawaii forecast is the audit control");
assert.ok(marketInformed.expectedMarginHome > 0, "the market-informed outcome follows Stanford -4");
assert.ok(Math.abs(marketInformed.expectedMarginHome - 4) < 0.75);
assert.ok(Math.abs(marketInformed.expectedTotal - 48.5) < 0.75);
assert.ok(marketInformed.homeWinProbability > 0.5);
assert.ok(marketInformed.representativeScore.home > marketInformed.representativeScore.away);

const mass = marketInformed.pmf.reduce((sum, cell) => sum + cell.probability, 0);
const expectedHome = marketInformed.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
const expectedAway = marketInformed.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
assert.ok(Math.abs(mass - 1) < 1e-12);
assert.ok(Math.abs(expectedHome - marketInformed.expectedHomePoints) < 1e-12);
assert.ok(Math.abs(expectedAway - marketInformed.expectedAwayPoints) < 1e-12);
assert.ok(Math.abs(expectedHome - expectedAway - marketInformed.expectedMarginHome) < 1e-12);
assert.ok(Math.abs(expectedHome + expectedAway - marketInformed.expectedTotal) < 1e-12);

const probabilities = cfbV1LineProbabilities({ forecast: marketInformed, homeSpread: -4, totalLine: 48.5 });
const directHomeWin = marketInformed.pmf.reduce((sum, cell) =>
  sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
assert.ok(Math.abs(probabilities.moneyline.home - directHomeWin) < 1e-12);
assert.ok(Math.abs(probabilities.moneyline.home - marketInformed.homeWinProbability) < 1e-12);

const contextAnchor = resolveCfbCanonicalMarketAnchor({ books: [], contextLines: { homeSpread: -4, totalLine: 48.5 } });
assert.deepEqual(contextAnchor, { homeSpread: -4, totalLine: 48.5, namedBookCount: 0, source: "playbook_context" });
assert.equal(resolveCfbCanonicalMarketAnchor({ books: [], contextLines: { homeSpread: -4, totalLine: null } }), null);

const exactTargetAnchor = resolveCfbCanonicalMarketAnchor({
  books: [
    book("betmgm", -39, 60.5),
    book("goldrush", -39, 61.5, false),
    book("pinnacle", -39, 59.5, false),
    book("bally", -38.5, 60.5, false),
    book("rebet", -39.5, 60.5, false),
  ],
  contextLines: { homeSpread: -38.5, totalLine: 61.5 },
});
assert.deepEqual(exactTargetAnchor, {
  homeSpread: -39,
  totalLine: 60.5,
  namedBookCount: 5,
  source: "exact_target_book",
});

const underCorroboratedTarget = resolveCfbCanonicalMarketAnchor({
  books: [
    book("betmgm", -39, 60.5),
    book("pinnacle", -39, 60.5, false),
  ],
  contextLines: { homeSpread: -38.5, totalLine: 61.5 },
});
assert.equal(underCorroboratedTarget?.source, "playbook_context");

const beforeBundle = buildCfbV1DecisionBundle({
  providerGameId: "457159",
  awayTeam: "HAW",
  homeTeam: "STAN",
  gameStartsAt: "2026-08-29T23:00:00.000Z",
  comparableCurrentBooks: books,
  evaluatedAt: observedAt,
});
void buildCfbMarketInformedOutcomeForecast({ independentForecast: beforeBundle.forecast, anchor });
const afterBundle = buildCfbV1DecisionBundle({
  providerGameId: "457159",
  awayTeam: "HAW",
  homeTeam: "STAN",
  gameStartsAt: "2026-08-29T23:00:00.000Z",
  comparableCurrentBooks: books,
  evaluatedAt: observedAt,
});
assert.deepEqual(afterBundle, beforeBundle, "outcome-axis scoring cannot mutate exact-price decisions or grades");

console.log("CFB market-informed outcome PMF coherence tests passed.");

function book(
  sportsbook: string,
  homeSpread: number,
  totalLine: number,
  targetEligible = true,
): NcaafBookOdds {
  return {
    providerGameId: "457159",
    sportsbook,
    observedAt,
    provider: "balldontlie",
    targetEligible,
    moneyline: { homePrice: -180, awayPrice: 155 },
    spread: { homeLine: homeSpread, homePrice: -110, awayLine: -homeSpread, awayPrice: -110 },
    total: { line: totalLine, overPrice: -110, underPrice: -110 },
  };
}
