import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "@/lib/services/football/balldontlieNflPreviewSlate";
import { applyNflMarketInnovationRuntime, readNflMarketInnovation } from "@/lib/services/football/nflMarketInnovationRuntime";
import { buildNflMarketState } from "@/lib/services/football/nflMarketState";
import type { NflForwardContextMarket } from "@/lib/services/football/nflForwardEvidenceCapture";
import { applyNflMarketInnovationPosture } from "@/lib/services/football/nflMarketInnovationPosture";
import { buildNflV1ActionableGradeBundle } from "@/lib/services/football/nflV1ActionableGradeCandidate";
import { buildNflMarketQualification } from "@/lib/services/football/nflMarketQualification";
import { qualifyNflOwlsSplitsForSourceReaction } from "@/lib/services/football/nflOwlsSplits";
import type { NflRegularSharpSplitSet } from "@/lib/services/football/sharpApiNflSplits";
import { buildNflIndependentScoreBaseForecast, getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities } from "@/lib/services/football/nflV1WeekOneOutcome";

type Market = "moneyline" | "spread" | "total";
type Direction = -1 | 1;
const openingAt = "2026-11-02T12:00:00.000Z", currentAt = "2026-11-02T14:00:00.000Z";
const evaluatedAt = "2026-11-02T14:30:00.000Z", gameStartsAt = "2026-11-02T18:00:00.000Z";
const raw = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const american = (p: number) => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const pair = (firstP: number) => [american(firstP), american(1 - firstP)] as const;
const independent = (margin: number, total: number) => buildNflIndependentScoreBaseForecast({
  baseForecast: raw, independentScore: { expectedHomeMargin: margin, expectedTotal: total,
    marketInputPolicy: "prohibited_from_independent_score" } });
const withDistribution = (forecast: ReturnType<typeof independent>, axis: "marginDistribution" | "totalDistribution",
  values: number[], probabilities: number[]) => {
  const result = { ...forecast, [axis]: { values, probabilities } };
  const mean = (d: typeof result.marginDistribution) => d.values.reduce((sum, v, i) => sum + v * d.probabilities[i]!, 0);
  const margin = mean(result.marginDistribution), total = mean(result.totalDistribution);
  const h = result.marginDistribution.values.reduce((sum, v, i) => sum + (v > 0 ? result.marginDistribution.probabilities[i]! : 0), 0);
  const a = result.marginDistribution.values.reduce((sum, v, i) => sum + (v < 0 ? result.marginDistribution.probabilities[i]! : 0), 0);
  return { ...result, expectedHomeScore: (total + margin) / 2, expectedAwayScore: (total - margin) / 2,
    sourceExpectedHomeScore: (total + margin) / 2, sourceExpectedAwayScore: (total - margin) / 2,
    homeWinProbability: h / (h + a), awayWinProbability: a / (h + a), tieProbability: 1 - h - a };
};

