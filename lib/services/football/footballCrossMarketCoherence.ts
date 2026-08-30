export const FOOTBALL_CROSS_MARKET_COHERENCE_RELEASE =
  "football_cross_market_coherence_2026_08_30_r5_verified_pmf_endpoints" as const;

const EPSILON = 1e-9;
const EV_TOLERANCE = 1e-8;
const PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS = 0.25;

export type FootballCoherenceSport = "nfl" | "cfb";
export type FootballCoherenceMarket = "moneyline" | "spread" | "total";
export type FootballCoherenceSide = "home" | "away" | "over" | "under";

export type FootballCoherenceForecast = {
  expectedAwayPoints: number;
  expectedHomePoints: number;
  representativeScore: { away: number; home: number };
  awayWinProbability: number;
  homeWinProbability: number;
  pmf?: Array<{ away: number; home: number; probability: number }>;
  marginDistribution?: { values: number[]; probabilities: number[] };
  totalDistribution?: { values: number[]; probabilities: number[] };
};

export type FootballCoherenceDecision = {
  market: FootballCoherenceMarket;
  side: string;
  grade: string;
  modelProbability: number;
  marketFairProbability: number;
  expectedValue: number;
  pushProbability?: number;
  evaluatedQuote: {
    line: number | null;
    price: number;
    sportsbook: string;
    observedAt: string;
  };
};

export type FootballCoherenceIssueCode =
  | "forecast_probability_mass"
  | "forecast_distribution_mass"
  | "forecast_expected_score_identity"
  | "forecast_winner_score_disagreement"
  | "forecast_representative_winner_disagreement"
  | "market_count"
  | "duplicate_market"
  | "decision_probability"
  | "decision_fair_probability"
  | "decision_side_identity"
  | "decision_forecast_side_disagreement"
  | "decision_quote"
  | "decision_ev_mismatch"
  | "actionable_nonpositive_value"
  | "ml_spread_event_containment";

export type FootballCoherenceIssue = {
  code: FootballCoherenceIssueCode;
  detail: string;
};

export type FootballCoherenceExplanation = {
  code: "price_or_threshold_divergence";
  markets: ["moneyline", "spread"];
  detail: string;
};

export type FootballCoherenceReport = {
  release: typeof FOOTBALL_CROSS_MARKET_COHERENCE_RELEASE;
  sport: FootballCoherenceSport;
  providerGameId: string;
  passed: boolean;
  fatalIssues: FootballCoherenceIssue[];
  explanations: FootballCoherenceExplanation[];
  checkedMarkets: FootballCoherenceMarket[];
};

/**
 * Projects a calibrated home-cover probability onto the mathematical event
 * relationship between winning and covering the exact home spread.
 */
export function constrainHomeCoverProbability(args: {
  homeWinProbability: number;
  homeCoverProbability: number;
  homeSpread: number;
  pushProbability?: number;
}): number {
  assertOpenProbability(args.homeWinProbability, "homeWinProbability");
  assertOpenProbability(args.homeCoverProbability, "homeCoverProbability");
  if (!Number.isFinite(args.homeSpread)) throw new Error("homeSpread must be finite.");
  const pushProbability = args.pushProbability ?? 0;
  if (!Number.isFinite(pushProbability) || pushProbability < 0 || pushProbability >= 1) {
    throw new Error("pushProbability must be between zero inclusive and one exclusive.");
  }
  if (args.homeSpread > 0) {
    const minimum = args.homeWinProbability / (1 - pushProbability);
    if (minimum >= 1) throw new Error("Home-win and push probabilities leave no valid underdog-cover interval.");
    return Math.max(args.homeCoverProbability, minimum);
  }
  if (args.homeSpread < 0) {
    const maximum = (args.homeWinProbability - pushProbability) / (1 - pushProbability);
    if (maximum <= 0) throw new Error("Home-win and push probabilities leave no valid favorite-cover interval.");
    return Math.min(args.homeCoverProbability, maximum);
  }
  return args.homeWinProbability;
}

