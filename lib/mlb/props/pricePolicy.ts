import { american_to_decimal, american_to_implied_probability } from "./oddsMath";

export type PropPriceBand = "standard" | "short" | "extreme_short" | "longshot" | "extreme_longshot" | "invalid";

export type PropPriceAssessment = {
  americanOdds: number;
  band: PropPriceBand;
  label: string | null;
  impliedProbability: number | null;
  riskToWin100: number | null;
  profitOn100: number | null;
  displayEligible: boolean;
  signalEligible: boolean;
  reasonCode: "EXTREME_PRICE_RESEARCH_ONLY" | "INVALID_PRICE_FORMAT" | null;
};

const DEFAULT_SIGNAL_MIN_AMERICAN_ODDS = -500;
const DEFAULT_SIGNAL_MAX_AMERICAN_ODDS = 1000;
const DEFAULT_DISPLAY_ABSOLUTE_LIMIT = 10_000;

export function assessPropPrice(
  americanOdds: number,
  overrides: {
    signalMinAmericanOdds?: number;
    signalMaxAmericanOdds?: number;
    displayAbsoluteLimit?: number;
  } = {},
): PropPriceAssessment {
  const signalMin = overrides.signalMinAmericanOdds ?? envNumber("ODDSPHERE_PROPS_SIGNAL_MIN_AMERICAN_ODDS", DEFAULT_SIGNAL_MIN_AMERICAN_ODDS);
  const signalMax = overrides.signalMaxAmericanOdds ?? envNumber("ODDSPHERE_PROPS_SIGNAL_MAX_AMERICAN_ODDS", DEFAULT_SIGNAL_MAX_AMERICAN_ODDS);
  const displayLimit = overrides.displayAbsoluteLimit ?? envNumber("ODDSPHERE_PROPS_DISPLAY_ODDS_ABSOLUTE_LIMIT", DEFAULT_DISPLAY_ABSOLUTE_LIMIT);
  const conventionalAmericanPrice = Number.isFinite(americanOdds)
    && americanOdds !== 0
    && Math.abs(americanOdds) >= 100
    && Math.abs(americanOdds) <= displayLimit;

  if (!conventionalAmericanPrice) {
    return {
      americanOdds,
      band: "invalid",
      label: "Price under review",
      impliedProbability: null,
      riskToWin100: null,
      profitOn100: null,
      displayEligible: false,
      signalEligible: false,
      reasonCode: "INVALID_PRICE_FORMAT",
    };
  }

  const impliedProbability = american_to_implied_probability(americanOdds);
  const decimal = american_to_decimal(americanOdds);
  const band = priceBand(americanOdds);
  const signalEligible = americanOdds >= signalMin && americanOdds <= signalMax;
  return {
    americanOdds,
    band,
    label: priceBandLabel(band),
    impliedProbability,
    riskToWin100: americanOdds < 0 ? Math.abs(americanOdds) : 100,
    profitOn100: (decimal - 1) * 100,
    displayEligible: true,
    signalEligible,
    reasonCode: signalEligible ? null : "EXTREME_PRICE_RESEARCH_ONLY",
  };
}

function priceBand(americanOdds: number): PropPriceBand {
  if (americanOdds <= -1000) return "extreme_short";
  if (americanOdds <= -500) return "short";
  if (americanOdds >= 1500) return "extreme_longshot";
  if (americanOdds >= 1000) return "longshot";
  return "standard";
}

function priceBandLabel(band: PropPriceBand): string | null {
  if (band === "short") return "Very short price";
  if (band === "extreme_short") return "Extreme price";
  if (band === "longshot") return "Longshot price";
  if (band === "extreme_longshot") return "Extreme longshot";
  return band === "invalid" ? "Price under review" : null;
}

function envNumber(name: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}