function fixture(market: Market, direction: Direction, initialGrade: "Watchlist" | "Lean", edgeOverride?: number,
  seed?: { margin?: number; total?: number }) {
  let base = independent(seed?.margin ?? direction * 7, seed?.total ?? (market === "total" ? direction > 0 ? 50 : 43 : 47));
  if (initialGrade === "Watchlist" && market === "spread") base = direction > 0
    ? withDistribution(base, "marginDistribution", [-2, 2, 4], [.05, .3, .65])
    : withDistribution(base, "marginDistribution", [-4, -2, 2], [.65, .3, .05]);
  if (initialGrade === "Watchlist" && market === "total") base = withDistribution(base,
    "totalDistribution", direction > 0 ? [43, 46, 47, 53] : [40, 46, 47, 50],
    direction > 0 ? [.15, .325, .325, .2] : [.2, .325, .325, .15]);
  const homeLine = -direction * (initialGrade === "Watchlist" && market === "spread" ? 3 : 3.5);
  const totalLine = 46.5;
  const source = (at: string, current: boolean): NflPreviewBookOdds => {
    const [homePrice, awayPrice] = pair(.5 + (current && market === "moneyline" ? direction * .05 : 0));
    const sourceSpread = -homeLine + (current && initialGrade !== "Watchlist" ? direction : 0);
    const first = current && initialGrade === "Watchlist" && direction > 0 ? market === "spread" ? -120 : -111 : -110;
    const second = current && initialGrade === "Watchlist" && direction < 0 ? market === "spread" ? -120 : -111 : -110;
    return { providerGameId: raw.providerGameId, providerEventId: "exact", provider: "owls", sportsbook: "circa", observedAt: at,
      moneyline: market === "moneyline" ? { homePrice, awayPrice } : null,
      spread: market === "spread" ? { homeLine: -sourceSpread, awayLine: sourceSpread, homePrice: first, awayPrice: second } : null,
      total: market === "total" ? { line: totalLine + (current && initialGrade !== "Watchlist" ? direction : 0),
        overPrice: first, underPrice: second } : null };
  };
  const history = [source(openingAt, false), source(currentAt, true)];
  const read = readNflMarketInnovation({ independentForecast: base, independentInputPolicy: "market_inputs_prohibited",
    history, evaluatedAt, gameStartsAt, excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } });
  const lines = nflV1WeekOneLineProbabilities({ forecast: read.outcome, homeSpread: homeLine, totalLine });
  const pickedProbability = market === "moneyline" ? direction > 0 ? read.outcome.homeWinProbability : read.outcome.awayWinProbability
    : market === "spread" ? direction > 0 ? lines.spread.homeCoverProbability : lines.spread.awayCoverProbability
      : direction > 0 ? lines.total.overProbability : lines.total.underProbability;
  const edge = edgeOverride ?? (initialGrade === "Watchlist" && market === "total" ? .015 : .02);
  const comparatorFirst = direction > 0 ? pickedProbability - edge : 1 - (pickedProbability - edge);
  const [referenceFirst, referenceSecond] = [american(comparatorFirst * 1.1), american((1 - comparatorFirst) * 1.1)];
  const books: NflPreviewBookOdds[] = ["draftkings", "fanduel", "betmgm"].map((sportsbook, index) => {
    const firstPrice = index ? referenceFirst : market === "moneyline" ? direction > 0 ? -160 : 140
      : market === "total" && initialGrade === "Watchlist" ? 100 : -110;
    const secondPrice = index ? referenceSecond : market === "moneyline" ? direction > 0 ? 140 : -160
      : market === "total" && initialGrade === "Watchlist" ? 100 : -110;
    return { providerGameId: raw.providerGameId, sportsbook, observedAt: currentAt,
      moneyline: market === "moneyline" ? { homePrice: firstPrice, awayPrice: secondPrice } : { homePrice: -110, awayPrice: -110 },
      spread: { homeLine, awayLine: -homeLine, homePrice: market === "spread" ? firstPrice : -110,
        awayPrice: market === "spread" ? secondPrice : -110 },
      total: { line: totalLine, overPrice: market === "total" ? firstPrice : -110,
        underPrice: market === "total" ? secondPrice : -110 } };
  });
  const marketQualification = Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m,
    buildNflMarketQualification({ market: m, providerGameId: raw.providerGameId, evaluatedAt, gameStartsAt, forecast: read.outcome,
      basis: read.receipt.selectedSources[m] ? "source_bound_joint_innovation" : "market_free_independent_law",
      independentInputPolicy: "market_inputs_prohibited", sourceMarketId: `${raw.providerGameId}:${m}`,
      sourceReceipt: JSON.stringify({ release: read.receipt.release, source: read.receipt.selectedSources[m] ?? "independent_exact_stat",
        episodes: read.receipt.episodes.filter(e => e.market === m && e.selected),
        constraints: read.receipt.constraints.filter(c => c.market === m) }), evidenceQualified: true }),
  ]));
  const shadowMoneyline = { health: { blockingReasons: [] }, decisionStage: "unlocked", lockedAt: null, evaluatedAt,
    evaluatedQuote: { sportsbook: books[0]!.sportsbook, line: null, price: direction > 0 ? -160 : 140, observedAt: currentAt },
    team: "JAX", modelProbability: read.outcome.homeWinProbability, otherBooksConsensusFairProbability: .5,
  } as unknown as Parameters<typeof buildNflV1ActionableGradeBundle>[0]["shadowMoneyline"];
  const gradeArgs = { providerGameId: raw.providerGameId, awayTeam: "CLE", homeTeam: "JAX",
    gameStartsAt, current: books[0]!, comparableCurrentBooks: books, shadowMoneyline, outcomeForecast: read.outcome, marketQualification };
  const production = buildNflV1ActionableGradeBundle(gradeArgs);
  const promotionContext = { independentForecast: base, finalForecast: read.outcome, marketQualification,
    books, referenceBooks: books, executionAvailableAt: evaluatedAt };
  return { market, direction, initialGrade, base, read, books, history, production, promotionContext, gradeArgs,
    selected: production.evaluatedBets.find(b => b.market === market)! };
}