export function auditFootballCrossMarketCoherence(args: {
  sport: FootballCoherenceSport;
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  forecast: FootballCoherenceForecast;
  decisions: FootballCoherenceDecision[];
  unavailableMarkets?: FootballCoherenceMarket[];
  allowWholeGameOperationalHold?: boolean;
  requireDecisionSideFromForecast?: boolean;
  allowPmfVerifiedProbabilityEndpoints?: boolean;
}): FootballCoherenceReport {
  const fatalIssues: FootballCoherenceIssue[] = [];
  const explanations: FootballCoherenceExplanation[] = [];
  auditForecast(args.forecast, fatalIssues, args.allowPmfVerifiedProbabilityEndpoints === true);

  const unavailable = args.unavailableMarkets ?? [];
  const markets = [...args.decisions.map((decision) => decision.market), ...unavailable];
  const uniqueMarkets = new Set(markets);
  if (uniqueMarkets.size !== markets.length) {
    fatalIssues.push({ code: "duplicate_market", detail: `Duplicate evaluated/unavailable markets: ${markets.join(",")}.` });
  }
  const wholeGameHold = args.allowWholeGameOperationalHold === true && markets.length === 0;
  if (!wholeGameHold && (markets.length !== 3 || uniqueMarkets.size !== 3)) {
    fatalIssues.push({ code: "market_count", detail: `Expected three market dispositions; received ${markets.length}.` });
  }

  const normalized = args.decisions.map((decision) => normalizeDecision({
    sport: args.sport,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    decision,
    fatalIssues,
  }));
  const byMarket = new Map(normalized.map((decision) => [decision.market, decision]));
  if (args.requireDecisionSideFromForecast) {
    for (const decision of normalized) {
      if (!decision.selectedSide || decision.market !== "moneyline" && decision.line === null) continue;
      const forecastSide = selectedForecastSideAtDecision(args.forecast, decision);
      if (forecastSide === null) {
        fatalIssues.push({
          code: "decision_forecast_side_disagreement",
          detail: `${decision.market} cannot be verified against the released joint PMF.`,
        });
      } else if (
        forecastSide.pmf !== decision.selectedSide ||
        forecastSide.meanDistance > PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS && forecastSide.mean !== decision.selectedSide
      ) {
        fatalIssues.push({
          code: "decision_forecast_side_disagreement",
          detail: `${decision.market} decision ${decision.selectedSide}; PMF ${forecastSide.pmf}; expected-score direction ${forecastSide.mean}; distance ${forecastSide.meanDistance}; line ${decision.line}.`,
        });
      }
    }
  }
  const moneyline = byMarket.get("moneyline");
  const spread = byMarket.get("spread");
  if (moneyline && spread && moneyline.selectedSide && spread.selectedSide && spread.line !== null) {
    const homeWinProbability = moneyline.selectedSide === "home"
      ? moneyline.modelProbability
      : 1 - moneyline.modelProbability;
    const homeCoverProbability = spread.selectedSide === "home"
      ? spread.modelProbability
      : 1 - spread.modelProbability;
    const homeSpread = spread.selectedSide === "home" ? spread.line : -spread.line;
    const pushProbability = spread.pushProbability ?? spreadPushProbability(args.forecast, homeSpread);
    const valid = containsSpreadEvent({
      sport: args.sport,
      homeWinProbability,
      homeCoverProbability,
      homeSpread,
      pushProbability,
    });
    if (!valid) {
      fatalIssues.push({
        code: "ml_spread_event_containment",
        detail: `home line ${homeSpread}, win ${homeWinProbability}, cover ${homeCoverProbability}, push ${pushProbability}.`,
      });
    }
    if (moneyline.grade !== spread.grade) {
      explanations.push({
        code: "price_or_threshold_divergence",
        markets: ["moneyline", "spread"],
        detail: `ML ${moneyline.grade} at ${moneyline.price} (EV ${moneyline.expectedValue}); ` +
          `Spread ${spread.grade} ${signed(spread.line)} at ${spread.price} (EV ${spread.expectedValue}).`,
      });
    }
  }

  return {
    release: FOOTBALL_CROSS_MARKET_COHERENCE_RELEASE,
    sport: args.sport,
    providerGameId: args.providerGameId,
    passed: fatalIssues.length === 0,
    fatalIssues,
    explanations,
    checkedMarkets: [...uniqueMarkets].sort(),
  };
}

