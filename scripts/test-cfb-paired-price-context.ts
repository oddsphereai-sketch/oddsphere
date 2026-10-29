import assert from "node:assert/strict";
import { buildCfbV1DecisionBundle, getCfbV1Forecast, type CfbV1Forecast } from "../lib/services/football/cfbV1Decision";
import { applyCfbMarketSharpAwareGrades } from "../lib/services/football/cfbMarketSharpAwareShadow";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";

const at = "2026-10-29T19:30:00Z", starts = "2026-10-29T23:30:00Z";
const target: NcaafBookOdds = {
  providerGameId: "458441", sportsbook: "FanDuel", provider: "balldontlie", targetEligible: true,
  observedAt: at, moneyline: null, total: null,
  spread: { homeLine: -18.5, awayLine: 18.5, homePrice: -110, awayPrice: -110 },
};
function forecast(probability = .5566505898366622): CfbV1Forecast {
  const pmf = [{ home: 40, away: 14, probability }, { home: 24, away: 14, probability: 1 - probability }];
  const home = 40 * probability + 24 * (1 - probability);
  return { ...getCfbV1Forecast("457157"), providerGameId: target.providerGameId, gameStartsAt: starts,
    homeTeam: "JMU", awayTeam: "TROY", pmf, expectedHomePoints: home, expectedAwayPoints: 14,
    expectedMarginHome: home - 14, expectedTotal: home + 14, homeWinProbability: 1,
    representativeScore: { home: 40, away: 14 } };
}
function build(books: NcaafBookOdds[], extra: Partial<Parameters<typeof buildCfbV1DecisionBundle>[0]> = {}) {
  return buildCfbV1DecisionBundle({ providerGameId: target.providerGameId, awayTeam: "TROY", homeTeam: "JMU",
    gameStartsAt: starts, comparableCurrentBooks: books, evaluatedAt: at, forecast: forecast(), ...extra });
}
const before = JSON.stringify(target);
const one = build([target]);
assert.equal(one.evaluatedBets.length, 1);
assert.equal(one.evaluatedBets[0]!.consensus.source, "target_paired_price_context");
assert.deepEqual(one.evaluatedBets[0]!.consensus.books, []);
assert.equal(one.evaluatedBets[0]!.consensus.fairProbability, .5);
assert.ok(Math.abs(one.evaluatedBets[0]!.expectedValue - .06269658059726413) < 1e-12);
const graded = applyCfbMarketSharpAwareGrades({ bundle: one, homeTeam: "JMU", sharpSplits: [], operationalOpening: null });
assert.equal(graded.evaluatedBets[0]!.grade, "Lean", "the actual zero-comparator offer reaches normal full grading");
const totalBook = { ...target, spread: null, total: { line: 50.5, overPrice: -110, underPrice: -110 } };
const total = applyCfbMarketSharpAwareGrades({ bundle: build([totalBook], { forecast: forecast(.63) }), homeTeam: "JMU", sharpSplits: [], operationalOpening: null });
assert.equal(total.evaluatedBets[0]!.grade, "Best Angle", "comparison count cannot impose an artificial Watchlist ceiling");
const two = build([target, { ...target, sportsbook: "DraftKings" }]);
assert.equal(two.evaluatedBets[0]!.consensus.source, "target_excluded_same_line_named_books");
assert.equal(two.evaluatedBets[0]!.consensus.books.length, 1);
const three = [target, { ...target, sportsbook: "DraftKings" }, { ...target, sportsbook: "BetMGM" }];
assert.deepEqual(build(three), build(three, { priceContextPolicy: "legacy_three_book_consensus" }), "already priced decisions remain exact");
const differentLine = { ...target, sportsbook: "BetMGM", spread: { ...target.spread!, homeLine: -19, awayLine: 19 } };
assert.deepEqual(build([target, differentLine]).evaluatedBets[0]!.consensus.books, [], "nearby lines are not identical-line comparisons");
assert.equal(build([target], { priceContextPolicy: "legacy_three_book_consensus" }).evaluatedBets.length, 0);
assert.equal(build([target], { healthHolds: ["quarterback_status_unverified"] }).evaluatedBets.length, 0);
assert.equal(build([target], { calibrationContract: "legacy_independent_artifact" }).evaluatedBets.length, 0);
for (const book of [
  { ...target, observedAt: "2026-10-29T17:00:00Z" },
  { ...target, marketObservedAt: { spread: "2026-10-29T20:00:00Z" } },
  { ...target, providerGameId: "different-game" },
  { ...target, provider: "owls" as const },
  { ...target, targetEligible: false },
  { ...target, spread: { ...target.spread!, awayLine: 19 } },
  { ...target, spread: { ...target.spread!, homePrice: 0 } },
  { ...target, spread: { ...target.spread!, awayPrice: NaN } },
  { ...target, marketSelection: { spread: "coherent_paired_alternate" as const } },
]) assert.equal(build([book]).evaluatedBets.length, 0);
assert.equal(build([target, { ...target, spread: { ...target.spread!, homePrice: -105 } }]).evaluatedBets.length, 0, "conflicting target quotes cannot self-certify");
assert.equal(build([target], { evaluatedAt: starts }).evaluatedBets.length, 0);
const badValue = applyCfbMarketSharpAwareGrades({ bundle: build([target], { forecast: forecast(.52) }), homeTeam: "JMU", sharpSplits: [], operationalOpening: null });
assert.notEqual(badValue.evaluatedBets[0]!.grade, "Lean");
assert.notEqual(badValue.evaluatedBets[0]!.grade, "Best Angle");
assert.equal(JSON.stringify(target), before);
const locked = build([target], { stage: "t60_locked", evaluatedAt: "2026-10-29T22:30:00Z", lockedAt: "2026-10-29T22:30:00Z", comparableCurrentBooks: [{ ...target, observedAt: "2026-10-29T22:29:00Z" }] });
assert.equal(locked.trackingEnabled, true, "a valid future lock is not blocked by comparator count");
console.log("CFB paired-price context: real zero/one-comparator grades, exact incumbent preservation, full grade ladder, price/freshness/identity/health guards and future lock eligibility passed.");