const fixtures = (["moneyline", "spread", "total"] as const).flatMap(market => ([1, -1] as const).flatMap(direction =>
  (market === "moneyline" ? ["Lean"] as const : ["Watchlist", "Lean"] as const).map(grade => fixture(market, direction, grade))));
const promote = (f: typeof fixtures[number], overrides: Partial<Parameters<typeof applyNflMarketInnovationPosture>[0]> = {}) =>
  applyNflMarketInnovationPosture({ production: f.production, innovation: f.read.receipt,
    homeTeam: "JAX", promotionContext: f.promotionContext, ...overrides });
let watchPromotions = 0, bestPromotions = 0;
for (const f of fixtures) {
  assert.equal(f.selected.grade, f.initialGrade, `${f.market}/${f.direction} must begin with the actual foundation grade`);
  const after = promote(f);
  const decision = after.production.evaluatedBets.find(b => b.market === f.market)!;
  assert.equal(decision.grade, f.initialGrade === "Watchlist" ? "Lean" : "Best Angle",
    JSON.stringify(after.posture.evaluations.find(e => e.market === f.market)));
  assert.ok(f.selected.modelProbability - f.selected.marketFairProbability > 0 &&
    f.selected.modelProbability - f.selected.marketFairProbability < .04,
  "these real initial grades lack the old four-point comparator gap");
  assert.deepEqual({ ...decision, grade: f.selected.grade }, f.selected,
    "confirmation changes only conviction; exact probabilities, odds, EV, side and clocks remain unchanged");
  assert.deepEqual(promote(f), after, "rebuilding from identical authoritative foundation and evidence is stable");
  assert.strictEqual(promote(f, { production: after.production }).production, after.production,
    "reapplying an already promoted result with identical evidence cannot ratchet Watchlist through Lean to Best Angle");
  const absent = applyNflMarketInnovationPosture({ production: f.production, innovation: f.read.receipt, homeTeam: "JAX" });
  assert.strictEqual(absent.production, f.production, "legacy callers without complete context cannot promote");
  if (f.initialGrade === "Watchlist") {
    watchPromotions++;
    assert.equal(after.posture.boardImpact.watchlistToLean, 1);
    assert.equal(after.posture.boardImpact.leanToBestAngle, 0, "one invocation cannot leap from Watchlist to Best Angle");
    assert.equal(after.posture.boardImpact.actionableAfter, after.posture.boardImpact.actionableBefore + 1);
  } else {
    bestPromotions++;
    assert.equal(after.posture.boardImpact.leanToBestAngle, 1);
    assert.equal(after.posture.boardImpact.actionableAfter, after.posture.boardImpact.actionableBefore);
  }
}
assert.equal(watchPromotions, 4);
assert.equal(bestPromotions, 6);

