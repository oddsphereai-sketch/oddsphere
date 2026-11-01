import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import { buildNflV1ActionableGradeBundle } from "../lib/services/football/nflV1ActionableGradeCandidate";
import { applyNflFullGameEvidenceRuntime } from "../lib/services/football/nflFullGameEvidenceRuntime";
import { buildNflMarketState } from "../lib/services/football/nflMarketState";
import type { NflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
import { buildNflUnifiedMarketAdjustedForecast, getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities } from "../lib/services/football/nflV1WeekOneOutcome";

const at = "2026-11-01T12:00:00.000Z";
const kickoff = "2026-11-02T00:00:00.000Z";
const gameId = "fractional-axis-unit";
const awayTeam = "NE";
const homeTeam = "SEA";
// The small integer-supported component preserves a valid representative NFL
// score while the fractional mass reproduces the majority-side regrid defect.
const marginDistribution = { values: [-0.2, 0.1, 2, 4.2], probabilities: [0.4, 0.2, 0.01, 0.39] };
const totalDistribution = { values: [43.1, 45.4, 48, 52.7], probabilities: [0.3, 0.25, 0.01, 0.44] };
const margin = marginDistribution.values.reduce((sum, value, i) => sum + value * marginDistribution.probabilities[i]!, 0);
const total = totalDistribution.values.reduce((sum, value, i) => sum + value * totalDistribution.probabilities[i]!, 0);
const initial = getNflV1WeekOneOutcomeForecast({ providerGameId: gameId, awayTeam, homeTeam,
  weeklyFallback: { projectedHomeMargin: margin, marketTotal: total } });
const released: typeof initial = {
  ...initial, marginDistribution, totalDistribution,
  expectedAwayScore: (total - margin) / 2, expectedHomeScore: (total + margin) / 2,
  sourceExpectedAwayScore: (total - margin) / 2, sourceExpectedHomeScore: (total + margin) / 2,
  homeWinProbability: marginDistribution.probabilities[1]! + marginDistribution.probabilities[2]! + marginDistribution.probabilities[3]!,
  awayWinProbability: marginDistribution.probabilities[0]!, tieProbability: 0,
  representativeAwayScore: 23, representativeHomeScore: 25,
  representativeScoreProbability: 0.0001,
};
const books: NflPreviewBookOdds[] = ["draftkings", "fanduel", "betmgm"].map((sportsbook) => ({
  providerGameId: gameId, sportsbook, observedAt: at,
  moneyline: { homePrice: -110, awayPrice: -110 },
  spread: { homeLine: -2.5, awayLine: 2.5, homePrice: -110, awayPrice: -110 },
  total: { line: 45.5, overPrice: -110, underPrice: -110 },
}));
const shadowMoneyline = {
  health: { blockingReasons: [] }, decisionStage: "unlocked", lockedAt: null,
  evaluatedAt: at, evaluatedQuote: { sportsbook: books[0]!.sportsbook, line: null, price: -110, observedAt: at },
  team: homeTeam, modelProbability: released.homeWinProbability, otherBooksConsensusFairProbability: 0.5,
} as unknown as Parameters<typeof buildNflV1ActionableGradeBundle>[0]["shadowMoneyline"];
const commonGrade = { providerGameId: gameId, awayTeam, homeTeam, gameStartsAt: kickoff,
  current: books[0]!, comparableCurrentBooks: books, shadowMoneyline };
const baselineProduction = buildNflV1ActionableGradeBundle({ ...commonGrade, outcomeForecast: released });
assert.equal(baselineProduction.evaluatedBets.length, 3);
const baselineTotalBet = baselineProduction.evaluatedBets.find((bet) => bet.market === "total")!;
assert.equal(baselineTotalBet.side, "Under 45.5");
assert.ok(nflV1WeekOneLineProbabilities({ forecast: released, homeSpread: -2.5, totalLine: 45.5 })
  .total.underProbability > 0.5);

const landmark = (line: number | null, a: number, h: number, stamp: string) => [stamp, 0, "f", line, a, h] as const;
const statesFor = (market: "moneyline" | "total") => Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [
  name, buildNflMarketState({ market: name, evaluatedAt: at,
    snapshots: [{ capturedAt: at, markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map((key) => [key, {
      families: key === market ? ["circa", "pinnacle"].map((book) => [
        book, "s", book === "circa" ? "c" : "p", null,
        landmark(market === "total" ? 50.5 : null, -110, -110, "2026-11-01T10:00:00.000Z"),
        landmark(market === "total" ? 45.5 : null, market === "moneyline" ? -100 : -110,
          market === "moneyline" ? -120 : -110, at),
      ] as NflForwardContextMarket["families"][number]) : [],
    }])) as Record<"moneyline" | "spread" | "total", Pick<NflForwardContextMarket, "families">> }],
    current: { spread: { homeLine: -2.5 }, total: { line: 45.5 } },
    playbookLine: null, playbookSplits: null, sharpSplits: null,
  }),
])) as Parameters<typeof applyNflFullGameEvidenceRuntime>[0]["states"];
const excludedSideBooks = [...new Set(baselineProduction.evaluatedBets.filter((bet) => bet.market !== "total")
  .map((bet) => bet.evaluatedQuote.sportsbook))];
