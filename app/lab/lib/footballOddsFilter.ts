export type AmericanOddsRange = {
  min: number | null;
  max: number | null;
};

export function isValidAmericanOddsInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true;
  if (!/^[+-]?\d+$/.test(trimmed)) return false;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && Math.abs(value) >= 100;
}

export function parseAmericanOddsInput(input: string): number | null {
  if (!isValidAmericanOddsInput(input)) return null;
  const trimmed = input.trim();
  return trimmed ? Number(trimmed) : null;
}

export function americanOddsRangeIsOrdered(range: AmericanOddsRange): boolean {
  return range.min === null || range.max === null || range.min <= range.max;
}

export function americanOddsInRange(
  price: number | null | undefined,
  range: AmericanOddsRange,
): boolean {
  if (range.min === null && range.max === null) return true;
  if (price === null || price === undefined || !Number.isFinite(price)) return false;
  if (range.min !== null && price < range.min) return false;
  if (range.max !== null && price > range.max) return false;
  return true;
}