function selectedForecastSideAtDecision(
  forecast: FootballCoherenceForecast,
  decision: ReturnType<typeof normalizeDecision>,
): { pmf: FootballCoherenceSide; mean: FootballCoherenceSide; meanDistance: number } | null {
  if (!forecast.pmf || forecast.pmf.length === 0 || !decision.selectedSide) return null;
  const expectedMarginHome = forecast.expectedHomePoints - forecast.expectedAwayPoints;
  const expectedTotal = forecast.expectedHomePoints + forecast.expectedAwayPoints;
  if (decision.market === "moneyline") {
    const home = forecast.pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? 1 : cell.home === cell.away ? 0.5 : 0) * cell.probability, 0);
    return {
      pmf: home >= 0.5 ? "home" : "away",
      mean: expectedMarginHome >= 0 ? "home" : "away",
      meanDistance: Math.abs(expectedMarginHome),
    };
  }
  if (decision.line === null) return null;
  if (decision.market === "total") {
    const over = forecast.pmf.reduce((sum, cell) => {
      const total = cell.home + cell.away;
      return sum + (total > decision.line! ? 1 : total === decision.line ? 0.5 : 0) * cell.probability;
    }, 0);
    return {
      pmf: over >= 0.5 ? "over" : "under",
      mean: expectedTotal >= decision.line ? "over" : "under",
      meanDistance: Math.abs(expectedTotal - decision.line),
    };
  }
  if (decision.selectedSide !== "home" && decision.selectedSide !== "away") return null;
  const homeSpread = decision.selectedSide === "home" ? decision.line : -decision.line;
  const homeCover = forecast.pmf.reduce((sum, cell) => {
    const result = cell.home - cell.away + homeSpread;
    return sum + (result > 0 ? 1 : result === 0 ? 0.5 : 0) * cell.probability;
  }, 0);
  return {
    pmf: homeCover >= 0.5 ? "home" : "away",
    mean: expectedMarginHome + homeSpread >= 0 ? "home" : "away",
    meanDistance: Math.abs(expectedMarginHome + homeSpread),
  };
}

export function assertFootballCrossMarketCoherence(
  args: Parameters<typeof auditFootballCrossMarketCoherence>[0],
): FootballCoherenceReport {
  const report = auditFootballCrossMarketCoherence(args);
  if (!report.passed) {
    throw new Error(
      `${args.sport.toUpperCase()} cross-market coherence failed for ${args.providerGameId}: ` +
      report.fatalIssues.map((issue) => `${issue.code}(${issue.detail})`).join("; "),
    );
  }
  return report;
}

function auditForecast(
  forecast: FootballCoherenceForecast,
  issues: FootballCoherenceIssue[],
  allowPmfVerifiedProbabilityEndpoints: boolean,
): void {
  const probabilities = [forecast.awayWinProbability, forecast.homeWinProbability];
  const endpointsAllowed = allowPmfVerifiedProbabilityEndpoints && Boolean(forecast.pmf);
  if (probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1 || (!endpointsAllowed && (value === 0 || value === 1))) ||
      Math.abs(probabilities[0]! + probabilities[1]! - 1) > 0.000002) {
    issues.push({ code: "forecast_probability_mass", detail: `Away/home win probabilities are ${probabilities.join("/")}.` });
  }
  const expectedMargin = forecast.expectedHomePoints - forecast.expectedAwayPoints;
  const forecastDirection = direction(forecast.homeWinProbability - forecast.awayWinProbability);
  if (direction(expectedMargin) !== forecastDirection) {
    issues.push({ code: "forecast_winner_score_disagreement", detail: `Expected margin ${expectedMargin}, home win ${forecast.homeWinProbability}.` });
  }
  const representativeMargin = forecast.representativeScore.home - forecast.representativeScore.away;
  if (direction(representativeMargin) !== forecastDirection) {
    issues.push({ code: "forecast_representative_winner_disagreement", detail: `Representative margin ${representativeMargin}, home win ${forecast.homeWinProbability}.` });
  }
  if (forecast.pmf) auditPmfForecast(forecast, issues);
  if (forecast.marginDistribution && forecast.totalDistribution) auditMarginalForecast(forecast, issues);
}

function auditPmfForecast(forecast: FootballCoherenceForecast, issues: FootballCoherenceIssue[]): void {
  const pmf = forecast.pmf!;
  const mass = pmf.reduce((sum, cell) => sum + cell.probability, 0);
  if (pmf.length === 0 || pmf.some((cell) => !Number.isFinite(cell.probability) || cell.probability < 0) || Math.abs(mass - 1) > 0.000002) {
    issues.push({ code: "forecast_distribution_mass", detail: `Joint PMF mass ${mass}.` });
    return;
  }
  const away = pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const home = pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const homeWin = pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? 1 : cell.home === cell.away ? 0.5 : 0) * cell.probability, 0);
  if (Math.abs(away - forecast.expectedAwayPoints) > 0.000002 ||
      Math.abs(home - forecast.expectedHomePoints) > 0.000002 ||
      Math.abs(homeWin - forecast.homeWinProbability) > 0.000002) {
    issues.push({
      code: "forecast_expected_score_identity",
      detail: `PMF away/home/win ${away}/${home}/${homeWin}; published ${forecast.expectedAwayPoints}/${forecast.expectedHomePoints}/${forecast.homeWinProbability}.`,
    });
  }
}

