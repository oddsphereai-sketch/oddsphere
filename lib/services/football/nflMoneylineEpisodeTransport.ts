import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  buildNflUnifiedMarketAdjustedForecast,
  nflV1WeekOneLineProbabilities,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_MONEYLINE_EPISODE_TRANSPORT_CANDIDATE_RELEASE =
  "nfl_moneyline_episode_transport_candidate_2026_10_31_r1" as const;

export type NflMoneylineEpisodeTransport = {
  release: typeof NFL_MONEYLINE_EPISODE_TRANSPORT_CANDIDATE_RELEASE;
  source: string;
  statisticalKnowledgeAt: string;
  openingAt: string;
  currentAt: string;
  status: "transported" | "unchanged" | "unidentified";
  reason: string;
  statisticalHomeMargin: number;
  finalHomeMargin: number;
  statisticalHomeWinProbability: number;
  finalHomeWinProbability: number;
  marketOpeningHomeFairProbability: number;
  marketCurrentHomeFairProbability: number;
};

export type NflNamedMoneylineEpisode = {
  source: string;
  openingAt: string;
  currentAt: string;
  openingHomeFairProbability: number;
  currentHomeFairProbability: number;
};

export type NflPricedLineEpisode = {
  market: "spread" | "total";
  source: string;
  openingAt: string;
  currentAt: string;
  /** Spread is the home-margin cover boundary; Total is the points line. */
  openingNumber: number;
  currentNumber: number;
  /** Home cover for Spread, Over for Total; each de-vigged from one paired quote. */
  openingFirstFairProbability: number;
  currentFirstFairProbability: number;
};

export type NflPricedLineTransport = {
  status: "transported" | "unchanged" | "unidentified";
  reason: string;
  market: "spread" | "total";
  source: string;
  statisticalMean: number;
  finalMean: number;
  openingImpliedMean: number | null;
  currentImpliedMean: number | null;
};

/**
 * Infer the net economic displacement of a same-book Spread or Total path.
 * This handles number, juice, and counter-juice together under the frozen
 * discrete score law; two opposite changes that exactly compensate yield no
 * point move. It does not decide how to fuse the Spread with Moneyline or
 * how to select competing books. That remains the full-game reader's job.
 */
export function transportNflPricedLineEpisode(args: {
  statisticalForecast: NflV1WeekOneOutcomeForecast;
  statisticalKnowledgeAt: string;
  episode: NflPricedLineEpisode;
}): NflPricedLineTransport {
  const forecast = args.statisticalForecast;
  const episode = args.episode;
  const margin = forecast.expectedHomeScore - forecast.expectedAwayScore;
  const total = forecast.expectedHomeScore + forecast.expectedAwayScore;
  const statisticalMean = episode.market === "spread" ? margin : total;
  const base = { market: episode.market, source: episode.source, statisticalMean };
  const unidentified = (reason: string): NflPricedLineTransport => ({
    ...base, status: "unidentified", reason, finalMean: statisticalMean,
    openingImpliedMean: null, currentImpliedMean: null,
  });
  const openAt = Date.parse(episode.openingAt);
  const currentAt = Date.parse(episode.currentAt);
  const knowledgeAt = Date.parse(args.statisticalKnowledgeAt);
  if (!episode.source.trim() || ![openAt, currentAt, knowledgeAt, episode.openingNumber,
      episode.currentNumber, episode.openingFirstFairProbability,
      episode.currentFirstFairProbability].every(Number.isFinite) ||
      openAt >= currentAt || episode.openingFirstFairProbability <= 0 ||
      episode.openingFirstFairProbability >= 1 || episode.currentFirstFairProbability <= 0 ||
      episode.currentFirstFairProbability >= 1) return unidentified("invalid_line_episode");
  if (knowledgeAt > openAt) return unidentified("episode_overlaps_statistical_knowledge");
  if (episode.openingNumber === episode.currentNumber &&
      episode.openingFirstFairProbability === episode.currentFirstFairProbability) {
    return {
      ...base, status: "unchanged", reason: "same_book_no_economic_line_change",
      finalMean: statisticalMean, openingImpliedMean: null, currentImpliedMean: null,
    };
  }
  const openingImpliedMean = impliedMeanForLineQuote({
    forecast, market: episode.market, line: episode.openingNumber,
    target: episode.openingFirstFairProbability,
  });
  const currentImpliedMean = impliedMeanForLineQuote({
    forecast, market: episode.market, line: episode.currentNumber,
    target: episode.currentFirstFairProbability,
  });
  if (openingImpliedMean === null || currentImpliedMean === null) return unidentified("line_quote_outside_score_law");
  const finalMean = statisticalMean + currentImpliedMean - openingImpliedMean;
  if (!Number.isFinite(finalMean) || (episode.market === "spread"
    ? total <= Math.abs(finalMean) : finalMean <= Math.abs(margin))) {
    return unidentified("transport_outside_physical_score_law");
  }
  return {
    ...base, status: Math.abs(finalMean - statisticalMean) <= 1e-9 ? "unchanged" : "transported",
    reason: "same_book_number_and_juice_displacement",
    finalMean, openingImpliedMean, currentImpliedMean,
  };
}

