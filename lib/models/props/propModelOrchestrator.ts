/**
 * Prop Model Orchestrator — ties the 3B math layer into a single pipeline.
 *
 * Input:  one prop opportunity (player + pitcher + market + line + context).
 * Output: a PropPredictionResult containing both the customer-facing
 *         prediction (prop_predictions row) and the audit-trail breakdown
 *         (prediction_breakdowns row).
 *
 * Pipeline (per FOUNDATION.md section 7):
 *   1. Marcel regression           → base rate from 3-yr 5/4/3 weighted shrinkage
 *   2. Log5 matchup                → batter vs pitcher (batter markets only)
 *   3. Context adjustments         → park, weather (HR only), platoon
 *   4. Distribution                → binomial / Poisson / negative binomial
 *   5. Edge vs Pinnacle fair        → tier classification
 *   6. 6-factor confidence score   → 0-100 + 1-5 stars
 *   7. Reasoning + caveat          → 1-2 sentence template
 *
 * Pure function. No I/O. The Phase 4 cron / 3C runner script supplies the
 * inputs and persists the outputs.
 */

import type {
  HitterPitchRecord,
  PitcherPitchRecord,
  StatsPlayerRecord,
  StatsSeasonRecord,
  StatsSplitRecord,
} from "../../providers/interfaces/IStatsProvider";
import type { LineRecord } from "../../providers/interfaces/IBettingProvider";
import type { PropMarketType, Sportsbook } from "../../types/domain/Lines";
import type { WindRelative } from "./contextAdjustments";

import {
  applyParkFactor,
  applyPlatoonAdjustment,
  applyWeatherAdjustment,
} from "./contextAdjustments";
import { calculateEdge } from "./edgeCalculator";
import { computeConfidence } from "./confidenceScore";
import { log5 } from "./log5Matchup";
import {
  marcelRegressedRate,
  type SeasonRate,
} from "./marcelRegression";
import { classifyTier, type PropTier } from "./tierClassifier";

import { binomialProbabilityOver } from "./distributions/binomial";
import { negativeBinomialProbabilityOver } from "./distributions/negativeBinomial";
import { poissonProbabilityOver } from "./distributions/poisson";

import {
  BFP_PER_AVERAGE_START,
  CALIBRATION_DEFAULT,
  LEAGUE_AVERAGES,
  PA_BY_BATTING_ORDER,
  PA_FOR_DH,
  PA_FOR_PITCHER,
  RELIABILITY_CONSTANTS,
} from "../../config/constants";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type BallparkContext = {
  park_factor_runs: number;
  park_factor_hr: number;
  park_factor_hits: number;
  park_factor_so: number | null;
  park_factor_handedness_lhh: number | null;
  park_factor_handedness_rhh: number | null;
};

export type WeatherContext = {
  wind_speed_mph: number;
  wind_direction_relative: WindRelative;
  temperature_f: number;
};

export type PropPredictionInput = {
  market: PropMarketType;
  line: number;
  batter: StatsPlayerRecord;
  pitcher: StatsPlayerRecord;
  ballpark: BallparkContext;
  weather: WeatherContext;
  lineupPosition: number | null;       // 1-9, or null if not in lineup
  isLineupConfirmed: boolean;
  isDH: boolean;
  batterSeasonStats: StatsSeasonRecord[];
  batterSplits: StatsSplitRecord[];
  batterPitchStats: HitterPitchRecord[];  // not used in V1; reserved for future log5-by-pitch-type
  pitcherSeasonStats: StatsSeasonRecord[];
  pitcherPitchStats: PitcherPitchRecord[]; // not used in V1
  /** All offered lines for this prop (multiple sportsbooks) */
  offeredLines: LineRecord[];
  /** Default 2026 — anchor for Marcel projection */
  currentSeason?: number;
};

export type PropPredictionBreakdown = {
  marcel_base_rate: number;
  matchup_log5_rate: number;
  park_adjustment: number;
  weather_adjustment: number;
  platoon_adjustment: number;
  recency_adjustment: number;
  expected_plate_appearances: number;
  lineup_position: number | null;
  reliability_score: number;
  lineup_confirmation_score: number;
  weather_certainty_score: number;
  workload_certainty_score: number;
  market_liquidity_score: number;
  calibration_score: number;
};