const f = fixtures.find(f => f.market === "spread" && f.direction === 1 && f.initialGrade === "Lean")!;
const retain = (overrides: Partial<Parameters<typeof applyNflMarketInnovationPosture>[0]>, why: string) => {
  const result = promote(f, overrides);
  assert.equal(result.production.evaluatedBets.find(b => b.market === f.market)!.grade, f.selected.grade,
    `${why}: ${JSON.stringify(result.posture.evaluations.find(e => e.market === f.market))}`);
};
for (const invalid of [
  { ...f.promotionContext.marketQualification.spread!, evidenceQualified: false },
  { ...f.promotionContext.marketQualification.spread!, providerGameId: "other-game" },
  { ...f.promotionContext.marketQualification.spread!, forecastSha256: "bad-hash" },
  { ...f.promotionContext.marketQualification.spread!, market: "total" as const },
  { ...f.promotionContext.marketQualification.spread!, basis: "market_free_independent_law" as const },
  { ...f.promotionContext.marketQualification.spread!, sourceReceipt: "" },
  { ...f.promotionContext.marketQualification.spread!, sourceMarketId: "" },
]) retain({ promotionContext: { ...f.promotionContext,
  marketQualification: { ...f.promotionContext.marketQualification, spread: invalid } } }, "invalid final-law qualification");
retain({ promotionContext: { ...f.promotionContext, independentForecast: f.read.outcome } },
  "a source already consumed by the independent law cannot be counted again");
for (const executionAvailableAt of [openingAt, "2026-11-02T15:00:00.000Z", "invalid"]) retain({
  promotionContext: { ...f.promotionContext, executionAvailableAt },
}, "unreobserved or future executable batch");
retain({ promotionContext: { ...f.promotionContext, finalForecast: { ...f.read.outcome, homeTeam: "SEA" } } }, "wrong forecast team");
retain({ innovation: { ...f.read.receipt, selectedSources: {}, episodes: f.read.receipt.episodes.map(e => ({ ...e, selected: false })) } },
  "no actual selected same-market consequence");
retain({ innovation: { ...f.read.receipt, marketQualificationStatus: { ...f.read.receipt.marketQualificationStatus!,
  spread: { status: "unavailable", reason: "invalid_source" } } } }, "unavailable source law");
retain({ innovation: { ...f.read.receipt, paths: f.read.receipt.paths?.map(p => ({ ...p, currentAt: openingAt })) } }, "stale path");
retain({ innovation: { ...f.read.receipt, paths: f.read.receipt.paths?.map(p => ({ ...p, latestEconomicDirection: -1 })) } },
  "current opposing economic leg");
retain({ promotionContext: { ...f.promotionContext, books: [], referenceBooks: [] } }, "missing executable source pair");
retain({ promotionContext: { ...f.promotionContext, books: f.books.slice(0, 2), referenceBooks: f.books.slice(0, 2) } },
  "one comparator alone cannot waive reliability");
const wrongLineBooks = f.books.map((book, i) => i ? book : { ...book,
  spread: { ...book.spread!, homeLine: -4, awayLine: 4 } });
retain({ promotionContext: { ...f.promotionContext, books: wrongLineBooks } }, "different execution contract");
const selfSource = { ...f.read.receipt, selectedSources: { ...f.read.receipt.selectedSources, spread: "draftkings" },
  episodes: f.read.receipt.episodes.map(e => ({ ...e, book: "draftkings" as const })),
  paths: f.read.receipt.paths?.map(p => ({ ...p, book: "draftkings" })) } as unknown as typeof f.read.receipt;
retain({ innovation: selfSource }, "evaluated sportsbook cannot confirm its own selected price");
for (const field of ["modelProbability", "marketFairProbability", "expectedValue"] as const) {
  const corrupted = { ...f.production, evaluatedBets: f.production.evaluatedBets.map(b => b.market === "spread"
    ? { ...b, [field]: b[field] + .01 } : b) };
  retain({ production: corrupted }, `corrupted ${field} cannot promote`);
}
const staleBooks = f.books.map(book => ({ ...book, observedAt: "2026-11-02T11:00:00.000Z" }));
retain({ promotionContext: { ...f.promotionContext, books: staleBooks, referenceBooks: staleBooks } },
  "an availability claim cannot revive stale underlying quote evidence");

const stalePriceAt = "2026-11-02T13:00:00.000Z";
const reobservedBooks = f.books.map((book, i) => i ? book : { ...book, observedAt: stalePriceAt });
const reobservedProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs,
  current: reobservedBooks[0]!, comparableCurrentBooks: reobservedBooks });