const excludedTotalBook = baselineTotalBet.evaluatedQuote.sportsbook;
const run = (market: "moneyline" | "total", existingLockedRecord = false) => {
  const newMargin = market === "moneyline" ? 1.7 : margin;
  const newTotal = market === "total" ? 44.5 : total;
  return applyNflFullGameEvidenceRuntime({ ...commonGrade,
    evaluatedAt: at, releasedForecast: released, baselineProduction,
    states: statesFor(market),
    targetExcludedMarket: { homeMargin: newMargin, total: newTotal,
      moneylineHomeFairProbability: 0.7, spreadHomeFairProbability: 0.5, totalOverFairProbability: 0.4,
      marginFamilyCount: 0, moneylineFamilyCount: market === "moneyline" ? 5 : 0,
      totalFamilyCount: market === "total" ? 5 : 0, availableMarkets: [market] },
    excludedFamiliesByMarket: { moneyline: excludedSideBooks, spread: excludedSideBooks, total: [excludedTotalBook] },
    playbookSplits: null, sharpSplits: null,
    forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: [market],
      marketValues: { [market]: market === "moneyline" ? newMargin : newTotal },
      forecast: { expectedAwayScore: (newTotal - newMargin) / 2, expectedHomeScore: (newTotal + newMargin) / 2 } }],
    availability: { injuriesAvailable: true, injuryReportUpdatedAt: at, injuryPlayerCount: 0,
      expectedQuarterbacksAvailable: true, playerAwareForecastAvailable: true, weatherAvailable: true },
    existingLockedRecord,
  });
};
const marginOnly = run("moneyline");
assert.equal(marginOnly.arbitration.status, "applied");
assert.ok(Math.abs(marginOnly.arbitration.finalHomeMargin - 1.7) < 1e-9);
assert.deepEqual(marginOnly.outcome.totalDistribution.values, totalDistribution.values);
assert.deepEqual(marginOnly.outcome.totalDistribution.probabilities, totalDistribution.probabilities,
  "a margin-only runtime correction cannot re-discretize the held fractional Total PMF");
const marginOnlyTotal = nflV1WeekOneLineProbabilities({ forecast: marginOnly.outcome, homeSpread: -2.5, totalLine: 45.5 });
assert.equal(marginOnlyTotal.total.underProbability, 0.55);
assert.equal(marginOnly.production.evaluatedBets.find((bet) => bet.market === "total")!.side, baselineTotalBet.side);
assert.equal(marginOnly.production.evaluatedBets.find((bet) => bet.market === "total")!.grade, baselineTotalBet.grade);

const totalOnly = run("total");
assert.equal(totalOnly.arbitration.status, "applied");
assert.ok(Math.abs(totalOnly.arbitration.finalTotal - 44.5) < 1e-9);
assert.deepEqual(totalOnly.outcome.marginDistribution.values, marginDistribution.values);
assert.deepEqual(totalOnly.outcome.marginDistribution.probabilities, marginDistribution.probabilities,
  "a Total-only runtime correction cannot re-discretize the held fractional margin PMF");
assert.equal(totalOnly.outcome.homeWinProbability, released.homeWinProbability);
assert.equal(totalOnly.outcome.awayWinProbability, released.awayWinProbability);
assert.equal(totalOnly.outcome.tieProbability, released.tieProbability);

// This control proves the fixture catches the original defect rather than
// merely comparing equal arrays from a naturally integer-supported PMF.
const regriddedControl = buildNflUnifiedMarketAdjustedForecast({ baseForecast: released,
  expectedHomeMargin: 1.7, expectedTotal: total, marketInputPolicy: "target_excluded_continuous_residual" });
assert.notDeepEqual(regriddedControl.totalDistribution.values, released.totalDistribution.values);
assert.ok(nflV1WeekOneLineProbabilities({ forecast: regriddedControl, homeSpread: -2.5, totalLine: 45.5 })
  .total.overProbability > 0.5, "re-discretizing this unchanged fractional Total would actually reverse its majority side");
const beforeLock = JSON.stringify({ released, baselineProduction });
const locked = run("moneyline", true);
assert.equal(locked.outcome, released);
assert.equal(locked.production, baselineProduction);
assert.equal(JSON.stringify({ released, baselineProduction }), beforeLock,
  "existing locked runtime objects remain exact and unmodified");
console.log("NFL unchanged-axis PMF runtime: fractional Total/margin, majority side, win probability and locks passed");