function impliedMeanForLineQuote(args: {
  forecast: NflV1WeekOneOutcomeForecast;
  market: "spread" | "total";
  line: number;
  target: number;
}): number | null {
  const margin = args.forecast.expectedHomeScore - args.forecast.expectedAwayScore;
  const total = args.forecast.expectedHomeScore + args.forecast.expectedAwayScore;
  const probabilityAt = (mean: number) => {
    const shifted = buildNflUnifiedMarketAdjustedForecast({
      baseForecast: args.forecast,
      expectedHomeMargin: args.market === "spread" ? mean : margin,
      expectedTotal: args.market === "total" ? mean : total,
      marketInputPolicy: "target_excluded_continuous_residual",
    });
    const lines = nflV1WeekOneLineProbabilities({
      forecast: shifted,
      homeSpread: args.market === "spread" ? -args.line : 0,
      totalLine: args.market === "total" ? args.line : total,
    });
    return args.market === "spread" ? lines.spread.homeCoverProbability : lines.total.overProbability;
  };
  let low = args.market === "spread" ? -total + 1e-6 : Math.abs(margin) + 1e-6;
  let high = args.market === "spread" ? total - 1e-6 : Math.max(total * 2, total + 30);
  if (args.market === "total") {
    while (high < 400 && probabilityAt(high) < args.target) high *= 2;
  }
  if (probabilityAt(low) > args.target || probabilityAt(high) < args.target) return null;
  for (let step = 0; step < 65; step++) {
    const middle = (low + high) / 2;
    if (probabilityAt(middle) < args.target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Select only the still-new portion of one physical book's price history. */
export function selectNflNamedMoneylineEpisodeAfterKnowledge(args: {
  history: NflPreviewBookOdds[];
  sportsbook: string;
  providerGameId: string;
  statisticalKnowledgeAt: string;
  evaluatedAt: string;
}): NflNamedMoneylineEpisode | null {
  const knowledgeAt = Date.parse(args.statisticalKnowledgeAt);
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(knowledgeAt) || !Number.isFinite(evaluatedAt) || knowledgeAt >= evaluatedAt) return null;
  const source = args.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (source !== "circa" && source !== "pinnacle") return null;
  const admitted = args.history.flatMap((quote) => {
    if (quote.providerGameId !== args.providerGameId || quote.provider !== "owls" ||
        quote.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "") !== source ||
        !quote.providerEventId || !quote.moneyline) return [];
    const observedAt = quote.marketObservedAt?.moneyline ?? quote.observedAt;
    const instant = Date.parse(observedAt);
    const fair = twoSidedFairHome(quote.moneyline.homePrice, quote.moneyline.awayPrice);
    return Number.isFinite(instant) && instant >= knowledgeAt && instant <= evaluatedAt && fair !== null
      ? [{ observedAt: new Date(instant).toISOString(), instant, eventId: quote.providerEventId, fair }]
      : [];
  }).sort((first, second) => first.instant - second.instant);
  if (admitted.length < 2 || new Set(admitted.map((item) => item.eventId)).size !== 1) return null;
  const byTime = new Map<number, number>();
  for (const item of admitted) {
    const prior = byTime.get(item.instant);
    if (prior !== undefined && Math.abs(prior - item.fair) > 1e-12) return null;
    byTime.set(item.instant, item.fair);
  }
  const opening = admitted[0]!;
  const current = admitted.at(-1)!;
  return opening.instant < current.instant ? {
    source, openingAt: opening.observedAt, currentAt: current.observedAt,
    openingHomeFairProbability: opening.fair,
    currentHomeFairProbability: current.fair,
  } : null;
}

/** Select one real, exact-game, same-book priced-line episode after the statistical input. */
export function selectNflNamedPricedLineEpisodeAfterKnowledge(args: {
  history: NflPreviewBookOdds[];
  market: "spread" | "total";
  sportsbook: string;
  providerGameId: string;
  statisticalKnowledgeAt: string;
  evaluatedAt: string;
}): NflPricedLineEpisode | null {
  const knowledgeAt = Date.parse(args.statisticalKnowledgeAt);
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(knowledgeAt) || !Number.isFinite(evaluatedAt) || knowledgeAt >= evaluatedAt) return null;
  const source = args.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (source !== "circa" && source !== "pinnacle") return null;
  const admitted = args.history.flatMap((quote) => {
    if (quote.providerGameId !== args.providerGameId || quote.provider !== "owls" ||
        quote.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "") !== source ||
        !quote.providerEventId) return [];
    const market = quote[args.market];
    if (!market) return [];
    const observedAt = quote.marketObservedAt?.[args.market] ?? quote.observedAt;
    const instant = Date.parse(observedAt);
    const number = args.market === "spread" ? -(quote.spread?.homeLine ?? NaN) : quote.total?.line ?? NaN;
    const fair = args.market === "spread"
      ? twoSidedFairHome(quote.spread!.homePrice, quote.spread!.awayPrice)
      : twoSidedFairHome(quote.total!.overPrice, quote.total!.underPrice);
    return Number.isFinite(instant) && instant >= knowledgeAt && instant <= evaluatedAt &&
      Number.isFinite(number) && fair !== null
      ? [{ observedAt: new Date(instant).toISOString(), instant, eventId: quote.providerEventId,
          number, fair }]
      : [];
  }).sort((first, second) => first.instant - second.instant);
  if (admitted.length < 2 || new Set(admitted.map((item) => item.eventId)).size !== 1) return null;
  const byTime = new Map<number, { number: number; fair: number }>();
  for (const item of admitted) {
    const prior = byTime.get(item.instant);
    if (prior && (prior.number !== item.number || Math.abs(prior.fair - item.fair) > 1e-12)) return null;
    byTime.set(item.instant, { number: item.number, fair: item.fair });
  }
  const opening = admitted[0]!;
  const current = admitted.at(-1)!;
  return opening.instant < current.instant ? {
    market: args.market, source, openingAt: opening.observedAt, currentAt: current.observedAt,
    openingNumber: opening.number, currentNumber: current.number,
    openingFirstFairProbability: opening.fair, currentFirstFairProbability: current.fair,
  } : null;
}