const reobserved = promote(f, { production: reobservedProduction,
  promotionContext: { ...f.promotionContext, books: reobservedBooks, referenceBooks: reobservedBooks } });
assert.equal(reobserved.production.evaluatedBets.find(b => b.market === "spread")!.grade, "Best Angle",
  "an unchanged price with an older change clock remains executable after actual successful reobservation");
const earlyPageBooks = reobservedBooks.map((book, i) => ({ ...book,
  availableAt: i ? "2026-11-02T14:10:00.000Z" : "2026-11-02T13:55:00.000Z" }));
const earlyPageProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs,
  current: earlyPageBooks[0]!, comparableCurrentBooks: earlyPageBooks });
assert.equal(earlyPageProduction.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean");
assert.equal(promote(f, { production: earlyPageProduction,
  promotionContext: { ...f.promotionContext, books: earlyPageBooks, referenceBooks: earlyPageBooks,
    executionAvailableAt: evaluatedAt } }).production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean",
  "a later aggregate slate clock cannot refresh an early response page collected before the actual sharp move");
const heldAfterMove = readNflMarketInnovation({ independentForecast: f.base, independentInputPolicy: "market_inputs_prohibited",
  history: [...f.history, { ...f.history[1]!, observedAt: "2026-11-02T14:20:00.000Z" }], evaluatedAt, gameStartsAt,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } });
assert.equal(heldAfterMove.receipt.paths?.find(p => p.market === "spread" && p.book === "circa")!.latestEconomicMoveAt, currentAt);
const afterMoveBooks = f.books.map(book => ({ ...book, availableAt: "2026-11-02T14:10:00.000Z" }));
const afterMoveProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs,
  current: afterMoveBooks[0]!, comparableCurrentBooks: afterMoveBooks });
assert.equal(promote(f, { production: afterMoveProduction, innovation: heldAfterMove.receipt,
  promotionContext: { ...f.promotionContext, books: afterMoveBooks, referenceBooks: afterMoveBooks } })
  .production.evaluatedBets.find(b => b.market === "spread")!.grade, "Best Angle",
"a quote reobserved after the actual economic leg need not wait for another unchanged sharp-book refresh");
const slowResponseBooks = afterMoveBooks.map(book => ({ ...book,
  requestedAt: "2026-11-02T13:55:00.000Z" }));
const slowResponseProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs,
  current: slowResponseBooks[0]!, comparableCurrentBooks: slowResponseBooks });
assert.equal(promote(f, { production: slowResponseProduction,
  promotionContext: { ...f.promotionContext, books: slowResponseBooks, referenceBooks: slowResponseBooks } })
  .production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean",
"a request begun before the sharp move cannot establish post-move reobservation merely by responding slowly afterward");
const afterMoveRequestBooks = afterMoveBooks.map(book => ({ ...book,
  requestedAt: "2026-11-02T14:05:00.000Z" }));
const afterMoveRequestProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs,
  current: afterMoveRequestBooks[0]!, comparableCurrentBooks: afterMoveRequestBooks });
assert.equal(promote(f, { production: afterMoveRequestProduction,
  promotionContext: { ...f.promotionContext, books: afterMoveRequestBooks, referenceBooks: afterMoveRequestBooks } })
  .production.evaluatedBets.find(b => b.market === "spread")!.grade, "Best Angle",
"a successful actual request begun after the source move can supply the required execution reobservation");

const badBooks = f.books.map(book => ({ ...book, spread: { ...book.spread!, homePrice: -200, awayPrice: 150 } }));
const badProduction = buildNflV1ActionableGradeBundle({ ...f.gradeArgs, current: badBooks[0]!, comparableCurrentBooks: badBooks });
const bad = promote(f, { production: badProduction, promotionContext: { ...f.promotionContext, books: badBooks, referenceBooks: badBooks } });
assert.equal(badProduction.evaluatedBets.find(b => b.market === "spread")!.grade, "No Play");
assert.equal(bad.production.evaluatedBets.find(b => b.market === "spread")!.grade, "No Play",
  "actual negative-price-value No Play never promotes");

