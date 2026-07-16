export function american_to_decimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`american_to_decimal: invalid odds ${american}`);
  }
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

export function decimal_to_american(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new Error(`decimal_to_american: decimal must be > 1, got ${decimal}`);
  }
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function american_to_implied_probability(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`american_to_implied_probability: invalid odds ${american}`);
  }
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

export function remove_vig_two_way(overAmerican: number, underAmerican: number) {
  const overRaw = american_to_implied_probability(overAmerican);
  const underRaw = american_to_implied_probability(underAmerican);
  const total = overRaw + underRaw;
  if (total <= 0) throw new Error("remove_vig_two_way: invalid probability total");
  return {
    over: overRaw / total,
    under: underRaw / total,
    overround: total - 1,
  };
}

export function expected_value(modelProbability: number, americanOdds: number): number {
  assertProbability(modelProbability, "modelProbability");
  const decimal = american_to_decimal(americanOdds);
  return modelProbability * (decimal - 1) - (1 - modelProbability);
}

export function fair_decimal_odds(probability: number): number {
  assertOpenProbability(probability, "probability");
  return 1 / probability;
}

export function fair_american_odds(probability: number): number {
  return decimal_to_american(fair_decimal_odds(probability));
}

export function kelly_fraction(modelProbability: number, americanOdds: number): number {
  assertProbability(modelProbability, "modelProbability");
  const b = american_to_decimal(americanOdds) - 1;
  const q = 1 - modelProbability;
  return Math.max(0, (b * modelProbability - q) / b);
}

export function recommended_fractional_kelly_stake(args: {
  modelProbability: number;
  americanOdds: number;
  bankroll: number;
  fractionalKelly: number;
  maxBankrollFraction: number;
}): number {
  if (expected_value(args.modelProbability, args.americanOdds) <= 0) return 0;
  const fraction = kelly_fraction(args.modelProbability, args.americanOdds) * args.fractionalKelly;
  const capped = Math.min(fraction, args.maxBankrollFraction);
  return Math.max(0, args.bankroll * capped);
}

function assertProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1], got ${value}`);
  }
}

function assertOpenProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be in (0, 1), got ${value}`);
  }
}