function auditMarginalForecast(forecast: FootballCoherenceForecast, issues: FootballCoherenceIssue[]): void {
  const margin = forecast.marginDistribution!;
  const total = forecast.totalDistribution!;
  if (!validDistribution(margin) || !validDistribution(total)) {
    issues.push({ code: "forecast_distribution_mass", detail: "Margin or Total distribution is incomplete." });
    return;
  }
  const expectedMargin = meanDistribution(margin);
  const expectedTotal = meanDistribution(total);
  const away = (expectedTotal - expectedMargin) / 2;
  const home = (expectedTotal + expectedMargin) / 2;
  let homeWins = 0;
  let awayWins = 0;
  margin.values.forEach((value, index) => {
    if (value > 0) homeWins += margin.probabilities[index]!;
    else if (value < 0) awayWins += margin.probabilities[index]!;
  });
  const decided = Math.max(homeWins + awayWins, 1e-12);
  const homeWin = homeWins / decided;
  if (Math.abs(away - forecast.expectedAwayPoints) > 0.000002 ||
      Math.abs(home - forecast.expectedHomePoints) > 0.000002 ||
      Math.abs(homeWin - forecast.homeWinProbability) > 0.000002) {
    issues.push({
      code: "forecast_expected_score_identity",
      detail: `Marginals away/home/win ${away}/${home}/${homeWin}; published ${forecast.expectedAwayPoints}/${forecast.expectedHomePoints}/${forecast.homeWinProbability}.`,
    });
  }
}

function normalizeDecision(args: {
  sport: FootballCoherenceSport;
  awayTeam: string;
  homeTeam: string;
  decision: FootballCoherenceDecision;
  fatalIssues: FootballCoherenceIssue[];
}) {
  const { decision } = args;
  if (!Number.isFinite(decision.modelProbability) || decision.modelProbability <= 0 || decision.modelProbability >= 1) {
    args.fatalIssues.push({ code: "decision_probability", detail: `${decision.market} model probability ${decision.modelProbability}.` });
  }
  if (!Number.isFinite(decision.marketFairProbability) || decision.marketFairProbability <= 0 || decision.marketFairProbability >= 1) {
    args.fatalIssues.push({ code: "decision_fair_probability", detail: `${decision.market} fair probability ${decision.marketFairProbability}.` });
  }
  const price = decision.evaluatedQuote.price;
  const line = decision.evaluatedQuote.line;
  if (!decision.evaluatedQuote.sportsbook || !Number.isFinite(price) || price === 0 ||
      !Number.isFinite(Date.parse(decision.evaluatedQuote.observedAt)) ||
      (decision.market === "moneyline" ? line !== null : !Number.isFinite(line))) {
    args.fatalIssues.push({ code: "decision_quote", detail: `${decision.market} quote is incomplete.` });
  }
  const selectedSide = decisionSide(args.sport, args.awayTeam, args.homeTeam, decision);
  if (!selectedSide) {
    args.fatalIssues.push({ code: "decision_side_identity", detail: `${decision.market} side ${decision.side} is not a game/market side.` });
  } else if (!sideLineIdentity(args.sport, decision)) {
    args.fatalIssues.push({ code: "decision_side_identity", detail: `${decision.market} side ${decision.side} disagrees with line ${line}.` });
  }
  const recomputedEv = args.sport === "cfb"
    ? cfbExpectedValue(decision.modelProbability, decision.pushProbability ?? 0, price)
    : expectedValue(decision.modelProbability, price);
  if (Number.isFinite(recomputedEv) && Math.abs(recomputedEv - decision.expectedValue) > EV_TOLERANCE) {
    args.fatalIssues.push({ code: "decision_ev_mismatch", detail: `${decision.market} stored/recomputed EV ${decision.expectedValue}/${recomputedEv}.` });
  }
  if (isActionable(decision.grade) &&
      (decision.expectedValue <= 0 || decision.modelProbability <= decision.marketFairProbability)) {
    args.fatalIssues.push({
      code: "actionable_nonpositive_value",
      detail: `${decision.market} ${decision.grade} has EV ${decision.expectedValue} and gap ${decision.modelProbability - decision.marketFairProbability}.`,
    });
  }
  return {
    ...decision,
    selectedSide,
    line,
    price,
  };
}