export type PropPredictionResult = {
  prop_market: PropMarketType;
  prop_line: number;
  model_probability: number;
  fair_probability: number;
  edge_pct: number;
  tier: PropTier;
  confidence_score: number;
  confidence_stars: number;
  best_sportsbook: Sportsbook | null;
  best_odds_american: number | null;
  ev_pct: number | null;
  reasoning: string;
  caveat: string | null;
  bet_odds_american: number | null;
  breakdown: PropPredictionBreakdown;
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers — numerator/denominator extraction per market
// ─────────────────────────────────────────────────────────────────────────

/** BFP (batters faced by pitcher) — approximated from box-score fields:
 *  BFP ≈ IP × 3 + H + BB. More accurate than IP × 4.25 because it
 *  accounts for pitchers who allow more baserunners. */
function batterFacedByPitcher(s: StatsSeasonRecord): number {
  const ip = s.pitching_ip ?? 0;
  const h = s.pitching_h ?? 0;
  const bb = s.pitching_bb ?? 0;
  if (ip <= 0) return 0;
  return ip * 3 + h + bb;
}

/** Convert a season's batting stats into Marcel-ready (numerator, denominator)
 *  for the requested market. Returns null if the season has no relevant data. */
function batterSeasonRate(
  s: StatsSeasonRecord,
  market: PropMarketType
): { numerator: number; denominator: number } | null {
  const pa = s.batting_pa ?? 0;
  if (pa <= 0) return null;
  switch (market) {
    case "batter_hits":
      return { numerator: s.batting_h ?? 0, denominator: pa };
    case "batter_home_runs":
      return { numerator: s.batting_hr ?? 0, denominator: pa };
    case "batter_total_bases":
      return { numerator: s.batting_tb ?? 0, denominator: pa };
    case "batter_rbis":
      return { numerator: s.batting_rbi ?? 0, denominator: pa };
    default:
      return null;
  }
}

function pitcherSeasonRate(
  s: StatsSeasonRecord,
  market: PropMarketType
): { numerator: number; denominator: number } | null {
  const bfp = batterFacedByPitcher(s);
  if (bfp <= 0) return null;
  switch (market) {
    case "pitcher_strikeouts":
      return { numerator: s.pitching_k ?? 0, denominator: bfp };
    case "pitcher_earned_runs":
      return { numerator: s.pitching_er ?? 0, denominator: bfp };
    case "pitcher_hits_allowed":
      return { numerator: s.pitching_h ?? 0, denominator: bfp };
    default:
      return null;
  }
}

function leagueAverageForMarket(market: PropMarketType): number {
  switch (market) {
    case "batter_hits":         return LEAGUE_AVERAGES.batter_hits_per_pa;
    case "batter_home_runs":    return LEAGUE_AVERAGES.batter_hr_per_pa;
    case "batter_total_bases":  return LEAGUE_AVERAGES.batter_tb_per_pa;
    case "batter_rbis":         return LEAGUE_AVERAGES.batter_rbi_per_pa;
    case "pitcher_strikeouts":  return LEAGUE_AVERAGES.pitcher_k_per_bfp;
    case "pitcher_earned_runs": return LEAGUE_AVERAGES.pitcher_er_per_bfp;
    case "pitcher_hits_allowed":return LEAGUE_AVERAGES.pitcher_h_per_bfp;
  }
}

function parkFactorForMarket(market: PropMarketType, p: BallparkContext): number {
  switch (market) {
    case "batter_hits":           return p.park_factor_hits;
    case "batter_total_bases":    return p.park_factor_hits;   // proxy via hits
    case "batter_home_runs":      return p.park_factor_hr;
    case "batter_rbis":           return p.park_factor_runs;
    case "pitcher_strikeouts":    return p.park_factor_so ?? 100;
    case "pitcher_earned_runs":   return p.park_factor_runs;
    case "pitcher_hits_allowed":  return p.park_factor_hits;
  }
}

function isPitcherMarket(market: PropMarketType): boolean {
  return market === "pitcher_strikeouts" ||
         market === "pitcher_earned_runs" ||
         market === "pitcher_hits_allowed";
}

function isBatterMarket(market: PropMarketType): boolean {
  return !isPitcherMarket(market);
}

// ─────────────────────────────────────────────────────────────────────────
// Distribution dispatch
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute P(X >= threshold) for the given market using the appropriate
 * distribution. Returns the probability of the over bet hitting.
 *
 *   hits             → Binomial(n=expectedCount, p=rate)
 *   HR / K / ER      → Poisson(λ=expectedCount × rate)
 *   TB / H_allowed   → Negative Binomial (overdispersed)
 *   RBIs             → Poisson (V1 simple; revisit in Phase 7)
 */
function probabilityOver(
  market: PropMarketType,
  rate: number,
  expectedCount: number,
  threshold: number
): number {
  // For NB markets, we apply an overdispersion factor: σ² = μ × factor.
  // TB has heavier tail from HR=4 outliers; H allowed has clustering.
  const NB_OVERDISPERSION = {
    batter_total_bases: 1.5,
    pitcher_hits_allowed: 1.3,
  } as const;

  switch (market) {
    case "batter_hits": {
      // For binomial, n must be integer
      const n = Math.round(expectedCount);
      return binomialProbabilityOver(n, rate, threshold);
    }
    case "batter_home_runs":
    case "batter_rbis":
    case "pitcher_strikeouts":
    case "pitcher_earned_runs": {
      const lambda = rate * expectedCount;
      return poissonProbabilityOver(lambda, threshold);
    }
    case "batter_total_bases": {
      const mean = rate * expectedCount;
      const variance = mean * NB_OVERDISPERSION.batter_total_bases;
      return negativeBinomialProbabilityOver(mean, variance, threshold);
    }
    case "pitcher_hits_allowed": {
      const mean = rate * expectedCount;
      const variance = mean * NB_OVERDISPERSION.pitcher_hits_allowed;
      return negativeBinomialProbabilityOver(mean, variance, threshold);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Expected counts (PA for batters, BFP for pitchers)
// ─────────────────────────────────────────────────────────────────────────

function expectedBatterPA(
  lineupPosition: number | null,
  isDH: boolean
): number {
  if (lineupPosition === null) {
    // Not in lineup — best estimate is "if they pinch hit" → 1 PA expected
    return 1;
  }
  if (isDH) return PA_FOR_DH;
  const slot = PA_BY_BATTING_ORDER[lineupPosition];
  return slot ?? PA_BY_BATTING_ORDER[5]!; // fallback to middle of order
}

function expectedPitcherBFP(
  pitcherSeasons: StatsSeasonRecord[]
): number {
  // Use the pitcher's most recent full-season BFP/GS to estimate workload.
  // Fallback to BFP_PER_AVERAGE_START for short samples.
  const recent = pitcherSeasons
    .filter((s) => s.season_type === "regular" && (s.pitching_gs ?? 0) >= 10)
    .sort((a, b) => b.season - a.season)[0];
  if (!recent || (recent.pitching_gs ?? 0) === 0) {
    return BFP_PER_AVERAGE_START;
  }
  const bfp = batterFacedByPitcher(recent);
  const perStart = bfp / (recent.pitching_gs ?? 1);
  return perStart;
}

// ─────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────

export function predictPlayerProp(
  input: PropPredictionInput
): PropPredictionResult {
  const currentSeason = input.currentSeason ?? 2026;
  const market = input.market;
  const leagueAvg = leagueAverageForMarket(market);
  const reliabilityConstant =
    RELIABILITY_CONSTANTS[market] ?? 1000;

  // ─── Step 1: Marcel regression ─────────────────────────────────────────
  // Project the player's true rate from 3 years of weighted stats.
  const player = isPitcherMarket(market) ? input.pitcher : input.batter;
  const playerStats = isPitcherMarket(market)
    ? input.pitcherSeasonStats
    : input.batterSeasonStats;

  const seasonRates: SeasonRate[] = playerStats
    .filter((s) => s.season_type === "regular")
    .map((s) => {
      const r = isPitcherMarket(market)
        ? pitcherSeasonRate(s, market)
        : batterSeasonRate(s, market);
      return r ? { season: s.season, ...r } : null;
    })
    .filter((s): s is SeasonRate => s !== null);

  const marcel = marcelRegressedRate(
    seasonRates,
    leagueAvg,
    reliabilityConstant,
    currentSeason
  );

  // ─── Step 2: Log5 matchup (batter markets only) ─────────────────────────
  let matchupRate = marcel.projectedRate;
  if (isBatterMarket(market)) {
    // Pitcher's allowed rate via the analogous mapping
    const pitcherAllowedMarket: PropMarketType | null =
      market === "batter_hits" ? "pitcher_hits_allowed"
      : market === "batter_home_runs" ? null  // pitcher_hr_allowed isn't a tracked stat in V1
      : null; // TB, RBIs: no direct pitcher analog in V1

    if (pitcherAllowedMarket !== null) {
      const pitcherRates: SeasonRate[] = input.pitcherSeasonStats
        .filter((s) => s.season_type === "regular")
        .map((s) => {
          const r = pitcherSeasonRate(s, pitcherAllowedMarket);
          return r ? { season: s.season, ...r } : null;
        })
        .filter((s): s is SeasonRate => s !== null);

      if (pitcherRates.length > 0) {
        const pitcherProjection = marcelRegressedRate(
          pitcherRates,
          leagueAvg,
          RELIABILITY_CONSTANTS[pitcherAllowedMarket],
          currentSeason
        );
        matchupRate = log5(
          marcel.projectedRate,
          pitcherProjection.projectedRate,
          leagueAvg
        );
      }
    } else if (market === "batter_home_runs") {
      // For HR, use pitcher's HR/BFP rate against league HR/PA as proxy
      const pitcherHrRates: SeasonRate[] = input.pitcherSeasonStats
        .filter((s) => s.season_type === "regular")
        .map((s) => {
          const bfp = batterFacedByPitcher(s);
          if (bfp <= 0) return null;
          return { season: s.season, numerator: s.pitching_hr ?? 0, denominator: bfp };
        })
        .filter((s): s is SeasonRate => s !== null);

      if (pitcherHrRates.length > 0) {
        const pitcherHrProj = marcelRegressedRate(
          pitcherHrRates,
          LEAGUE_AVERAGES.batter_hr_per_pa,
          700,
          currentSeason
        );
        matchupRate = log5(
          marcel.projectedRate,
          pitcherHrProj.projectedRate,
          leagueAvg
        );
      }
    }
  }

  // ─── Step 3: Context adjustments ────────────────────────────────────────
  const parkFactor = parkFactorForMarket(market, input.ballpark);
  const ratePostPark = applyParkFactor(matchupRate, parkFactor);

  const ratePostWeather = isBatterMarket(market)
    ? applyWeatherAdjustment(ratePostPark, market, input.weather)
    : ratePostPark;

  // Platoon — batter markets only. Find the relevant split.
  let ratePostPlatoon = ratePostWeather;
  if (isBatterMarket(market)) {
    const splitType =
      input.pitcher.throws === "L" ? "vs_lhp"
      : input.pitcher.throws === "R" ? "vs_rhp"
      : null;
    const split = splitType
      ? input.batterSplits.find((s) => s.split_type === splitType)
      : null;

    let splitRate: number | undefined;
    let overallRate: number | undefined;
    if (split && (split.pa ?? 0) >= 30) {
      // Take the matching numerator from the split row
      const splitNum =
        market === "batter_hits" ? (split.h ?? 0)
        : market === "batter_home_runs" ? (split.hr ?? 0)
        : market === "batter_total_bases" ? (split.tb ?? 0)
        : market === "batter_rbis" ? (split.rbi ?? 0)
        : 0;
      const splitDenom = split.pa ?? 0;
      if (splitDenom > 0) {
        splitRate = splitNum / splitDenom;
        overallRate = marcel.observedRate;
      }
    }

    ratePostPlatoon = applyPlatoonAdjustment(
      ratePostWeather,
      input.batter.bats,
      input.pitcher.throws,
      splitRate,
      overallRate
    );
  }

  // Recency adjustment placeholder (V1 disabled per spec — small weight)
  const ratePostRecency = ratePostPlatoon;

  // ─── Step 4: Expected count + distribution ──────────────────────────────
  const expectedCount = isPitcherMarket(market)
    ? expectedPitcherBFP(input.pitcherSeasonStats)
    : expectedBatterPA(input.lineupPosition, input.isDH);

  // Threshold for "over X.5" is floor(X.5) + 1 = ceil(X.5). For integer
  // lines like 7, the convention is "need 8+" so floor(7) + 1 = 8.
  const threshold = Math.floor(input.line) + 1;
  const modelProbability = probabilityOver(
    market,
    ratePostRecency,
    expectedCount,
    threshold
  );

  // ─── Step 5: Edge vs Pinnacle ───────────────────────────────────────────
  // Use Pinnacle's fair line as the de-vigged reference. If no Pinnacle in
  // the offered lines, fall back to the median fair_odds.
  const pinnacleLine = input.offeredLines.find(
    (l) => l.sportsbook === "pinnacle"
  );
  const fairOddsCandidate = pinnacleLine?.fair_odds
    ?? pinnacleLine?.odds_american
    ?? medianFairOdds(input.offeredLines);

  // If no fair reference at all (shouldn't happen with Pinnacle in mock),
  // bail with neutral output rather than throw.
  const fairOdds = fairOddsCandidate ?? -100;
  const { edgePct, fairProbability } = calculateEdge(modelProbability, fairOdds);

  // ─── Step 6: Tier classification ────────────────────────────────────────
  const tier = classifyTier(edgePct);

  // ─── Step 7: Pick best non-Pinnacle book by MODEL EV ────────────────────
  // For each book, compute EV from the MODEL's probability against the
  // offered American odds. Pick the book that maximizes model EV — this
  // is what the customer cares about ("how much can I expect to win at
  // this book given the model's read"), not what SharpAPI thinks vs fair.
  const nonPinnacle = input.offeredLines
    .filter((l) => l.sportsbook !== "pinnacle")
    .filter((l) => l.odds_american !== null);

  type BookEv = { book: LineRecord; modelEv: number };
  const bookEvs: BookEv[] = nonPinnacle.map((book) => {
    const odds = book.odds_american!;
    const profitOnWin = odds > 0 ? odds / 100 : 100 / -odds;
    const modelEv =
      modelProbability * profitOnWin - (1 - modelProbability);
    return { book, modelEv };
  });
  bookEvs.sort((a, b) => b.modelEv - a.modelEv);
  const best = bookEvs[0] ?? null;

  const bestSportsbook = best?.book.sportsbook ?? null;
  const bestOdds = best?.book.odds_american ?? null;
  const modelEvPct = best ? +(best.modelEv * 100).toFixed(2) : null;

  // ─── Step 8: Confidence ─────────────────────────────────────────────────
  // marketLiquidity = (number of books quoting) / 5  (5 = full coverage)
  const marketLiquidity = Math.min(input.offeredLines.length / 5, 1);

  // For pitchers, workloadCertainty reflects rest + injury — without that
  // data we use 0.85 default for any pitcher with a recent regular season.
  // For batters, the "workload" of the OPPOSING pitcher matters less; use 0.9.
  const workloadCertainty = isPitcherMarket(market) ? 0.85 : 0.9;

  // OpenWeather is reliable for indoor games (full certainty) and
  // ~0.9 for outdoor games.
  const weatherCertainty =
    input.weather.wind_speed_mph === 0 && input.weather.temperature_f === 72
      ? 1.0  // dome
      : 0.9;

  const confidence = computeConfidence({
    reliability: marcel.reliability,
    calibration: CALIBRATION_DEFAULT,
    lineupConfirmed: input.isLineupConfirmed,
    marketLiquidity,
    workloadCertainty,
    weatherCertainty,
  });

  // ─── Step 9: Reasoning + caveat ─────────────────────────────────────────
  const reasoning = generateReasoning({
    batterName: input.batter.full_name,
    pitcherName: input.pitcher.full_name,
    pitcherHand: input.pitcher.throws,
    market,
    line: input.line,
    modelProbability,
    fairProbability,
    edgePct,
    parkFactor,
    weather: input.weather,
    isBatter: isBatterMarket(market),
  });

  const caveat = tier === "premium"
    ? "Edge >8% — verify lineup before betting. Sharp markets rarely misprice this much."
    : null;

  // ─── Build the breakdown ────────────────────────────────────────────────
  const breakdown: PropPredictionBreakdown = {
    marcel_base_rate: +marcel.projectedRate.toFixed(5),
    matchup_log5_rate: +matchupRate.toFixed(5),
    park_adjustment: +ratePostPark.toFixed(5),
    weather_adjustment: +ratePostWeather.toFixed(5),
    platoon_adjustment: +ratePostPlatoon.toFixed(5),
    recency_adjustment: +ratePostRecency.toFixed(5),
    expected_plate_appearances: +expectedCount.toFixed(2),
    lineup_position: input.lineupPosition,
    reliability_score: +(marcel.reliability * 100).toFixed(2),
    lineup_confirmation_score: input.isLineupConfirmed ? 100 : 60,
    weather_certainty_score: +(weatherCertainty * 100).toFixed(2),
    workload_certainty_score: +(workloadCertainty * 100).toFixed(2),
    market_liquidity_score: +(marketLiquidity * 100).toFixed(2),
    calibration_score: +(CALIBRATION_DEFAULT * 100).toFixed(2),
  };

  return {
    prop_market: market,
    prop_line: input.line,
    model_probability: +modelProbability.toFixed(4),
    fair_probability: +fairProbability.toFixed(4),
    edge_pct: edgePct,
    tier,
    confidence_score: confidence.score,
    confidence_stars: confidence.stars,
    best_sportsbook: bestSportsbook as Sportsbook | null,
    best_odds_american: bestOdds,
    ev_pct: modelEvPct,
    reasoning,
    caveat,
    bet_odds_american: bestOdds,
    breakdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Reasoning template
// ─────────────────────────────────────────────────────────────────────────

function generateReasoning(args: {
  batterName: string;
  pitcherName: string;
  pitcherHand: string | null;
  market: PropMarketType;
  line: number;
  modelProbability: number;
  fairProbability: number;
  edgePct: number;
  parkFactor: number;
  weather: WeatherContext;
  isBatter: boolean;
}): string {
  const marketLabel = marketDisplayName(args.market);
  const subject = args.isBatter ? args.batterName : args.pitcherName;
  const opponent = args.isBatter ? args.pitcherName : null;

  // Lead with the model's read
  const modelPct = (args.modelProbability * 100).toFixed(0);
  const fairPct = (args.fairProbability * 100).toFixed(0);
  const segments: string[] = [
    `Model projects ${modelPct}% for ${subject} over ${args.line} ${marketLabel}${opponent ? ` vs ${opponent}` : ""}; market implies ${fairPct}%.`,
  ];

  // Mention the most distinctive context factor
  if (args.parkFactor >= 110) {
    segments.push("Park boost.");
  } else if (args.parkFactor <= 92) {
    segments.push("Park suppresses.");
  }

  const wind = args.weather.wind_speed_mph;
  const dir = args.weather.wind_direction_relative;
  if (
    args.isBatter &&
    args.market === "batter_home_runs" &&
    wind >= 12 &&
    dir &&
    dir.startsWith("out_")
  ) {
    segments.push(`${wind}mph wind ${dir.replace(/_/g, " ")} aids HR.`);
  }

  return segments.join(" ");
}

function marketDisplayName(market: PropMarketType): string {
  switch (market) {
    case "batter_hits":          return "hits";
    case "batter_total_bases":   return "total bases";
    case "batter_home_runs":     return "HR";
    case "batter_rbis":          return "RBI";
    case "pitcher_strikeouts":   return "strikeouts";
    case "pitcher_earned_runs":  return "earned runs";
    case "pitcher_hits_allowed": return "hits allowed";
  }
}

function medianFairOdds(lines: LineRecord[]): number | null {
  const fairs = lines
    .map((l) => l.fair_odds)
    .filter((v): v is number => v !== null);
  if (fairs.length === 0) return null;
  const sorted = [...fairs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