const noEdge = fixture("spread", 1, "Lean", 0);
const zeroResult = promote(noEdge);
assert.equal(zeroResult.production.evaluatedBets.find(b => b.market === "spread")!.grade, noEdge.selected.grade,
  "no comparator advantage cannot become market-confirmed value, including floating-point reconstruction noise");
const belowBestFloor = fixture("total", 1, "Lean", undefined, { total: 49.5 });
assert.equal(belowBestFloor.selected.grade, "Lean");
assert.ok(belowBestFloor.selected.modelProbability < .59 && belowBestFloor.selected.expectedValue > .035);
assert.equal(promote(belowBestFloor).production.evaluatedBets.find(b => b.market === "total")!.grade, "Lean",
  "clean market confirmation does not waive the retained 59% strongest-tier probability floor");
const moneylineFloor = fixtures.find(x => x.market === "moneyline" && x.direction === 1)!;
const steepBooks = moneylineFloor.books.map((book, i) => i ? book : { ...book,
  moneyline: { homePrice: -210, awayPrice: 190 } });
const steepProduction = buildNflV1ActionableGradeBundle({ ...moneylineFloor.gradeArgs,
  current: steepBooks[0]!, comparableCurrentBooks: steepBooks });
assert.equal(steepProduction.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Lean");
assert.equal(promote(moneylineFloor, { production: steepProduction,
  promotionContext: { ...moneylineFloor.promotionContext, books: steepBooks, referenceBooks: steepBooks } })
  .production.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Lean",
"positive value alone cannot promote a Moneyline outside the retained -200 strongest-tier price floor");

// A real numerical market correction can improve a pre-market Moneyline
// Watchlist into an actual foundation Lean. The posture layer never fabricates
// that Watchlist or relaxes its poor-value guards to force a promotion.
for (const direction of [1, -1] as const) {
  const first = fixtures.find(x => x.market === "moneyline" && x.direction === direction)!;
  const prior = direction > 0 ? first.base.homeWinProbability : first.base.awayWinProbability;
  const corrected = fixture("moneyline", direction, "Lean", first.selected.modelProbability - prior - .005);
  const before = buildNflV1ActionableGradeBundle({ ...corrected.gradeArgs, outcomeForecast: corrected.base });
  assert.equal(before.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Watchlist");
  assert.equal(corrected.selected.grade, "Lean");
  assert.ok(corrected.selected.modelProbability > prior);
  assert.equal(promote(corrected).production.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Best Angle");
  const markets = ["moneyline", "spread", "total"] as const;
  const firstSource = corrected.history[0]!.moneyline!, lastSource = corrected.history[1]!.moneyline!;
  const families: NflForwardContextMarket["families"] = [["circa", "o", "c", null,
    [openingAt, 0, "f", null, firstSource.awayPrice, firstSource.homePrice],
    [currentAt, 0, "f", null, lastSource.awayPrice, lastSource.homePrice]]];
  const snapshots = [{ capturedAt: currentAt, markets: { moneyline: { families },
    spread: { families: [] }, total: { families: [] } } }];
  const states = Object.fromEntries(markets.map(market => [market, buildNflMarketState({ market, evaluatedAt,
    snapshots, current: { spread: { homeLine: corrected.books[0]!.spread!.homeLine },
      total: { line: corrected.books[0]!.total!.line } }, playbookLine: null, playbookSplits: null, sharpSplits: null,
  })])) as Record<Market, ReturnType<typeof buildNflMarketState>>;
  const runtime = applyNflMarketInnovationRuntime({ providerGameId: raw.providerGameId,
    awayTeam: "CLE", homeTeam: "JAX", gameStartsAt, evaluatedAt, releasedForecast: corrected.base,
    baselineProduction: before, current: corrected.books[0]!, comparableCurrentBooks: corrected.books,
    shadowMoneyline: corrected.gradeArgs.shadowMoneyline, targetExcludedMarket: null, states,
    excludedFamiliesByMarket: { moneyline: ["draftkings"], spread: ["draftkings"], total: ["draftkings"] },
    playbookSplits: null, sharpSplits: null, forecastCandidates: [{ source: "independent_statistical", forecast: corrected.base }],
    availability: { injuriesAvailable: true, injuryReportUpdatedAt: currentAt, injuryPlayerCount: 0,
      expectedQuarterbacksAvailable: true, playerAwareForecastAvailable: true, weatherAvailable: true },
    history: corrected.history, independentInputPolicy: "market_inputs_prohibited", executionAvailableAt: evaluatedAt,
  });
  assert.equal(runtime.production.evaluatedBets.find(b => b.market === "moneyline")!.grade, "Best Angle");
  assert.equal(runtime.innovation.posture!.evaluations.find(e => e.market === "moneyline")!.previousGrade, "Lean",
    "the complete runtime first earns a foundation Lean from corrected probability, then applies one conviction tier");
  assert.deepEqual(runtime.outcome.marginDistribution, corrected.read.outcome.marginDistribution);
}

// Verified named money pressure met by an unchanged source quote is a
// resistance observation. It blocks stronger endorsement, without inventing
// a point correction or converting a qualified actionable into No Play.
const sourcePair = (at: string): NflPreviewBookOdds => ({ providerGameId: raw.providerGameId,
  providerEventId: "exact", provider: "owls", sportsbook: "pinnacle", observedAt: at,
  moneyline: null, total: null, spread: { homeLine: -3.5, awayLine: 3.5, homePrice: -110, awayPrice: -110 } });
const heldHistory = [...f.history, sourcePair(openingAt), sourcePair(currentAt)];
const heldRow = { provider: "owls" as const, providerGameId: raw.providerGameId, sourceEventId: "exact",
  sourceSportsbook: "pinnacle", capturedAt: evaluatedAt, providerFetchedAt: "2026-11-02T13:00:00.000Z",
  sourceLine: -3.5, homeMoneyPct: 83, awayMoneyPct: 17, homeBetsPct: 56, awayBetsPct: 44,
  overMoneyPct: 60, underMoneyPct: 40, overBetsPct: 40, underBetsPct: 60 };
const heldSplits: NflRegularSharpSplitSet = { moneyline: { ...heldRow, sourceLine: null },
  spread: heldRow, total: { ...heldRow, sourceLine: 46.5 } };
const sourceFlow = qualifyNflOwlsSplitsForSourceReaction({ splits: heldSplits, providerGameId: raw.providerGameId,
  evaluatedAt, gameStartsAt, history: heldHistory, excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } });
assert.ok(sourceFlow.flows.spread?.length);
const heldRead = readNflMarketInnovation({ independentForecast: f.base, independentInputPolicy: "market_inputs_prohibited",
  history: heldHistory, evaluatedAt, gameStartsAt, excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] },
  marketReactionContext: { spread: { books: [], flows: sourceFlow.flows.spread! } } });