function decisionSide(
  sport: FootballCoherenceSport,
  awayTeam: string,
  homeTeam: string,
  decision: FootballCoherenceDecision,
): FootballCoherenceSide | null {
  if (decision.market === "total") {
    return decision.side.startsWith("Over ") ? "over" : decision.side.startsWith("Under ") ? "under" : null;
  }
  if (decision.market === "moneyline") {
    return decision.side === homeTeam ? "home" : decision.side === awayTeam ? "away" : null;
  }
  if (sport === "nfl") {
    return decision.side === homeTeam ? "home" : decision.side === awayTeam ? "away" : null;
  }
  return decision.side.startsWith(`${homeTeam} `) ? "home" : decision.side.startsWith(`${awayTeam} `) ? "away" : null;
}

function cfbExpectedValue(probabilityIncludingHalfPush: number, pushProbability: number, price: number): number {
  const winProbability = Math.max(0, probabilityIncludingHalfPush - 0.5 * pushProbability);
  const lossProbability = Math.max(0, 1 - probabilityIncludingHalfPush - 0.5 * pushProbability);
  return winProbability * profitOne(price) - lossProbability;
}

function sideLineIdentity(sport: FootballCoherenceSport, decision: FootballCoherenceDecision): boolean {
  if (decision.market === "moneyline") return decision.evaluatedQuote.line === null;
  const line = decision.evaluatedQuote.line;
  if (line === null) return false;
  if (decision.market === "total") {
    const match = decision.side.match(/^(?:Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
    return match !== null && Math.abs(Number(match[1]) - line) <= EPSILON;
  }
  if (sport === "nfl") return true;
  const match = decision.side.match(/\s([+-]?\d+(?:\.\d+)?)$/);
  return match !== null && Math.abs(Number(match[1]) - line) <= EPSILON;
}

function expectedValue(probability: number, price: number): number {
  return probability * profitOne(price) - (1 - probability);
}

function containsSpreadEvent(args: {
  sport: FootballCoherenceSport;
  homeWinProbability: number;
  homeCoverProbability: number;
  homeSpread: number;
  pushProbability: number;
}): boolean {
  if (args.homeSpread === 0) {
    return Math.abs(args.homeCoverProbability - args.homeWinProbability) <= EPSILON;
  }
  if (args.sport === "cfb") {
    const boundary = args.homeSpread > 0
      ? args.homeWinProbability + 0.5 * args.pushProbability
      : args.homeWinProbability - 0.5 * args.pushProbability;
    return args.homeSpread > 0
      ? args.homeCoverProbability + EPSILON >= boundary
      : args.homeCoverProbability <= boundary + EPSILON;
  }
  const nonPush = 1 - args.pushProbability;
  const boundary = args.homeSpread > 0
    ? args.homeWinProbability / nonPush
    : (args.homeWinProbability - args.pushProbability) / nonPush;
  return args.homeSpread > 0
    ? args.homeCoverProbability + EPSILON >= boundary
    : args.homeCoverProbability <= boundary + EPSILON;
}

function spreadPushProbability(forecast: FootballCoherenceForecast, homeSpread: number): number {
  if (forecast.marginDistribution) {
    return forecast.marginDistribution.values.reduce((sum, margin, index) =>
      Math.abs(margin + homeSpread) <= EPSILON
        ? sum + forecast.marginDistribution!.probabilities[index]!
        : sum, 0);
  }
  if (forecast.pmf) {
    return forecast.pmf.reduce((sum, cell) =>
      Math.abs(cell.home - cell.away + homeSpread) <= EPSILON ? sum + cell.probability : sum, 0);
  }
  return 0;
}

function profitOne(price: number): number {
  return price > 0 ? price / 100 : 100 / -price;
}

function isActionable(grade: string): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function validDistribution(distribution: { values: number[]; probabilities: number[] }): boolean {
  return distribution.values.length > 0 &&
    distribution.values.length === distribution.probabilities.length &&
    distribution.probabilities.every((value) => Number.isFinite(value) && value >= 0) &&
    Math.abs(distribution.probabilities.reduce((sum, value) => sum + value, 0) - 1) <= 0.000002;
}

function meanDistribution(distribution: { values: number[]; probabilities: number[] }): number {
  return distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
}

function assertOpenProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${label} must be between zero and one.`);
}

function signed(value: number | null): string {
  if (value === null) return "";
  return value > 0 ? `+${value}` : String(value);
}

function direction(value: number): -1 | 0 | 1 {
  return Math.abs(value) <= EPSILON ? 0 : value > 0 ? 1 : -1;
}