/**
 * Translate one exact same-book, two-sided Moneyline episode through the NFL
 * score law. This is a relative likelihood update, not a model/market average,
 * a current-quote anchor, or an automatic selection-side flip. The caller must
 * separately establish exact identity, target exclusion, causal source clocks,
 * freshness, whether the statistical forecast already consumed the same news,
 * and how this episode reconciles with Spread, Total and other books.
 */
export function transportNflMoneylineEpisode(args: {
  statisticalForecast: NflV1WeekOneOutcomeForecast;
  /** Latest source information already consumed by this statistical forecast. */
  statisticalKnowledgeAt: string;
  episode: NflNamedMoneylineEpisode;
}): NflMoneylineEpisodeTransport {
  const { statisticalForecast: forecast } = args;
  const statisticalHomeMargin = forecast.expectedHomeScore - forecast.expectedAwayScore;
  const statisticalTotal = forecast.expectedHomeScore + forecast.expectedAwayScore;
  const statisticalHomeWinProbability = twoWayHomeProbability(forecast);
  const base = {
    release: NFL_MONEYLINE_EPISODE_TRANSPORT_CANDIDATE_RELEASE,
    source: args.episode.source,
    statisticalKnowledgeAt: args.statisticalKnowledgeAt,
    openingAt: args.episode.openingAt,
    currentAt: args.episode.currentAt,
    statisticalHomeMargin,
    statisticalHomeWinProbability,
    marketOpeningHomeFairProbability: args.episode.openingHomeFairProbability,
    marketCurrentHomeFairProbability: args.episode.currentHomeFairProbability,
  };
  const opening = args.episode.openingHomeFairProbability;
  const current = args.episode.currentHomeFairProbability;
  if (![opening, current, statisticalHomeWinProbability, statisticalTotal].every(Number.isFinite) ||
      !args.episode.source.trim() || !Number.isFinite(Date.parse(args.episode.openingAt)) ||
      !Number.isFinite(Date.parse(args.episode.currentAt)) ||
      !Number.isFinite(Date.parse(args.statisticalKnowledgeAt)) ||
      Date.parse(args.episode.openingAt) >= Date.parse(args.episode.currentAt) ||
      opening <= 0 || opening >= 1 || current <= 0 || current >= 1 ||
      statisticalHomeWinProbability <= 0 || statisticalHomeWinProbability >= 1 ||
      statisticalTotal <= Math.abs(statisticalHomeMargin)) {
    return {
      ...base, status: "unidentified", reason: "invalid_probability_or_score_law",
      finalHomeMargin: statisticalHomeMargin,
      finalHomeWinProbability: statisticalHomeWinProbability,
    };
  }
  if (Date.parse(args.statisticalKnowledgeAt) > Date.parse(args.episode.openingAt)) {
    return {
      ...base, status: "unidentified", reason: "episode_overlaps_statistical_knowledge",
      finalHomeMargin: statisticalHomeMargin,
      finalHomeWinProbability: statisticalHomeWinProbability,
    };
  }
  if (opening === current) {
    return {
      ...base, status: "unchanged", reason: "same_book_no_economic_price_change",
      finalHomeMargin: statisticalHomeMargin,
      finalHomeWinProbability: statisticalHomeWinProbability,
    };
  }
  const logit = (probability: number) => Math.log(probability / (1 - probability));
  const inverseLogit = (value: number) => 1 / (1 + Math.exp(-value));
  const desiredProbability = inverseLogit(
    logit(statisticalHomeWinProbability) + logit(current) - logit(opening),
  );
  const probabilityAt = (homeMargin: number) => twoWayHomeProbability(
    buildNflUnifiedMarketAdjustedForecast({
      baseForecast: forecast,
      expectedHomeMargin: homeMargin,
      expectedTotal: statisticalTotal,
      marketInputPolicy: "target_excluded_continuous_residual",
    }),
  );
  // The physical mean-score domain is open: both teams must have positive
  // expected points. If the observed price innovation cannot be represented
  // by this frozen score law, preserve it as unidentified instead of clipping.
  let low = -statisticalTotal + 1e-6;
  let high = statisticalTotal - 1e-6;
  const minimum = probabilityAt(low);
  const maximum = probabilityAt(high);
  if (!(minimum <= desiredProbability && desiredProbability <= maximum)) {
    return {
      ...base, status: "unidentified", reason: "price_change_outside_score_law",
      finalHomeMargin: statisticalHomeMargin,
      finalHomeWinProbability: statisticalHomeWinProbability,
    };
  }
  for (let step = 0; step < 65; step++) {
    const middle = (low + high) / 2;
    if (probabilityAt(middle) < desiredProbability) low = middle;
    else high = middle;
  }
  const finalHomeMargin = (low + high) / 2;
  return {
    ...base,
    status: "transported",
    reason: "same_book_moneyline_log_odds_displacement",
    finalHomeMargin,
    finalHomeWinProbability: probabilityAt(finalHomeMargin),
  };
}

function twoWayHomeProbability(forecast: NflV1WeekOneOutcomeForecast) {
  // The released Moneyline law conditions on a decided result; tie mass is
  // tracked separately and must not be added back into a two-way fair quote.
  return forecast.homeWinProbability;
}

function twoSidedFairHome(homeAmerican: number, awayAmerican: number): number | null {
  const implied = (price: number) => !Number.isFinite(price) ||
    (price > -100 && price < 100) ? null : price > 0 ? 100 / (price + 100) : -price / (100 - price);
  const home = implied(homeAmerican);
  const away = implied(awayAmerican);
  return home === null || away === null || home + away <= 0 ? null : home / (home + away);
}