assert.deepEqual(heldRead.outcome, f.read.outcome, "held pressure creates no second numerical forecast update");
const held = promote(f, { innovation: heldRead.receipt });
assert.equal(held.production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean");
assert.ok(held.posture.evaluations.find(e => e.market === "spread")!.confirmation?.heldResistanceSources.includes("pinnacle"));
const earnedBest = fixture("spread", 1, "Lean", .05);
assert.equal(earnedBest.selected.grade, "Best Angle");
const heldBest = promote(earnedBest, { innovation: heldRead.receipt });
assert.equal(heldBest.production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean");
assert.equal(heldBest.posture.boardImpact.bestAngleToLean, 1);
assert.equal(heldBest.posture.boardImpact.actionableAfter, heldBest.posture.boardImpact.actionableBefore);
const newerOpposingPressure = qualifyNflOwlsSplitsForSourceReaction({ splits: { ...heldSplits,
  spread: { ...heldRow, providerFetchedAt: "2026-11-02T13:30:00.000Z", homeMoneyPct: 17, awayMoneyPct: 83 } },
  providerGameId: raw.providerGameId, evaluatedAt, gameStartsAt, history: heldHistory,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } });
const revisedFlows = [...sourceFlow.flows.spread!, ...newerOpposingPressure.flows.spread!];
const revisedPressureRead = readNflMarketInnovation({ independentForecast: f.base,
  independentInputPolicy: "market_inputs_prohibited", history: heldHistory, evaluatedAt, gameStartsAt,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] },
  marketReactionContext: { spread: { books: [], flows: revisedFlows } } });
