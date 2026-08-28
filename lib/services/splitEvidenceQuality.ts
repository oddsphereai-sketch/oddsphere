/**
 * Public split evidence quality guards.
 *
 * A provider-reported exact 0% or 100% share is not decision-grade evidence
 * when the payload does not also carry a verifiable ticket/handle sample
 * count. Non-endpoint values are preserved exactly; unsupported values remain
 * unavailable and are never replaced with 50%, a complement, or another
 * provider's value.
 */

export function verifiedUnitSplitPct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 && value < 1 ? value : null;
}

export function verifiedHundredSplitPct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 && value < 100 ? value : null;
}

/** Source-aware split rows are stored as 0..1 fractions. */
export function verifiedSourceAwareSplitPctHundred(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Canonical V2 rows use 0..1 fractions. Historical lock fixtures and a
  // small number of legacy snapshots used 0..100; preserve both non-endpoint
  // encodings while treating exact 0/1-fraction/100 endpoints as unavailable.
  if (value > 0 && value < 1) return Math.round(value * 100);
  if (value > 1 && value < 100) return Math.round(value);
  return null;
}
