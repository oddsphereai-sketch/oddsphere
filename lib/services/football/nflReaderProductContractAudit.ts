import type { NflForwardEvidencePayload } from "./nflForwardEvidence";
import { nflV1WeekOneLineProbabilities } from "./nflV1WeekOneOutcome";

/** Read-only checks of final published values, independent of the reader's status labels. */
export function auditNflReaderProductContract(payload: NflForwardEvidencePayload): string[] {
  const findings: string[] = [];
  const forecast = payload.outcomeForecast;
  const home = payload.game.home.abbreviation;
  const away = payload.game.away.abbreviation;
  const clock = Date.parse(payload.capturedAt);
  const bets = payload.decisions.evaluatedBets;
  if (bets.length !== 3 || new Set(bets.map((bet) => bet.market)).size !== 3) findings.push("incomplete_market_tuple");
  if (![forecast.expectedHomeScore, forecast.expectedAwayScore].every((value) => Number.isFinite(value) && value >= 0)) {
    findings.push("invalid_score");
  }
  for (const name of ["marginDistribution", "totalDistribution"] as const) {
    const distribution = forecast[name];
    if (distribution.values.length !== distribution.probabilities.length ||
        distribution.values.some((value) => !Number.isFinite(value)) ||
        distribution.probabilities.some((p) => !Number.isFinite(p) || p < 0) ||
        Math.abs(distribution.probabilities.reduce((a, b) => a + b, 0) - 1) > 1e-8) findings.push(`${name}:invalid_distribution`);
    const mean = distribution.values.reduce((sum, value, i) => sum + value * distribution.probabilities[i], 0);
    const expectedMean = name === "marginDistribution" ? forecast.expectedHomeScore - forecast.expectedAwayScore
      : forecast.expectedHomeScore + forecast.expectedAwayScore;
    if (!Number.isFinite(mean) || Math.abs(mean - expectedMean) > 1e-8) findings.push(`${name}:mean_score_disagreement`);
  }
  for (const bet of bets) {
    const prefix = `${bet.market}:`;
    const quote = bet.evaluatedQuote;
    if (bet.market === "total" ? ![`Over ${quote.line}`, `Under ${quote.line}`].includes(bet.side)
      : ![home, away].includes(bet.side)) findings.push(prefix + "invalid_side_identity");
    if (![bet.modelProbability, bet.expectedValue, quote.price].every(Number.isFinite) ||
        bet.modelProbability < 0 || bet.modelProbability > 1 || Math.abs(quote.price) < 100) findings.push(prefix + "invalid_numeric_tuple");
    const age = clock - Date.parse(quote.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 120 * 60_000) findings.push(prefix + "stale_or_future_execution_quote");
    if (bet.providerGameId !== payload.game.providerGameId) findings.push(prefix + "wrong_event");
    const isHome = bet.side === home;
    const line = quote.line ?? 0;
    const probabilities = nflV1WeekOneLineProbabilities({ forecast,
      homeSpread: bet.market === "spread" ? isHome ? line : -line : 0,
      totalLine: bet.market === "total" ? line : 0,
    });
    const over = bet.side.startsWith("Over ");
    const expectedProbability = bet.market === "moneyline"
      ? (isHome ? forecast.homeWinProbability : forecast.awayWinProbability) /
        Math.max(forecast.homeWinProbability + forecast.awayWinProbability, 1e-12)
      : bet.market === "spread" ? isHome ? probabilities.spread.homeCoverProbability : probabilities.spread.awayCoverProbability
        : over ? probabilities.total.overProbability : probabilities.total.underProbability;
    if (Math.abs(bet.modelProbability - expectedProbability) > 1e-8) findings.push(prefix + "probability_not_from_final_distribution");
    // A skewed distribution's mean can cross a line while its majority side
    // does not. The chosen side must agree with the actual final distribution.
    if (expectedProbability < 0.5 - 1e-9) findings.push(prefix + "score_pick_disagreement");
    const push = bet.market === "moneyline" ? 0 : bet.market === "spread" ? probabilities.spread.pushProbability : probabilities.total.pushProbability;
    const profit = quote.price > 0 ? quote.price / 100 : 100 / -quote.price;
    const ev = (1 - push) * (expectedProbability * profit - (1 - expectedProbability));
    if (Math.abs(ev - bet.expectedValue) > 1e-8) findings.push(prefix + "ev_not_from_final_distribution");
    if (["Best Angle", "Lean"].includes(bet.grade) && bet.expectedValue < -1e-9) findings.push(prefix + "negative_ev_actionable");
    const matching = payload.market.comparableCurrentBooks.some((book) => {
      if (canonical(book.sportsbook) !== canonical(quote.sportsbook) || book.providerGameId !== bet.providerGameId) return false;
      const sourceAt = Date.parse(book.observedAt);
      if (!Number.isFinite(sourceAt) || clock - sourceAt < 0 || clock - sourceAt > 120 * 60_000 ||
          sourceAt !== Date.parse(quote.observedAt)) return false;
      if (bet.market === "moneyline") return (isHome ? book.moneyline?.homePrice : book.moneyline?.awayPrice) === quote.price;
      if (bet.market === "spread") return (isHome ? book.spread?.homeLine : book.spread?.awayLine) === quote.line &&
        (isHome ? book.spread?.homePrice : book.spread?.awayPrice) === quote.price;
      return book.total?.line === quote.line && (over ? book.total.overPrice : book.total.underPrice) === quote.price;
    });
    if (!matching) findings.push(prefix + "execution_tuple_not_in_source_books");
    const exclusions = forecast.targetExclusion;
    if (exclusions?.status === "target_excluded_market") {
      const families = bet.market === "total" ? exclusions.totalExcludedSportsbooks : exclusions.marginExcludedSportsbooks;
      if (!families.map(canonical).includes(canonical(quote.sportsbook))) findings.push(prefix + "evaluated_book_not_excluded");
    }
  }
  return findings;
}

/** Informational mean/median boundary cases; never silently relabel them as defects or score changes. */
export function nflReaderMeanBoundaryCases(payload: NflForwardEvidencePayload): string[] {
  const margin = payload.outcomeForecast.expectedHomeScore - payload.outcomeForecast.expectedAwayScore;
  const total = payload.outcomeForecast.expectedHomeScore + payload.outcomeForecast.expectedAwayScore;
  const home = payload.game.home.abbreviation;
  return payload.decisions.evaluatedBets.flatMap((bet) => {
    const line = bet.evaluatedQuote.line ?? 0;
    const agrees = bet.market === "moneyline" ? (margin > 0) === (bet.side === home)
      : bet.market === "spread" ? (margin + (bet.side === home ? line : -line) > 0) === (bet.side === home)
        : (total > line) === bet.side.startsWith("Over ");
    return agrees ? [] : [`${bet.market}:${bet.side}:mean=${bet.market === "total" ? total : margin}:probability=${bet.modelProbability}:grade=${bet.grade}`];
  });
}

function canonical(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