const revisedPressure = promote(f, { innovation: revisedPressureRead.receipt });
assert.equal(revisedPressure.production.evaluatedBets.find(b => b.market === "spread")!.grade, "Best Angle",
  "newer opposing pressure met by held prices clears the older picked-side held-pressure risk");
assert.deepEqual(revisedPressure.posture.evaluations.find(e => e.market === "spread")!.confirmation!.heldResistanceSources, []);
assert.deepEqual(promote(f, { innovation: { ...revisedPressureRead.receipt, reactionContext: {
  spread: { books: [], flows: [...revisedFlows].reverse() },
} } }).production.evaluatedBets, revisedPressure.production.evaluatedBets,
"pressure chronology, not input ordering, determines the exact final decision tuples");
assert.equal(promote(f, { innovation: { ...revisedPressureRead.receipt, selectedSources: {},
  episodes: revisedPressureRead.receipt.episodes.map(e => ({ ...e, selected: false })) } })
  .production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean",
  "clearing obsolete pressure cannot promote without an actual independently selected other-book consequence");
const conflictingPressure = { ...newerOpposingPressure.flows.spread![0]!, direction: 1 as const,
  moneyPct: 83, ticketPct: 56 };
assert.equal(promote(f, { innovation: { ...revisedPressureRead.receipt, reactionContext: {
  spread: { books: [], flows: [...revisedFlows, conflictingPressure] },
} } }).production.evaluatedBets.find(b => b.market === "spread")!.grade, "Lean",
"conflicting pressure records at the same source clock block promotion without an arbitrary winner");
const opposingHistory = [...f.history, sourcePair(openingAt),
  { ...sourcePair("2026-11-02T13:00:00.000Z"), spread: { ...sourcePair(currentAt).spread!, homeLine: -6, awayLine: 6 } },
  { ...sourcePair(currentAt), spread: { ...sourcePair(currentAt).spread!, homeLine: -4.5, awayLine: 4.5 } }];
const currentOpposition = readNflMarketInnovation({ independentForecast: f.base, independentInputPolicy: "market_inputs_prohibited",
  history: opposingHistory, evaluatedAt, gameStartsAt, excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } });
assert.equal(currentOpposition.receipt.selectedSources.spread, "circa");
assert.ok(currentOpposition.receipt.paths?.find(p => p.book === "pinnacle" && p.market === "spread")?.hasUnresolvedAdverseLeg);
assert.equal(promote(f, { innovation: currentOpposition.receipt }).production.evaluatedBets.find(b => b.market === "spread")!.grade,
  "Lean", "a genuine fresh adverse leg at another named book prevents a clean-confirmation upgrade");

for (const context of [f.promotionContext, undefined]) {
  const before = JSON.stringify(f.production);
  const existing = promote(f, { existingLockedRecord: true, creatingNewLock: true, promotionContext: context });
  assert.strictEqual(existing.production, f.production);
  assert.equal(JSON.stringify(f.production), before, "stored records take precedence over every new promotion lane");
}
const newLockProduction = { ...f.production, evaluatedBets: f.production.evaluatedBets.map(b => ({
  ...b, stage: "t60_locked" as const, lockedAt: b.evaluatedAt,
})) };
const freshLock = promote(f, { production: newLockProduction, creatingNewLock: true });
assert.equal(freshLock.production.evaluatedBets.find(b => b.market === "spread")!.grade, "Best Angle");
assert.strictEqual(promote(f, { production: freshLock.production, existingLockedRecord: true }).production, freshLock.production);

console.log("NFL market grade promotions: 4 qualified Watch→Lean, 6 Lean→Best Angle; exact tuples, source/proof/price guards and immutable locks passed.");
